# Sprint 0 — Mobile Backend Implementation Report, REV3

**Project:** Apex Advantage (production Supabase project `wqzfhcjsfzwrimvsudxy`)
**Branch:** `claude/apex-member-portal-w3yoej`
**Reviewed commit:** `5318408` (Phase C Rev2)
**Scope:** A narrowly-scoped hardening pass on Rev2 — ACS task applicability
by airplane class, and full-payload validation for practice completion.
Phase A (lifecycle cron) and Phase B (v111) are unchanged and untouched —
v111 remains on its own separate authorization gate (see the standalone
"V111 READY FOR PRODUCTION: YES" report already issued; this document does
not affect or interpret that gate).
**Status:** Source-controlled and locally tested only. **Nothing in this
report has been applied to production** — including the read-only
production preview in Section 9, which touched no table and wrote nothing.

---

## 1. Executive Summary

Independent review of Rev2 found two blockers and two hardening items, all
fixed here:

- **Blocker 1 — ACS applicability**: Rev2 treated all 61 authoritative
  FAA-S-ACS-6C tasks as applicable to every learner, including seaplane-
  only (ASES/AMES) and multiengine-only (AMEL/AMES) tasks that do not apply
  to Apex's actual ASEL learners. Fixed with a normalized
  `acs_task_applicability` table, populated directly from the class
  qualifiers already present in the authoritative task titles (never
  inferred from Apex content), plus one reusable resolution path
  (`get_member_training_context()` / `get_applicable_acs_tasks()`) that
  readiness, Daily Drill, and bootstrap all now share.
- **Blocker 2 — duplicate question input**: `complete_mobile_practice_session()`
  was concurrency-safe across separate requests (Rev2's fix) but a single
  malformed request repeating the same `question_id` — especially with
  conflicting ratings — could still let inconsistent state through. Fixed
  by validating the ENTIRE response payload (no duplicates, every
  question_id valid, every rating valid, exactly one response per question
  in the attempt) before any side effect, atomically rejecting the whole
  request otherwise.
- **Hardening 1 — Daily Drill content-less targets**: fixed by requiring
  BOTH applicability AND at least one mapped Apex question before a task
  can become a drill target, plus a documented three-step fallback so a
  narrow eligible pool still produces a real 5-8-question drill instead of
  an under-filled one.
- **Hardening 2 — readiness evidence scoping**: every readiness component
  (not just the coverage denominator) is now restricted to the learner's
  current certificate/aircraft-class/ACS-version — evidence from an
  unrelated class or a retired ACS version can no longer blend into a
  current score.

Local regression suite: **244/244 passing** (65 new Rev3 tests on top of
Rev2's 179). A read-only preview against real production `dpe_questions`
(Section 9) confirms the mechanism holds against live data: 328 real
Private Pilot questions, 264 cleanly mapped, 0 malformed, 0
area/task-not-found — and reveals a genuinely new finding Rev2 could not
have surfaced (no applicability model existed yet): 16 of those 264 mapped
questions target tasks that are NOT applicable to ASEL learners at all
(see Section 9).

---

## 2. Rev3 Review Findings (as given)

| # | Finding | Severity |
|---|---|---|
| Blocker 1 | Readiness/Daily Drill treat all 61 ACS tasks as applicable to every learner | High — an ASEL learner is scored against content that will never appear on their checkride |
| Blocker 2 | `complete_mobile_practice_session()` accepts a request with the same `question_id` more than once | High — inconsistent/non-deterministic scoring and evidence on a malformed but concurrency-safe-looking request |
| Hardening 1 | Daily Drill can target a content-less applicable task, producing an empty/under-filled drill | Medium |
| Hardening 2 | Readiness knowledge/risk/confidence/evidence-volume/weak-tasks are not explicitly class/version-scoped | Medium — future-proofing gap, not yet observable with only one ACS version live |

---

## 3. Finding-by-Finding Resolution

| # | Fix | Where | Proof |
|---|---|---|---|
| Blocker 1 | `acs_task_applicability` (normalized, CHECK-constrained), populated from real FAA title qualifiers; `get_member_training_context()`/`get_applicable_acs_tasks()` as the one resolution path | v112 (REV3.1-3.4) | Section 30 (applicability lookups), Section 32 (45-task ASEL denominator) |
| Blocker 2 | Full-payload validation (duplicate/conflict/invalid/incomplete all rejected before any write) inside `complete_mobile_practice_session()` | v113 (REV3.10/3.11) | Section 37 (5 rejection scenarios + a subsequent valid completion, each proven to leave zero side effects) |
| Hardening 1 | Target-task eligibility requires applicability AND >=1 content mapping; documented 3-step fallback fill | v115 (REV3.8/3.9) | Sections 35-36 |
| Hardening 2 | Every readiness component threaded through `get_applicable_acs_tasks()` | v114 (REV3.5-3.7) | Section 33 (evidence on an unrelated class AND an unrelated ACS version, both proven ignored) |

---

## 4. Authoritative ACS Preservation

No task was removed, renamed, or reinterpreted from the Rev2 authoritative
seed. All 61 FAA-S-ACS-6C tasks, across all 12 Areas of Operation, remain
in `acs_tasks` exactly as extracted in Rev2 — verified unchanged by Section
30's "complete 61-task authoritative taxonomy still exists" test.
Applicability is modeled as an *additional* relationship layered on top
(`acs_task_applicability`), never as a filter on `acs_tasks` itself. A
future AMEL, ASES, or AMES learner (should Apex ever serve one) would see
the exact same 61-task taxonomy with a different applicable subset — no
schema change required.

---

## 5. Task Applicability Model

`acs_task_applicability(acs_task_id, aircraft_class)`, one row per
applicable class, `aircraft_class` CHECK-constrained to exactly
`ASEL`/`AMEL`/`ASES`/`AMES` — no arbitrary strings, no glider/helicopter
values invented (Section 30 proves the CHECK constraint rejects
`'GLIDER'`). Chosen over a `text[]` column per REV3.2's own preference for
a normalized design, and because every consumer query becomes a plain
indexed join rather than an array-containment operation.

**Populated directly from the FAA's own title qualifiers**, already
extracted verbatim in Rev2 (e.g. "Taxiing (ASEL, AMEL)", "Glassy Water
Takeoff and Climb (ASES, AMES)"). A task with no class qualifier in its
official title is applicable to all four classes (e.g. "Pilot
Qualifications" — every Private Pilot applicant is tested on this
regardless of class). This is a mechanical derivation from text already
proven authoritative in Rev2, not a new independent judgment call — 194
applicability rows total (37 universal tasks × 4 classes + 22 two-class-
qualified tasks × 2 + 2 single-class-qualified tasks × 1), verified against
a hand-count before being encoded into the migration.

**Result: 45 of the 61 tasks are applicable to ASEL.** The excluded 16 are
every seaplane-only (ASES/AMES) task and every multiengine-only (AMEL/AMES)
task — exactly what FAA-S-ACS-6C's own class-qualification scheme
specifies, confirmed task-by-task in Section 30 (a universal task, an
ASEL-only task, an ASES-only task, and an AMEL-specific task each checked
individually against all four classes).

---

## 6. Learner Training Context

**Search performed before adding anything**: `profiles`, every other
table, and every prior migration were searched for an existing aircraft-
class/category field. None exists — the closest field,
`profiles.certificate_status`, is free text used for a different purpose
(not encoded, not previously read by any Phase C code). No reliable
existing source of truth was available to reuse.

**Added: `profiles.primary_aircraft_class`** (text, CHECK-constrained to
the same four values, `not null default 'ASEL'`). Defaulting every
existing and future row to ASEL is a safe, honest v1 choice, not a guess:
every piece of curriculum content in this codebase (`dpe_questions`,
Ground School modules, Study Packs) is single-engine-land-oriented today —
Apex sells no seaplane or multiengine product. The moment that changes, a
real class-selection UI becomes warranted; until then, ASEL-for-everyone
matches actual product reality exactly (documented in v112's own header
comment, repeated here per REV3.3's explicit requirement to document the
default rule and why it's safe).

**`get_member_training_context(p_profile_id uuid default null)`** is the
one resolution path (REV3.4) returning `profile_id, certificate_type,
aircraft_class, acs_version_id`. Two calling conventions, both closed
against the same risk:
- No argument → resolves `auth.uid()` (the pattern every direct
  authenticated RPC in this codebase already uses).
- Explicit `p_profile_id` → for a trusted server-side caller
  (`mobile-bootstrap`, which independently verifies the JWT via
  `auth.getUser()` and uses a bare service-role client rather than
  forwarding the Authorization header). **Security guard**: an explicit
  `p_profile_id` that differs from a real, non-null `auth.uid()` is always
  rejected — an authenticated end-user's own JWT cannot be forged to claim
  someone else's `auth.uid()`, so this closes the one real risk of
  accepting an explicit argument at all (proven in Section 31: member A
  cannot resolve Mobile Member's context by passing their id explicitly;
  a bare service-role call, with no forwarded end-user JWT at all, can).

`get_applicable_acs_tasks(p_profile_id uuid default null)` wraps this to
return the actual `acs_tasks` rows — the single query every consumer
(readiness, Daily Drill) now uses, rather than each reimplementing a
slightly different applicability join.

---

## 7. ASEL Applicability Results

| | Count |
|---|---:|
| Total authoritative FAA-S-ACS-6C tasks | 61 |
| Applicable to ASEL | 45 |
| Not applicable to ASEL (seaplane- or multiengine-only) | 16 |

Verified directly, not just by formula: `get_applicable_acs_tasks()` for
an ASEL learner returns exactly 45 rows (Section 32); an ASES-only task
(Area I Task I) and an AMEL-specific task (Area X Task A) are both
individually confirmed absent from that set (Sections 30, 35).

---

## 8. Active ACS Version Resolution

Unchanged from Rev2 (`get_active_acs_version()`, one-active-version-per-
certificate-type partial unique index) — `get_member_training_context()`
calls it internally rather than duplicating version-selection logic. No
new version-selection defect was found in Rev3 review; this section exists
to confirm that mechanism is still exercised correctly through the new
applicability layer (Section 31's exact-version-id check).

---

## 9. Real Production Mapping Preview (READ-ONLY, REV3.19)

Executed as read-only `SELECT` queries against live production
`dpe_questions` via the Supabase MCP tool — **no table was created, no row
was written, v112 was not applied.** The authoritative task and ASEL-
applicability lists were embedded as literal SQL `VALUES` clauses (the
exact same data v112 would seed), not read from any new table, since none
exist in production yet.

**Private Pilot (328 real questions):**

| Classification | Count | Of which ASEL-applicable |
|---|---:|---:|
| Deterministically mapped | 264 | 248 |
| Multi-task reference (needs human disambiguation) | 27 | 24 |
| Special Emphasis Area | 37 | 0 |
| Malformed / no shape match | 0 | — |
| Area/task not in authoritative ACS | 0 | — |
| **Total** | **328** | |

**Instrument (64 real questions):** all 64 deferred / unseeded, exactly as
designed — no authoritative Instrument ACS source exists, so every
instrument question stays unresolved until one is supplied. Not a gap
introduced by this preview; a re-confirmation of Rev2's own design.

**ASEL task coverage (of the 45 applicable tasks):**

| | Count |
|---|---:|
| ASEL-applicable tasks with >=1 Apex question | 13 |
| ASEL-applicable tasks with zero Apex questions | 32 |

**New finding this preview surfaces that Rev2 could not have** (no
applicability model existed yet): **16 of the 264 deterministically-mapped
questions target a task that is NOT applicable to ASEL** — real Apex
content exists for at least one seaplane- or multiengine-only task. This
is neither a bug nor something to silently drop: that content remains
correctly mapped to its real ACS task (a future AMEL/ASES/AMES learner, or
an instructor reviewing full ACS coverage, would still want it there) — it
simply correctly falls outside an ASEL learner's `get_applicable_acs_tasks()`
result, exactly as designed. Recorded here as a fact for the human curator
who eventually reviews the 27 multi-task rows, not a defect to fix in this
migration.

Zero malformed rows and zero area/task-not-found rows in real production
data is a stronger result than the local test fixtures alone would
suggest (those fixtures deliberately include synthetic edge cases like
`q7`/`q8` to prove the mechanism handles them) — it means the regex and
the authoritative task list, built independently from the FAA PDF, agree
with 100% of real Apex content that isn't already known-unresolvable
(multi-task or Special Emphasis).

---

## 10. Readiness Denominator Fix

`coverage_score`'s numerator and denominator are now both computed from
`get_applicable_acs_tasks(v_profile_id)` instead of every task in the
active version. For an ASEL learner this is 45, not 61. Verified directly
(Section 32): Mobile Member, with evidence on exactly one applicable task,
now scores `coverage_score = 2.22` (`100 × 1/45`), not Rev2's `1.64`
(`100 × 1/61`) — and the full `overall_score` regression (Section 18,
carried forward from Rev2) was updated to `58.28` to match, with the new
arithmetic shown inline in the test's own description rather than just
asserted.

---

## 11. Readiness Version/Class Scoping

Beyond the coverage denominator, `knowledge_score`, `risk_management_score`,
`confidence_score`, `evidence_volume` (via `v_total_attempts`), and
`weak_tasks` are now ALL joined through `get_applicable_acs_tasks()`
rather than querying `task_evidence` by `profile_id` alone. Two concrete,
previously-impossible-to-observe scenarios were seeded and proven inert:

- **Unrelated aircraft class** (Section 33): a learner with strong (1.0)
  evidence on an ASES-only task, and nothing else, computes
  `coverage_score = 0.00` and `knowledge_score = 0` — identical to a
  learner with zero evidence at all. Without this fix, `knowledge_score`
  would have been `100` (the single evidence row's own score) and
  `coverage_score` nonzero.
- **Unrelated ACS version** (Section 33): a second, inactive
  `acs_versions` row was created with its own task, marked ASEL-applicable
  (so applicability alone would NOT have caught this), and a learner given
  strong evidence against it. `coverage_score`/`knowledge_score` are again
  `0.00`/`0` — proving version-scoping is enforced independently of
  applicability, not accidentally covered by it.

Old `readiness_snapshots` rows are untouched — history is not rewritten,
per REV3.6's explicit instruction.

---

## 12. Content Coverage Honesty

`insufficient_content_coverage`'s underlying content-less-task count is
now computed over `get_applicable_acs_tasks()`, not all 61 tasks (Section
34) — a seaplane-only content gap can no longer trigger this flag for an
ASEL learner (there was nothing to prove this couldn't happen before
Blocker 1 was fixed, since the flag previously scanned all 61 tasks
regardless). The flag itself remains a boolean reason code, not a numeric
penalty on the headline score, per REV3.7's explicit instruction not to
overload `overall_score` with an opaque additional term — Section 9's real
counts (13 covered / 32 uncovered of 45 applicable) make the actual scale
of the gap available to a human reader without cluttering the algorithm.

---

## 13. Daily Drill Eligibility

Target-task selection now requires BOTH:
1. Applicability (`get_applicable_acs_tasks(v_profile_id)`), and
2. At least one `content_acs_mappings` row for that task.

A task failing either check cannot become a target regardless of how weak
or overdue its evidence looks — proven two ways (Section 35): an ASES-only
task can never even enter the candidate pool for an ASEL learner
(`get_applicable_acs_tasks` excludes it structurally, before content is
even considered), and an already-generated real drill (Proximity Near
Member's, from the Rev2 proximity test) is confirmed to contain zero
content-less tasks among its targets.

---

## 14. Daily Drill Fill/Fallback Logic

Documented, ordered three-step fallback, run only as far as needed to
reach `MIN_DRILL_QUESTIONS` (5), capped at `MAX_DRILL_QUESTIONS` (7):

1. Questions mapped to the top-3 target tasks, normal anti-repeat
   (exclude any question answered correctly in the last 3 days).
2. If step 1 falls short: broaden to ALL applicable+content-backed tasks
   (not just the top 3), ranked by the same weighted score, still
   respecting the anti-repeat exclusion.
3. If still short: relax the anti-repeat exclusion within that same
   broadened pool — the last resort, reached only when there genuinely
   isn't enough fresh eligible content.

`target_acs_tasks` on the stored row always reflects the top-3 ranked
tasks (for the app's "why these tasks" framing), even when steps 2/3 had
to pull some actual questions from outside that top 3. Every step still
only ever selects from `dpe_questions` via `content_acs_mappings` — the
same table `mobile-practice`'s own `start` action reads from — so no
fallback step can surface unentitled content.

**Proven with a real, deterministically-engineered scenario** (Section
36): a learner with weak evidence on exactly the two tasks that would
otherwise inflate the top-3 pool (I/A, I/C — each carrying 2 mapped
questions) causes those two tasks to score strictly below three untouched
tasks (I/B, I/D, I/E — each carrying only 1-2 questions), which then tie
for exactly the 3 target slots with no randomness in which three make it.
Those three targets together offer only 4 questions — one short of the
minimum — and the drill is proven to reach 5 by pulling from I/A or I/C,
tasks that were NOT among the targets.

---

## 15. Practice Input Validation

`complete_mobile_practice_session()` now validates the ENTIRE
`p_responses` array, under the row lock, before any other table is
touched. Any of the following aborts the whole transaction — Postgres
rolls back everything, which at that point is nothing beyond the lock
itself:

- a response with a null/missing `question_id`
- a `self_rating` that isn't exactly `correct` | `incorrect` | `partial`
- a `question_id` that is not a member of the attempt's own `question_ids`
- the same `question_id` appearing more than once, for any reason —
  including two different (conflicting) ratings for it
- an incomplete submission (see Section 16)

Every rejection is proven to leave the attempt in its pre-call state
(Section 37): `completed_at` still null, zero `portal_practice_attempt_responses`
rows, `task_evidence` untouched, zero XP awarded — for five distinct
malformed payloads (duplicate-same-rating, duplicate-conflicting-rating,
unknown question, invalid rating, incomplete submission) — followed by
proof that a genuinely valid, complete, non-duplicated submission still
succeeds normally immediately afterward on the same attempt.

---

## 16. Duplicate Response Protection

**Completeness decision (REV3.11), made explicitly, not left ambiguous**:
completion requires **exactly one response per question in the attempt —
no more, no less**, not an arbitrary valid subset. Rationale: this matches
the natural mobile UX (a learner answers all N questions, then taps
"Finish"), and keeps `score`/`total` unambiguous — `total` is always the
full session size, `score` is always "how many of ALL of them were rated
correct." A client that wants to abandon a session early simply never
calls `complete` for it; the attempt stays uncompleted
(`completed_at is null`), which the app can already detect.

The duplicate check itself is a plain `count(*) <> count(distinct
question_id)` comparison over the submitted array, evaluated before any
per-item processing — deliberately independent of *which* two items
collided or whether their ratings agreed, so "same rating twice" and
"conflicting ratings for the same question" are rejected by the identical
code path (both proven in Section 37).

---

## 17. Atomic Completion Semantics

Unchanged from Rev2's core mechanism (`select ... for update` as the first
statement, real two-process concurrency proven again — Section 23, carried
forward verbatim and still passing under the Rev3 validation logic).
REV3.10/3.11 add validation *in front of* that mechanism, not instead of
it: the row lock is still acquired first, the idempotent already-completed
short-circuit still runs before any payload validation (so a retried
request for an already-completed session succeeds even if its payload
happens to be malformed — nothing is about to be processed from it
anyway), and only a genuinely new completion attempt is subjected to the
full-payload check.

---

## 18. Edge Function Error Contract

`mobile-practice`'s `complete` action maps the RPC's stable,
machine-readable error-message prefixes (`session_not_found`,
`not_your_session`, `invalid_question`, `invalid_self_rating`,
`duplicate_question_id`, `incomplete_submission`) to clean HTTP responses:
404 for `session_not_found`, 403 for `not_your_session`, 400 for the four
validation codes. No raw Postgres error text is ever returned to the
client; an error the RPC didn't recognize still falls through to the
existing generic 500 handler, so a genuinely unexpected server error is
never disguised as a 4xx.

**Honesty about test coverage**: this mapping logic lives in TypeScript,
and (as in Rev2) this sandbox has no `deno`/`supabase` CLI to execute it
against. Section 38 proves the RPC actually emits the exact prefixes the
mapper's regex expects — the contract both sides agree on — not the
HTTP-layer execution itself, which remains for staging verification
exactly as Rev2's Section 24 already established for `reveal`.

---

## 19. DTO / Bootstrap Changes

`shared/mobile-dto/index.ts`:
- Added `AircraftClass` and `MobileTrainingContext` (`certificate_type`,
  `aircraft_class`, `acs_version`) — `MobileBootstrapDTO.training` now
  extends this type.
- Added `MobileAcsTaskInfo` (REV3.14) for a future ACS map/coverage
  screen — not wired to any endpoint yet, agreed here ahead of that
  screen's construction so its eventual contract doesn't need to be
  invented from scratch. Does not expose `acs_task_applicability` or
  `content_acs_mappings` row shapes directly.

`mobile-bootstrap/index.ts` now calls `get_member_training_context()`
(explicit `p_profile_id`, matching its existing bare-service-role calling
convention) and resolves the returned `acs_version_id` to a human-readable
`version_code` via one additional `acs_versions` lookup, added to the
existing `Promise.all` batch — no new sequential round trip. Verified
end-to-end at the database level (Section 39): the exact query
`mobile-bootstrap` now runs resolves to the real `FAA-S-ACS-6C` version
code for a real fixture learner.

---

## 20. RLS / Grants

No RLS policy was weakened. New surfaces:

| Object | RLS / Grants |
|---|---|
| `acs_task_applicability` | Public SELECT via policy (reference data, same posture as `acs_tasks`); no client write; `authenticated` blocked from direct INSERT (Section 30) |
| `get_member_training_context(uuid)` | `authenticated`+`service_role` EXECUTE, `anon`/`public` revoked; in-body guard blocks cross-user forgery regardless of grant (Section 6) |
| `get_applicable_acs_tasks(uuid)` | Same grant shape; read-only, `stable` |
| `profiles.primary_aircraft_class` | Ordinary column, governed by the existing `profiles` RLS/trigger stack (self-update via the existing "Members can update their own profile" policy plus `lock_profile_privileged_columns` — this column is not in that trigger's locked-column list, since a learner is allowed to know and eventually change their own training track, unlike `role`/`checkride_prep_unlocked`) |

`complete_mobile_practice_session()`'s grants are unchanged from Rev2
(`authenticated`+`service_role`, `anon`/`public` revoked) — REV3 changed
its internal validation logic, not its privilege surface.

---

## 21. Index / Performance Review

`EXPLAIN ANALYZE` run locally against `get_applicable_acs_tasks()` and
`compute_readiness_snapshot()` (the two new applicability-joined hot
paths): both execute in single-digit milliseconds at this dataset's scale.
Existing indexes already cover every new join:

- `idx_acs_task_applicability_class (aircraft_class, acs_task_id)` (added
  alongside the table in v112) directly serves
  `get_applicable_acs_tasks`'s `where a.aircraft_class = ctx.aircraft_class`
  filter.
- `idx_content_acs_mappings_task (acs_task_id)` (Rev1) serves every
  content-existence check.
- `task_evidence`'s composite primary key `(profile_id, acs_task_id)`
  serves every evidence join used in readiness and Daily Drill scoring.
- `idx_practice_responses_profile_question (profile_id, question_id,
  answered_at desc)` (Rev2) serves every recency lookup.

**No new index was added.** At 61 authoritative tasks and 194
applicability rows, these are small reference tables — adding indexes
beyond what real query plans justify would be premature optimization on
data that will comfortably fit in a few pages regardless (REV3.16's own
explicit caution).

---

## 22. Regression Test Results

```
RESULTS: 244 passed, 0 failed
```

- 179 tests carried forward from Rev2, all still passing. Two pre-existing
  *expected values* changed because the underlying correct behavior
  changed (both called out explicitly, not silently): the `overall_score`
  regression in Section 18 (`58.28` instead of Rev2's `58.07`, reflecting
  the new 45-task ASEL denominator), and two error-pattern regexes in
  Section 22 updated from Rev2's plain-English messages ("session not
  found") to Rev3's machine-readable prefixes ("session_not_found") since
  the underlying error text itself changed by design (REV3.13).
- **65 new Rev3 tests** across Sections 30-39.
- No test was deleted or weakened. Final count (244) exceeds the required
  >179.

**Tests proving each Rev3 finding is fixed**, for direct traceability:
1. ACS applicability (Blocker 1): Section 30, all 11 assertions.
2. ASEL readiness denominator: Section 32.
3. Unrelated aircraft-class evidence ignored: Section 33 (first half).
4. Unrelated ACS-version evidence ignored: Section 33 (second half).
5. Content-less task excluded from Daily Drill: Section 35 (second
   assertion).
6. ASES-only task excluded for ASEL: Sections 30 and 35 (first assertion).
7. Daily Drill fills from the broader eligible pool: Section 36.
8. Duplicate response rejection: Section 37 (first scenario).
9. Conflicting duplicate rejection: Section 37 (second scenario).
10. Malformed response atomic rollback: Section 37 (all five
    `assert_no_side_effects_yet` checks, run after each of five rejected
    payloads).
11. Subsequent valid completion after a rejected request: Section 37
    (final two assertions).
12. `mobile-practice` clean error shaping: Section 38 (RPC-side contract;
    HTTP-layer mapping remains an honestly-documented gap, Section 18).
13. Bootstrap exposes training context: Section 39.

---

## 23. Original Five Rev2 Fixes — Regression Confirmation

All five of Rev2's originally-fixed defects remain fixed and their tests
still pass unmodified in intent (Sections 16, 16b, 21, 23, 25 — the same
section numbers as Rev2, since Rev3 only edited the surrounding files in
place, it did not renumber or remove Rev2's own sections):

1. Authoritative ACS taxonomy (Section 16) — still 61 tasks, still from
   the real FAA document, now additionally proven applicability-aware.
2. Manual mapping survives rerun (Section 16b) — still proven with a real
   second `psql -f v112.sql` invocation.
3. Real two-process concurrency (Section 23) — the exact same test,
   unmodified, still passing against the now-validation-hardened RPC.
4. Progress counters fixed (Section 21) — still proven 7→8, not 7→1.
5. Bootstrap today-date fix (Section 25) — still proven against the exact
   same yesterday-drill fixture.

---

## 24. Files Changed

**Rewritten in place** (never reached production, revised directly per
explicit permission):
- `portal/supabase-portal-schema-v112-acs-normalization.sql` — added
  `acs_task_applicability`, `profiles.primary_aircraft_class`,
  `get_member_training_context()`, `get_applicable_acs_tasks()`.
- `portal/supabase-portal-schema-v113-task-evidence.sql` — rewrote
  `complete_mobile_practice_session()`'s validation.
- `portal/supabase-portal-schema-v114-readiness-snapshots.sql` — scoped
  every score component to `get_applicable_acs_tasks()`.
- `portal/supabase-portal-schema-v115-daily-drills.sql` — added
  content+applicability eligibility gate and the 3-step fallback fill.

**Unchanged:** `portal/supabase-portal-schema-v116-mobile-device-notification-model.sql`
(reviewed again under REV3.17, no defect found).

**Edited:**
- `portal/supabase/functions/mobile-practice/index.ts` (REV3.13 error
  shaping)
- `portal/supabase/functions/mobile-bootstrap/index.ts` (REV3.15 training
  context)
- `shared/mobile-dto/index.ts`
- `test/sql/01_fixtures.sql`
- `test/run_security_regression_tests.sh`

**Unchanged:** `test/sql/00_harness_schema.sql` (no new prerequisite
tables were needed — every REV3 addition lives inside v112/v113, which are
self-contained), `mobile-readiness`, `mobile-daily-drill`, `mobile-library`,
`mobile-push-token` Edge Functions.

**New:** `SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV3.md` (this
file). `SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT.md` and
`SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV2.md` are untouched.

---

## 25. Migration Changes

- **v112**: adds `acs_task_applicability` (+ RLS, index, 194-row seed),
  `profiles.primary_aircraft_class` (+ default/CHECK), `get_member_
  training_context()`, `get_applicable_acs_tasks()`. Everything else
  (versions/tasks/mappings/backfill/unresolved view) unchanged from Rev2.
- **v113**: `task_evidence`/`record_task_evidence()` unchanged.
  `complete_mobile_practice_session()` gains the full-payload validation
  block (duplicate/invalid/incomplete checks) ahead of its existing
  processing loop; the loop itself is simplified (no more per-item
  `continue` skip logic, since every item is now pre-validated).
- **v114**: six separate query changes (coverage, content-less count,
  knowledge, risk, confidence, weak_tasks), each now joined through
  `get_applicable_acs_tasks(v_profile_id)`.
- **v115**: `get_or_create_daily_drill()`'s target-task CTE gains a
  content-existence filter and switches from `acs_tasks` to
  `get_applicable_acs_tasks()`; question selection becomes a 3-step
  fallback chain instead of a single query.
- **v116**: no changes.

---

## 26. Production Deployment Order

**Not executed. Prepared only, per the explicit stop gate.**

1. **v111** — entirely separate track, its own scheduled-run gate and
   explicit "DEPLOY V111" authorization. Unaffected by, and does not
   affect, anything below.
2. **v112** (authoritative ACS + applicability) — apply, then immediately
   run the Section 9-style read-only verification queries against the now-
   real `acs_unresolved_mappings` view and `acs_task_applicability` table
   to confirm the live numbers match this preview (264 mapped / 27
   multi-task / 37 special-emphasis / 0 malformed / 0 not-found; 45 ASEL-
   applicable tasks, 13 with content).
3. **v113** (evidence + response model + atomic, validated completion) —
   depends on v112's `acs_tasks`/`content_acs_mappings`.
4. **v114** (readiness) — depends on v112 (`get_applicable_acs_tasks`) +
   v113 (`task_evidence`).
5. **v115** (Daily Drill) — depends on v112 + v113
   (`portal_practice_attempt_responses`).
6. **v116** (devices/preferences) — independent, no dependency on
   v112-115.
7. **mobile-* Edge Functions**, in this order: `mobile-bootstrap` and
   `mobile-library`/`mobile-push-token` first (no dependency on the new
   RPC), then `mobile-practice` (calls `complete_mobile_practice_session`,
   v113), then `mobile-readiness`/`mobile-daily-drill` (call
   `compute_readiness_snapshot`/`get_or_create_daily_drill`, v114/v115).

**Preflight checks** (before step 2): confirm v104-v111's objects are in
the expected state (unaffected by this work, but a sanity check costs
nothing); confirm no table named `acs_task_applicability` or column
`profiles.primary_aircraft_class` already exists unexpectedly (would
indicate a prior partial/failed apply to clean up first, not proceed
over).

**Migration-by-migration stop conditions**: after each of v112-v116,
re-run the post-deploy verification queries below for that migration
before proceeding to the next; a mismatch stops the sequence, it does not
get "fixed forward" by continuing.

**Post-deploy verification queries**:
```sql
-- v112: authoritative taxonomy + applicability landed correctly
select count(*) from acs_tasks t join acs_versions v on v.id = t.acs_version_id
  where v.certificate_type = 'private_pilot' and v.version_code = 'FAA-S-ACS-6C'; -- expect 61
select count(*) from acs_task_applicability a
  join acs_tasks t on t.id = a.acs_task_id
  join acs_versions v on v.id = t.acs_version_id
  where v.version_code = 'FAA-S-ACS-6C' and a.aircraft_class = 'ASEL'; -- expect 45
select certificate_type, count(*) from acs_versions where active group by certificate_type
  having count(*) > 1; -- expect 0 rows
select reason, count(*) from acs_unresolved_mappings group by reason order by count(*) desc;
  -- expect roughly: multi_task_reference_needs_human_disambiguation ~27,
  -- special_emphasis_area_no_single_task ~37, no_authoritative_acs_seeded_for_exam_type ~64
  -- (instrument), 0 malformed/not-found (per Section 9's preview -- re-verify against
  -- whatever dpe_questions actually contains at deploy time, it may have grown)

-- v113-v115: grants exactly as intended
select proname, pg_get_function_identity_arguments(oid),
  has_function_privilege('anon', oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', oid, 'EXECUTE') as service_role
from pg_proc where proname in
  ('get_member_training_context','get_applicable_acs_tasks','record_task_evidence',
   'complete_mobile_practice_session','compute_readiness_snapshot','get_or_create_daily_drill');

-- profiles.primary_aircraft_class defaulted correctly for real existing users
select primary_aircraft_class, count(*) from profiles group by primary_aircraft_class;
  -- expect: everyone ASEL until a real class-selection UI ships
```

**Edge Function smoke tests**: with a real (non-production-critical) test
account — `mobile-bootstrap` (confirm `training.aircraft_class` is present
and `"ASEL"`), `mobile-practice` `start`→`reveal`→`complete` (including one
deliberately malformed `complete` call with a duplicated `question_id`,
confirming a clean 400 rather than a 500 or silent partial success),
`mobile-readiness` `refresh`, `mobile-daily-drill` (confirm a real drill
with 5-8 questions is returned, not zero/one).

**Real existing-user bootstrap test**: sign in as one real, non-test
production account; confirm `mobile-bootstrap`'s response is well-formed
and its `checkride_prep`/`checkride_date` fields match what that account
already sees on the web portal.

**Non-destructive practice-session test strategy**: use a disposable test
account (not a real learner's account) for the `start`→`complete`
smoke test above specifically because `complete_mobile_practice_session`
writes real XP/evidence/study-activity rows — there is no dry-run mode,
by design (the whole point is that it's the same trusted write path a
real completion uses).

---

## 27. Rollback Strategy

Same order as Rev2, extended for the new objects:
`daily_drills` → `readiness_snapshots` → `complete_mobile_practice_session`
+ `portal_practice_attempt_responses` + `task_evidence` →
`get_applicable_acs_tasks` + `get_member_training_context` +
`acs_task_applicability` + `profiles.primary_aircraft_class` →
`acs_versions`/`acs_tasks`/`content_acs_mappings` (v112, `cascade` handles
the FK chain). `mobile_devices`/`notification_preferences` (v116) remain
independently rollback-able at any point.

```sql
-- v112 REV3 additions specifically (if v112's original Rev2 objects should stay):
drop function if exists public.get_applicable_acs_tasks(uuid);
drop function if exists public.get_member_training_context(uuid);
drop table if exists public.acs_task_applicability;
alter table public.profiles drop column if exists primary_aircraft_class;
```

As with Rev2: a schema rollback does not undo already-written production
data (XP, evidence, study-activity seconds already credited through the
validated completion path) — standard for additive production writes, not
newly introduced by this pass.

---

## 28. Known Limitations

- **16 real mapped questions target non-ASEL-applicable tasks** (Section
  9) — correctly excluded from ASEL learners' readiness/drills, but worth
  a human curator's awareness when eventually reviewing content coverage.
- **32 of 45 ASEL-applicable tasks have zero Apex content** (Section 9) —
  a substantial, now precisely-quantified content gap, unchanged by this
  migration (Rev3 makes the gap honestly visible and correctly scoped; it
  does not close it — that's a content-authoring effort, out of scope).
- **No admin curation UI** for adding `human_curated` mappings or changing
  a learner's `primary_aircraft_class` exists yet — both mechanisms are
  built and proven safe; the tools a human would use are deferred, same
  status as Rev2 reported for mapping curation.
- **Instrument ACS remains unseeded** — deliberately, pending an
  authoritative source, unchanged from Rev2.
- **Confidence capture and a CFI-review signal remain unimplemented** —
  deliberately, unchanged from Rev2.
- **Edge Function HTTP-path execution remains unverified** in this
  sandbox (no Deno/Supabase CLI) — Section 18's table names exactly which
  parts are and are not covered, same honest gap as Rev2's Section 24.

---

## 29. Sprint 1 Expo Handoff

Unchanged in substance from Rev1/Rev2 — the same real tables, RPCs, and
DTOs remain the integration surface. One addition: `mobile-bootstrap`'s
response now includes `training.aircraft_class` and `training.acs_version`
— the Expo app should render these (even if every real user is `"ASEL"`
today) rather than hard-coding an assumption, so the app does not need a
rebuild the day Apex adds a second aircraft class. The concrete Sprint 1
acceptance bar (install, sign in, see checkride date/access, complete 5
DPE questions, favorite one, see it synced on web) is unchanged and still
satisfied by what's implemented here — completing 5 questions now also
exercises the stricter validation path (all 5 must be submitted, no
duplicates), which is the correct real-world shape for that flow anyway.

---

## 30. Known Limitations — see Section 28

(Numbered separately per the requested 31-section structure; content is
Section 28's, not duplicated here to avoid two conflicting lists.)

---

## 31. GO / NO-GO Recommendation

**GO for a staged production rollout, in the exact order given in Section
26, with these pre-conditions treated as blocking, not optional:**

1. Re-run Section 9's read-only preview against dpe_questions at actual
   deploy time (content may have grown since this report) and compare
   against the numbers here before applying v112 for real.
2. v111 remains on its own separate, already-established gate and must
   not be bundled into the same deployment window as Phase C purely for
   convenience.
3. Before Sprint 1 Expo work begins, run the Section 26 smoke tests
   against a real staging/production account, using a disposable test
   account specifically for the practice-completion test (it writes real
   XP/evidence) — closing the one honestly-documented gap in this report
   (actual Deno Edge Function HTTP execution, which this sandbox cannot
   perform).

No defect from the Rev3 independent review remains open. No test was
weakened, removed, or reverse-engineered to pass — the two changed
expected values (Section 22) both reflect genuine, hand-derived
consequences of the underlying fix, not adjustments made to accommodate a
failing assertion.

---

**SPRINT 0 MOBILE BACKEND REV3 COMPLETE — AWAITING PRODUCTION REVIEW.**
