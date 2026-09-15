# Pre-Merge Readiness Integrity Patch — Confidence Mutability & Density

Narrow patch on top of Sprint 4 + 4.1's unified readiness architecture, fixing two
related confidence-model integrity issues identified in final pre-merge review, plus
one adjacent mobile version-selection gap surfaced during the same audit.

## 1. Root Cause

**Issue 1 — confidence sources behaved as first-write-wins.** `record_task_evidence_internal()`'s
source ledger insert (`task_evidence_sources`, keyed on `profile_id, acs_task_id,
source_type, source_id`) used `on conflict do nothing`. That's the correct behavior for
*objective* evidence — a retried network request for the same practice attempt must
never double-count. It is wrong for *confidence-only* evidence (`p_correct is null`):
Checkride Corner and Scenario Workshop ratings post to a **stable** source id
(`moduleId:section:promptId`, unchanged across re-ratings of the same prompt — confirmed
in `site/portal-stable.js`'s guided-notes rating handler), so a student who rated a
prompt "Not Yet," studied, and came back to rate it "Confident" had the improved rating
silently discarded forever — the row already existed, and the whole function returned
early without touching `self_confidence` anywhere. Confidence is a mutable current-state
signal, not an immutable attempt record, and the write path treated it as the latter.

**Issue 2 — global confidence was weighted by curriculum density.** `compute_readiness_snapshot()`
computed confidence as `avg(self_confidence)` joined directly across every
`task_evidence_sources` row in a student's scoped-task set. A task with 50 authored
confidence prompts contributed 50 rows to that average; a task with 5 prompts
contributed 5. A task Apex happened to author more Checkride Corner/Scenario content
for would automatically dominate the global confidence component — a pure artifact of
how much content existed, independent of the student's actual confidence in either
task.

Both bugs live in functions Sprint 4.1 (v134/v135) introduced or rewrote; neither is
a regression from earlier sprints.

## 2. Confidence Update Fix

`record_task_evidence_internal()`'s ledger insert now reads:

```sql
insert into task_evidence_sources (profile_id, acs_task_id, source_type, source_id, self_confidence, recorded_at)
values (p_profile_id, p_acs_task_id, p_source_type, p_source_id, p_self_confidence, now())
on conflict (profile_id, acs_task_id, source_type, source_id) do update set
  self_confidence = excluded.self_confidence,
  recorded_at = now()
where p_correct is null
returning (xmax = 0) into v_source_was_new;
```

Postgres treats a `DO UPDATE ... WHERE` conflict whose predicate evaluates false as a
no-op for that row (identical to `DO NOTHING`) — so an **objective** conflict
(`p_correct is not null`) is completely unaffected; `v_source_was_new` comes back `null`
and the function returns early exactly as before, byte-identical to pre-patch behavior.
A **confidence-only** conflict now actually updates `self_confidence` and `recorded_at`
instead of being dropped. The `xmax = 0` trick on the `RETURNING` clause tells the
function whether this was a genuinely new source or a re-rating of an existing one;
that flag (`v_source_was_new`) gates whether the downstream `task_evidence` upsert counts
this as review activity (`review_attempt_count`/`review_correct_count`), so a re-rating
of an already-known source can never manufacture a second review attempt for the same
underlying action. (Current callers — Checkride Corner/Scenario ratings — never pass
`p_is_review = true` anyway, so this is defense-in-depth for any future caller, not a
change in today's observed counts.)

No XP or analytics side effects are attached to `task_evidence`/`task_evidence_sources`
at the database level (confirmed: no triggers on either table, and `record_ground_school_evidence()`
itself contains no XP/analytics calls) — the client's own `confidence_rating_set`
analytics event already fires once per genuine user click regardless of DB dedup, which
is correct (each click is a real, distinct action), not a duplicate.

## 3. Confidence Aggregation

`compute_readiness_snapshot()`'s confidence query now aggregates in two steps:

```sql
select round(100.0 * avg(per_task.task_avg_confidence), 2) into v_confidence
from (
  select s.acs_task_id, avg(s.self_confidence) as task_avg_confidence
  from get_readiness_scoped_acs_tasks(v_profile_id) t
  join task_evidence_sources s on s.acs_task_id = t.id and s.profile_id = v_profile_id
  where s.self_confidence is not null
  group by s.acs_task_id
) per_task;
```

Step one collapses every rated source **within** a scoped ACS task into one number
(that task's own average confidence, regardless of whether it has 1 rated prompt or
50). Step two averages **across** tasks that have at least one rating — each
contributing exactly one data point to the final `v_confidence`, never weighted by how
many prompts happen to be mapped to it. `get_readiness_scoped_acs_tasks()` — the same
function already authoritative for coverage and knowledge scoping — is the only scope
source; no parallel taxonomy or new scope rule was introduced.

**Verification (production, disposable test profile):** inserted 10 identical
"Confident" (1.0) ratings against one scoped task and 2 identical "Not Yet" (0.0)
ratings against a second scoped task, then compared both formulas directly:

| Formula | Result |
|---|---|
| Old (flat `avg()` across all 12 rows) | **83.33%** |
| New (per-task average, then average across 2 tasks) | **50.00%** |

`compute_readiness_snapshot()` itself returned `confidence_score: 50.00` on this exact
dataset, confirming the live function matches the intended formula — a task with 10x
the rated prompts no longer drags the global number toward it. Test data was fully
cleaned up afterward (verified 0 residual rows).

## 4. Objective Evidence Safety

Unaffected by design — the objective-evidence branch (`p_correct is not null`) of
`record_task_evidence_internal()` is untouched except that its early-return guard now
checks `v_source_was_new is null` instead of the old ledger `row_count = 0`, which is
exactly equivalent for that branch (both trigger only when the `WHERE p_correct is
null` clause suppressed the conflict-update, i.e. only on an objective-evidence
conflict). Live-verified: three identical `record_ground_school_evidence()` calls with
`p_is_correct = true` and the same `source_id` (simulating a retried network request)
produced `attempt_count = 1, correct_count = 1`, one source row — no double-counting.
`compute_readiness_snapshot()`'s coverage/knowledge computation, the 0.40/0.45/0.15
weights, risk-management mirroring, `evidence_level` thresholds, `category_breakdown`,
and `weak_tasks` selection are byte-identical to the pre-patch v3 function — only the
confidence subquery changed.

## 5. Model Version Decision

**Kept `v3`. Did not bump to `v4`.**

Production evidence checked (read-only) before deciding:

- `readiness_snapshots` contains exactly **7** `algorithm_version = 'v3'` rows,
  spanning **3** distinct profiles, all created within an 8-hour window on the single
  day (2026-09-14) Sprint 4.1's v135 migration shipped.
- One of those 3 profiles (`v118rev2.entitlementtest+...@apexaviationtx.com`, 5 of the
  7 rows) is a disposable test account created and used for Sprint 4.1's own live
  testing — not an organic user.
- The other 2 profiles (real-looking external emails) each have **exactly one** `v3`
  row, with `overall_score = 7.50` — the deterministic floor value for a completely
  empty evidence state (`0.15 * 50` confidence-default contribution, zero coverage,
  zero knowledge) — consistent with a single dashboard page-load triggering the first
  snapshot, not organic engagement.
- **Zero** profiles have more than one `v3` snapshot. There is no multi-snapshot v3
  history for any real user — no week-over-week comparison exists or could be broken.
- `v1` rows (4 total) belong exclusively to smoke-test accounts and the developer's own
  account, and share zero profile overlap with any `v3` row.

This satisfies the decision rule's "not meaningfully shipped" branch exactly: a handful
of test/first-touch snapshots, zero accumulated real-user history. Sprint 4 + 4.1 have
not yet merged to the app's live surface at all, so by definition this entire model is
still pre-release. Bumping to `v4` for a bug caught before launch would be
definitionally pointless per the decision rule's own instruction — `CURRENT_READINESS_ALGORITHM_VERSION`
stays `'v3'` in `site/portal-stable.js`, `mobile-readiness`, and `mobile-bootstrap`.

## 6. Mobile Current-Version Behavior

Audited every mobile-facing path that resolves "the student's current readiness":

- **`mobile-readiness` Edge Function, `latest` action**: previously
  `.order('created_at', {ascending:false}).limit(1)` with no version filter. Now adds
  `.eq('algorithm_version', CURRENT_READINESS_ALGORITHM_VERSION)` (a new module-level
  constant, `'v3'`, mirroring web's). If no current-version row exists yet, the query
  returns nothing and `shape(null)` yields `snapshot: null` — a state
  `MobileReadinessResponse`/`ReadinessCard.tsx` already handles (it's the same shape a
  brand-new learner sees). `latest` remains strictly read-only, preserving the explicit
  contract `usePostCompleteRefresh.ts` already depends on (`latest` never recomputes;
  only `refresh` does) — the fix could not silently trigger a recompute without
  breaking that documented invariant.
- **`mobile-bootstrap` Edge Function, `progress.readiness_summary`**: had the identical
  unfiltered-`latest` pattern feeding the Home screen on every app open (a more
  frequently-hit path than `mobile-readiness`'s own `latest`). Fixed the same way, same
  constant, same `null` fallback (`readiness_summary: null`, already a handled state
  for zero-snapshot learners).
- **Production verification of the fix's effect** (read-only): for the 3 profiles whose
  only snapshot predates `v3`, the old unfiltered query would have served their stale
  score as "current" (7.50, 44.05, 19.13 respectively); the fixed, version-filtered
  query correctly returns nothing for all 3. For the profiles that already have a `v3`
  snapshot, both queries agree — no change in what they see.
- **Web** (`fetchCurrentReadinessSnapshot()`, `site/portal-stable.js`) already
  implemented this exact pattern from Sprint 4.1 Phase 8 (checks `algorithm_version`
  before trusting a cached or `'latest'`-fetched snapshot, escalates to `'refresh'` on
  mismatch) — confirmed unchanged and consistent with both fixed mobile paths. Native
  mobile has no client-side version-check logic of its own (confirmed by reading
  `usePostCompleteRefresh.ts` and `lib/api/readiness.ts`) and needed none added — moving
  the guarantee into the two Edge Functions makes `latest` version-safe on its own,
  without touching native UI or navigation (both explicitly out of scope for this
  patch).

## 7. Database Changes

**New migration**: `portal/supabase-portal-schema-v140-confidence-mutability-and-density-fix.sql`,
applied to production project `wqzfhcjsfzwrimvsudxy`.

- `record_task_evidence_internal()` — recreated (`create or replace`) with the mutable-confidence
  ledger fix described in §2. Grants restated (idempotent, matches the state Sprint 4.1
  Phase 10 already established): `revoke ... from public, anon, authenticated`,
  `grant ... to service_role` only.
- `compute_readiness_snapshot()` — recreated with the per-task confidence normalization
  described in §3; every other block byte-identical to the live v3 function.

No new tables, columns, or indexes were required — `task_evidence_sources`'s existing
primary key already provides the exact conflict target needed, and both new query
shapes (confidence per-task grouping, the ledger's `xmax` check) run against existing
indexed columns.

**Edge Functions redeployed** (source changes only, no schema dependency):
- `mobile-readiness` (v6 → v7): added `CURRENT_READINESS_ALGORITHM_VERSION` constant
  and the `.eq('algorithm_version', ...)` filter on `latest`.
- `mobile-bootstrap` (v2 → v3): same constant and filter on `progress.readiness_summary`'s
  source query.

No migration was created solely to bump a version number — v140 is the only new
migration this patch required.

## 8. Security

- **Ownership**: re-verified cross-profile denial live — authenticating as one test
  profile and calling `record_ground_school_evidence()` with a *different* profile's id
  raises `Not authorized to record evidence for this profile` (the pre-existing
  `auth.uid() <> p_profile_id` check, untouched by this patch, confirmed still
  enforced against the recreated internal function).
- **Anon**: confirmed `has_function_privilege('anon', ..., 'EXECUTE')` is `false` for
  both `compute_readiness_snapshot()` and `record_ground_school_evidence()`.
- **Internal helper not directly exposed**: `record_task_evidence_internal()` — the
  function this patch's Fix 1 lives in — remains locked down exactly as Sprint 4.1
  Phase 10 left it: `anon = false`, `authenticated = false`, `service_role = true`.
  Re-verified after the `create or replace` (a replace preserves existing grants, and
  this migration also restates them explicitly for rerun-safety).
- **search_path**: both recreated functions carry `SET search_path TO 'public'`
  (unchanged from before).
- **Grants**: no grant was widened. The only grant statement in v140 restates the
  already-correct `record_task_evidence_internal()` state; `compute_readiness_snapshot()`'s
  grants were not touched at all (its `authenticated = true` grant is original,
  intentional, unchanged).

## 9. Tests

All run live against production on disposable test profile `917c1b45-3bdb-4e60-9bb5-2374002b6068`
(a pre-existing Sprint 4.1 test account), through the real `record_ground_school_evidence()`/
`compute_readiness_snapshot()` RPCs (not direct table writes, except where noted for
Test E's density setup), with full cleanup verified after each test and after the full
suite (0 residual `task_evidence_sources` rows, `v3` snapshot count unchanged at 7).

| Test | Setup | Result |
|---|---|---|
| **A** — Not Yet → Confident | Same source, rate 0.0 then 1.0 | `self_confidence`: 0.0 → **1.0**. 1 source row (no duplicate). `attempt_count`/`correct_count`/`review_attempt_count`/`review_correct_count` stayed 0 throughout. **PASS** |
| **B** — Confident → Needs Review | Same source, rate 1.0 then 0.5 | `self_confidence`: 1.0 → **0.5**. 1 source row. Objective counts unchanged (0). **PASS** |
| **C** — Confident → Confident | Same source, rate 1.0 twice | 1 source row, `self_confidence = 1.0` (idempotent). Objective counts unchanged (0/0/0/0). **PASS** |
| **D** — two prompts, same task | Rate `cc-1` = 1.0 and `cc-2` = 0.5, both mapped to Task I.G | Both source rows coexist independently (`cc-1: 1.0`, `cc-2: 0.5`). **PASS** |
| **E** — unequal prompt density | Task A: 10 ratings @ 1.0. Task B: 2 ratings @ 0.0 | Old formula: 83.33%. New formula (and `compute_readiness_snapshot()`'s live `confidence_score`): **50.00%** — density-independent. **PASS** |
| **Objective idempotency (regression)** | Same `module_quiz_question` source submitted 3x (`p_is_correct = true`) | `attempt_count = 1, correct_count = 1`, 1 source row — no double-count from the retry. **PASS** |
| **Determinism** | `compute_readiness_snapshot()` called 3x on identical evidence state | All 3 calls returned byte-identical `overall_score`/`coverage_score`/`knowledge_score`/`confidence_score`. **PASS** |
| **Evidence sufficiency (regression)** | 1/1 correct objective attempt | `evidence_score = 0.2000` — well below both the 0.6 "weak" and 0.8 "strong" thresholds; 1/1 correctly does not read as mature mastery. **PASS** |
| **Current-version snapshot selection** | Compared the fixed (`.eq(algorithm_version, 'v3')`) query against the old unfiltered query for every profile with any snapshot | 3 v1-only profiles: old query returned their stale v1 score as "current" (7.50/44.05/19.13); fixed query correctly returns **null** for all 3. 3 profiles with an actual v3 row: both queries agree. **PASS** |

## 10. Production Verification

All production interaction this patch required was either strictly read-only
(the version-decision snapshot audit in §5, the before/after query comparison in §6 and
§9's last row) or fully reversible test writes against one pre-existing disposable test
profile, using the same `set_config('request.jwt.claim.sub', ...)` + `set role
authenticated` role-simulation pattern established in Sprint 4.1 (no direct end-user
JWT is available in this environment). Every test write was explicitly cleaned up
(`delete` by exact `source_id`/`acs_task_id`, verified by a follow-up `count(*)` check)
before moving to the next test and again at the end of the full suite. No legitimate
historical `readiness_snapshots` row (v1 or v3, real-user or test) was deleted, rewritten,
or otherwise touched at any point — the only `readiness_snapshots` deletes issued were
scoped to `profile_id = '917c1b45-...'` and a tight recent-`created_at` window,
targeting only the rows this session's own `compute_readiness_snapshot()` test calls
had just inserted.

## 11. Remaining Limitations

- **`review_attempt_count`/`review_correct_count` guard is currently untested by real
  traffic.** The `v_source_was_new` gate that prevents a confidence re-rating from
  manufacturing review activity is defense-in-depth for a caller shape that doesn't
  exist today (every current confidence-only caller already passes `p_is_review =
  false`) — it's verified by code reading and by the general confidence-mutation tests
  above, not by a scenario that currently exercises `p_is_review = true` on a
  repeatable source.
- **No automated regression suite** covers `record_task_evidence_internal()` or
  `compute_readiness_snapshot()` — as with Sprint 4.1, all verification here is live
  production testing on disposable data, not a runnable test file future changes would
  automatically re-check. (Flagged, not fixed — building one would itself be new scope.)
- **Mobile has no client-side fallback if `latest` returns `snapshot: null` indefinitely**
  for a real user stuck on a pre-v3 snapshot with no new activity — they'd see "not yet
  assessed" until their next natural evidence-writing action. Given §5's evidence that no
  such real user currently exists in a meaningful way, this is a theoretical edge case
  today, not an active regression — but worth reconsidering if the app accumulates real
  v1/v2-only users before their next drill/quiz/review.

## 12. Merge Recommendation

**MERGE SPRINT 4 + 4.1**

All 9 merge-gate conditions are satisfied: confidence sources are mutable (Tests A-C);
objective-attempt idempotency is intact (regression test + Fix 1's WHERE-guard design);
confidence is normalized per ACS task, not prompt count (Test E, live 83.33%→50.00%
comparison); evidence sufficiency behavior is unchanged (regression test); current
readiness model version selection is now explicit on both web (already correct) and
mobile (fixed, both Edge Functions); the model-version decision is justified against
actual production snapshot data (§5, read-only audit); ownership/anon/grant security
tests pass; readiness remains deterministic (3x identical calls); and no Practice,
Ground School, Review Queue, AI DPE, Today at Apex, Training Report, or native-app
behavior was touched outside the two functions and two Edge Functions this patch
narrowly modifies.
