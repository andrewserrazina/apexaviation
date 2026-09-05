# Sprint 0 — Mobile Backend Implementation Report, REV2

**Project:** Apex Advantage (production Supabase project `wqzfhcjsfzwrimvsudxy`)
**Branch:** `claude/apex-member-portal-w3yoej`
**Reviewed commit:** `448978fe9b4c86dd24518eb4dd5a42d4587f6d71` (original Phase C)
**Scope:** A review-driven hardening pass on Phase C only. Phase A (lifecycle
cron) and Phase B (v111) are unchanged and untouched by this document — see
`SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT.md` (the original, not
overwritten) for those.
**Status:** Source-controlled and locally tested only. **Nothing in this
report has been applied to production.**

---

## 1. Executive Summary

Independent review of the original Phase C implementation found five
significant defects and a set of smaller design gaps. This pass fixes all
of them:

1. The ACS taxonomy was derived from Apex's own question content instead
   of the authoritative FAA source — **fixed**: the complete 61-task
   FAA-S-ACS-6C taxonomy is now seeded directly from the attached
   authoritative PDF, extracted with `pdftotext`, never inferred from
   `dpe_questions`.
2. Re-running the v112 backfill could delete manually-curated ACS
   mappings — **fixed**: explicit `mapping_source` provenance, and the
   backfill now deletes/regenerates only the rows it itself created.
3. Mobile practice completion was sequentially idempotent but not
   concurrency-safe — **fixed**: a single atomic
   `complete_mobile_practice_session()` RPC with a `select ... for update`
   row lock, proven with a real two-process concurrency test, not a
   sequential retry.
4. `portal_question_progress.answered_count` could be reset to 1 by the
   completion upsert instead of incrementing — **fixed**, with a test that
   proves 7 → 8, not 7 → 1.
5. `mobile-bootstrap` could return a stale drill and label it "today's" —
   **fixed**: exact-date match against `member_local_date()`, with a test
   that proves the old query shape would have failed and the new one
   doesn't.

The daily drill algorithm was also substantially improved (checkride-date
proximity weighting, real per-question recency instead of a `completed`
proxy, a light favorites signal), and the answer-reveal contract (question
→ self-answer → reveal → self-rate) was completed. Every change is
source-controlled, locally regression-tested (179/179 passing, 49 new
tests), and **not deployed**.

---

## 2. Independent Review Findings (as given)

| # | Finding | Severity |
|---|---|---|
| 1 | ACS taxonomy derived from Apex content, not the authoritative FAA ACS | High — inverts the intended coverage denominator |
| 2 | v112 rerun could delete manually-curated mappings | High — silent data loss on a routine operation |
| 3 | mobile-practice completion not concurrency-safe | High — double XP/evidence/progress on a real race |
| 4 | `answered_count` upsert bug | Medium — silently corrupts existing progress data |
| 5 | mobile-bootstrap stale-drill bug | Medium — wrong "today" shown to the learner |
| — | Daily drill v1 inputs incomplete / recency proxy wrong | Medium |
| — | No answer-reveal contract | Medium — product requirement gap |

---

## 3. Finding-by-Finding Resolution

| # | Fix | Where | Proof |
|---|---|---|---|
| 1 | Authoritative FAA-S-ACS-6C seed, 61 tasks, 12 Areas of Operation, extracted verbatim from the attached PDF | v112 (rewritten) | Section 16 tests: task count, area count, content-less task still present |
| 2 | `mapping_source` provenance (`deterministic_backfill` \| `human_curated`); backfill deletes only its own rows | v112 (rewritten) | Section 16b: manual mapping survives a real second `psql -f v112.sql` run |
| 3 | `complete_mobile_practice_session()`, `select ... for update`, one atomic transaction | v113 (rewritten) | Section 23: two real concurrent `psql` processes racing the same attempt |
| 4 | `answered_count = answered_count + 1` on conflict, other fields left alone | v113 (`complete_mobile_practice_session`) | Section 21: 7 → 8, not 7 → 1; favorited/viewed_count/first_viewed_at preserved |
| 5 | Exact `drill_date = member_local_date()` match, no `order by ... limit 1` | `mobile-bootstrap/index.ts` | Section 25: proves the old shape would return yesterday's row, the new one returns zero |

---

## 4. Authoritative ACS Source

The attached PDF was read directly with `pdftotext -layout` (poppler-utils,
installed for this task) rather than the Read tool's page-image renderer,
specifically so the Table of Contents could be extracted as exact text
rather than interpreted visually. Its own front matter and revision-history
table were checked before trusting the extraction:

- Title page: **"FAA-S-ACS-6C"**, "Private Pilot for Airplane Category
  Airman Certification Standards", publication date **November 2023**.
- Foreword: **"Material in FAA-S-ACS-6C supersedes FAA-S-ACS-6B, Private
  Pilot – Airplane Airman Certification Standards, Change 1."**
- Revision history table lists the full lineage: FAA-S-ACS-6 (2016) →
  6A (2017) → 6B (2018/2019) → **6C ("Private Pilot for Airplane Category
  Airman Certification Standards", November 2023)**.

This confirms the attached document is the genuine FAA-S-ACS-6C, not a
different revision or a fabricated stand-in. The user-specified
`effective_date` of **2024-05-31** (the FAA's testing-effective date,
distinct from the document's November 2023 publication date — a normal
FAA publish-then-become-effective gap) is used as instructed and recorded
verbatim; it is not contradicted by anything in the document itself, which
does not print its own effective date.

**No fallback to Apex content occurred at any point.** The hard source
gate ("if the PDF cannot be read reliably enough, stop and report exactly
what could not be verified") was not triggered — the Table of Contents
extracted cleanly and completely.

---

## 5. ACS Taxonomy Model

Extracted **verbatim** from the FAA-S-ACS-6C Table of Contents:

| Area of Operation | Tasks |
|---|---:|
| I. Preflight Preparation | 9 |
| II. Preflight Procedures | 6 |
| III. Airport and Seaplane Base Operations | 2 |
| IV. Takeoffs, Landings, and Go-Arounds | 14 |
| V. Performance Maneuvers and Ground Reference Maneuvers | 2 |
| VI. Navigation | 4 |
| VII. Slow Flight and Stalls | 4 |
| VIII. Basic Instrument Maneuvers | 6 |
| IX. Emergency Operations | 7 |
| X. Multiengine Operations | 4 |
| XI. Night Operations | 1 |
| XII. Postflight Procedures | 2 |
| **Total** | **61** |

Every task is seeded with its official `area_code` (Roman numeral),
`area_title` ("Area of Operation `<code>`. `<title>`"), `task_code`
(letter), `task_title` (verbatim, including FAA's own class qualifiers
like "(ASEL, AMEL)" where the title itself includes them), and a global
`sort_order` matching document order (1–61). **No title was paraphrased.**
Tasks Apex has zero content for — e.g. Area III Task A ("Communications,
Light Signals, and Runway Lighting Systems"), every seaplane- and
multiengine-only task — are included in full, exactly as REV2.1 requires.

No Knowledge/Risk Management/Skill element codes were fabricated; the
schema does not currently model that sub-structure, and REV2 does not add
it speculatively.

**Instrument ACS is deliberately NOT seeded.** No authoritative Instrument
ACS document was supplied, and inventing one from `dpe_questions`'
instrument-exam-type strings would repeat exactly the mistake REV2.1
exists to fix. Every instrument `dpe_questions` row is reported unresolved
with reason `no_authoritative_acs_seeded_for_exam_type` until a real
source is provided — a deliberate staging decision, not an oversight.

---

## 6. ACS Version Selection

`acs_versions` now carries a partial unique index,
`idx_acs_versions_one_active_per_cert` (`unique (certificate_type) where
active`), so at most one version per certificate type can ever be marked
active — proven in Section 29 (inserting a second active `private_pilot`
version fails with a real unique-constraint violation; a second *inactive*
version for future-revision staging is allowed to coexist).

`get_active_acs_version(certificate_type)` is the single resolution point
every consumer (readiness, daily drills) now calls, replacing Rev1's inline
`where v.active` joins.

---

## 7. Content Mapping Provenance

`content_acs_mappings.mapping_source` (`deterministic_backfill` |
`human_curated`, not null, checked) records how each row was created, plus
a `created_by` column (populated only for human-curated rows). The v112
backfill's `delete` statement now reads:

```sql
delete from public.content_acs_mappings
where content_type = 'dpe_question' and mapping_source = 'deterministic_backfill';
```

— never a bare `delete ... where content_type = 'dpe_question'`. This is
proven, not just asserted: Section 16b manually inserts a `human_curated`
mapping for a previously-unresolved question, re-applies the entire v112
migration file a second time via a real `psql -f`, and confirms the manual
row is untouched while the deterministic rows are correctly regenerated
without duplication.

An actual admin curation UI/RPC for adding `human_curated` rows is **not**
built in this pass — out of Sprint 0 Phase C's scope — and is listed as
deferred work (Section 30). The mechanism (the column, the safe rerun
behavior, the reportability) is what REV2.2 asked for and what is proven
here.

---

## 8. ACS Mapping Results

Against the 9 test fixture rows shaped to exercise every branch (production
numbers require production data, out of scope for a local harness read):

| Category | Count |
|---|---:|
| Total test questions | 9 |
| Auto-mapped (`deterministic_backfill`) | 4 (q1, q2, q6, q9) |
| Manually mapped in the provenance test | 1 (q4, added mid-test) |
| Unresolved: multi-task `/` reference | 1 (q3) |
| Unresolved: Special Emphasis Area | 1 (q4, before manual curation) |
| Unresolved: malformed/no shape match | 1 (q5) |
| Unresolved: well-formed but non-authoritative area/task (**new REV2 reason**) | 1 (q7) |
| Unresolved: no authoritative ACS for exam_type (**new REV2 reason**, instrument) | 1 (q8) |
| Title conflict | **0 — structurally impossible under REV2** (see below) |

**Why "title conflict" is always 0 now, not merely absent:** Rev1's title-
conflict check existed because task *titles* were derived from Apex's own
`acs_reference` text, and two rows could disagree. Under REV2, a task's
title always comes from the authoritative FAA seed — Apex's own paraphrase
in `acs_reference` (proven explicitly: q1's `acs_reference` says
"Certificates and Documents," but it maps to the authoritative task titled
"Pilot Qualifications" — see Section 16's test) is never consulted for the
title. There is no longer any Apex-supplied title to conflict over. This is
reported here, per REV2.3's explicit requirement, rather than silently
dropped from the count table.

Real production numbers (392 `dpe_questions` rows, private_pilot +
instrument) will differ from this 9-row fixture set and should be
re-derived by running the migration against a production-data copy before
deployment — this is called out explicitly in Section 30 (Known
Limitations) rather than estimated here.

---

## 9. Unresolved Mapping Backlog

Reason codes reported by `acs_unresolved_mappings` under REV2 (a superset
of Rev1's four):

- `multi_task_reference_needs_human_disambiguation`
- `special_emphasis_area_no_single_task`
- `does_not_match_known_acs_reference_shape`
- `area_task_not_found_in_authoritative_acs` **(new)** — the reference
  parses as a well-formed Area/Task pair, but that pair does not exist in
  the authoritative taxonomy for that `exam_type`. This catches both
  genuine typos in `acs_reference` and any future content that
  accidentally references a task number that doesn't exist.
- `no_authoritative_acs_seeded_for_exam_type` **(new)** — every instrument
  question, until a real Instrument ACS source is supplied.

All four Rev1 reasons plus both new ones are individually regression-tested
(Section 16).

---

## 10. Practice Response Model

`portal_practice_attempt_responses` (new, v113) is a **child event table**,
not a second progress system: `attempt_id` (FK, cascade), `profile_id`
(FK, cascade), `question_id`, `self_rating` (`correct`\|`incorrect`\|
`partial`), `is_correct` (boolean), `answered_at`, unique on
`(attempt_id, question_id)`. Owner-select-only RLS; the sole write path is
`complete_mobile_practice_session()`.

**`partial` semantics, made explicit (REV2.5 requirement):**
- `is_correct` is `false` for both `incorrect` and `partial` — neither
  counts toward the session's aggregate `score` or `task_evidence`'s
  `correct_count`. Only `correct` does.
- For daily-drill recency (Section 13), `partial` is a **moderate**
  re-drill priority signal — weaker than `incorrect` (the strongest
  signal), stronger than no recent response at all. Implemented as an
  explicit 3-tier `case` in `get_or_create_daily_drill()` (priority 2 for
  incorrect, 1 for partial, 0 otherwise).

---

## 11. Atomic Practice Completion

`complete_mobile_practice_session(p_attempt_id uuid, p_responses jsonb)`
(v113), `auth.uid()`-bound, replaces every write `mobile-practice`'s
`complete` action used to perform directly:

1. `select ... for update` on the specific `portal_practice_attempts` row
   — the entire concurrency guarantee lives in this one line being first.
2. Ownership check (`v_attempt.profile_id <> v_profile_id` → exception).
3. Idempotent short-circuit if `completed_at is not null` — zero side
   effects, returns the stored result with `already_completed: true`.
4. Per-response validation: `self_rating` must be one of the three
   accepted values, and the `question_id` must actually be a member of
   `question_ids` on the attempt (`@>` containment check) — a caller
   cannot inject scores for questions that were never part of the session.
5. Insert into `portal_practice_attempt_responses` (`on conflict do
   nothing` — a second identical response in the same call is a no-op,
   not an error).
6. `portal_question_progress` upsert with the REV2.6 counter fix.
7. `record_task_evidence()` per mapped ACS task (unchanged formula).
8. `portal_study_activity` additive credit for today.
9. `portal_practice_attempts` marked completed with the final score.
10. `award_xp()` — its own `unique(profile_id, event_type, source_id)`
    constraint (v104) is a second, independent idempotency layer beneath
    the row lock.

`mobile-practice/index.ts`'s `complete` action is now the thin wrapper
REV2.8 asked for: authenticate, validate shape, call the RPC through an
Authorization-forwarding client (so `auth.uid()` resolves inside the
function), shape the response. It orchestrates nothing itself.

---

## 12. Concurrency Design

The correctness argument is a standard Postgres row-lock argument, not a
novel mechanism: `select ... for update` as the very first statement means
a second transaction requesting the same row blocks until the first
commits or rolls back, and on unblocking reads the **latest committed**
row state, not a stale snapshot. If the first transaction already set
`completed_at`, the second transaction's read of that column — taken after
the lock is granted — reflects that, so it takes the idempotent branch and
performs zero further writes. Two concurrent callers can both receive a
`200`, but the underlying tables are mutated by exactly one of them.

---

## 13. Concurrency Test Results

**This is a real two-process test, not a sequential retry** — the specific
gap REV2.7 called out. Two independent `psql` connections are started as
separate OS processes:

- **Process A**: `begin; select complete_mobile_practice_session(...);
  select pg_sleep(3); commit;` — the explicit transaction holds the row
  lock from the moment the function's `for update` executes until
  `commit`, `pg_sleep(3)` included.
- **Process B**: started **1 second after A**, a single autocommit
  statement calling the same RPC on the same `attempt_id`. It genuinely
  blocks on A's lock (verified by the 3-second sleep giving ample margin
  over the 1-second stagger and any connection-setup latency) until A
  commits, then reads the now-`completed_at`-set row and takes the
  idempotent branch.

**Result (test/run_security_regression_tests.sh, section 23):** both
processes return successfully (no deadlock, no error), and the asserted
final state is:

| Assertion | Result |
|---|---|
| Attempt completed exactly once | ✅ |
| Exactly one `portal_practice_attempt_responses` row (not two) | ✅ |
| `task_evidence.attempt_count` incremented exactly once (not twice) | ✅ |
| XP awarded exactly once for this attempt | ✅ |
| Study activity credited exactly once (45s, not 90s) | ✅ |

---

## 14. Question Progress Semantics

Fixed the exact bug reported: the old upsert unconditionally set
`answered_count: 1`, which on conflict **overwrote** any existing count
back down to 1. The completion RPC's `on conflict` clause now reads
`answered_count = public.portal_question_progress.answered_count + 1`, and
leaves `viewed_count`, `favorited`, and `first_viewed_at` completely alone
on conflict (they are only ever set on the row's first-ever insert).
`completed` continues to mean "attempted at least once" (unchanged
definition, matching existing web portal usage of that column).

**Test (Section 21):** a fixture row with `answered_count = 7`,
`favorited = true`, `viewed_count = 9`, `first_viewed_at` 30 days old is
put through one real completion call. Result: `answered_count = 8` (not
reset to 1), `favorited` still `true`, `viewed_count` still `9`,
`first_viewed_at` still the original 30-day-old timestamp.

---

## 15. Reveal/Debrief Contract

`mobile-practice` gains a third action, `reveal` (`session_id`,
`question_id`): verifies the session belongs to the caller and that the
question is actually a member of that session's `question_ids` before
returning `model_answer`, `common_mistakes`, `dpe_evaluating`, and
`real_world_application` — fields that already exist on `dpe_questions`,
none invented. A caller cannot use it as a general premium question-bank
dump: a question outside the caller's own session, or a session belonging
to someone else, is rejected before any debrief field is read.

**Honesty about test coverage:** this authorization logic lives in the
Deno Edge Function, and this sandbox has no `deno`/`supabase` CLI
available (checked explicitly before writing this section — see Section
24). Section 24 of the regression suite instead proves the exact
underlying data predicate the TypeScript evaluates (session ownership via
RLS, `question_ids @> question_id` containment) directly against the
database. This is **not** the same as having executed the HTTP path — that
remains for staging verification, and this report does not claim
otherwise.

---

## 16. Task Evidence v2

Unchanged from Rev1's formula (`evidence_score = recent_accuracy *
least(1.0, attempt_count / 5.0)`) — REV2 found no defect in this
mechanism itself. What changed is its sole caller: `record_task_evidence()`
is now invoked exclusively from inside `complete_mobile_practice_session()`
(same object-owner-bypasses-its-own-grants relationship already relied on
elsewhere in this codebase, e.g. `run_streak_maintenance` calling
`award_xp`), not orchestrated ad hoc from the Edge Function.

---

## 17. Readiness v1 Revised

`coverage_score`'s denominator was already structurally "all tasks in the
active version" in Rev1's query — the fix REV2.14 actually required was
recognizing that, once that denominator is the real 61-task ACS (not
Rev1's Apex-derived 2-task stand-in), a task with **zero Apex content**
looks identical, from a learner's evidence alone, to a task the learner
simply hasn't studied. Added: a check for tasks with no
`content_acs_mappings` row at all in the active version, surfaced as
`reason_codes: ["insufficient_content_coverage"]` whenever any exist —
which, honestly, is currently always (Apex's ~9 mapped tasks out of 61).

**Test (Section 28):** a learner with evidence on exactly one task
computes `coverage_score < 10` (proving the 61-task denominator is really
in effect, not a small stand-in) and `reason_codes` containing
`insufficient_content_coverage`.

Still never expressed as pass-probability anywhere — the ban is repeated
in the migration's own header comment, the shared DTO's doc comment, and
this report.

---

## 18. Daily Drill v1 Revised

Target-task selection is now a documented, weighted-sum formula over real
signals only (see the exact weights in Section 19). Two signals from the
review prompt are **explicitly not implemented**, honestly:

- **Confidence mismatch** — no genuine self-reported confidence capture
  exists anywhere in this schema (`readiness_snapshots.confidence_score`
  is itself a documented v1 placeholder). Not simulated here.
- **CFI review flag** — no persisted field or event for this exists.
  Deferred, not faked.

Favorites (`portal_question_progress.favorited`) are used as a genuinely
light signal: a small additive weight (`w_fav = 0.25` in every proximity
bucket, the smallest of all five weights), never capable of dominating the
evidence-based ranking on its own.

---

## 19. Checkride Proximity Logic

Three buckets, by `checkride_date - member_local_date()`:

| Bucket | Threshold | `w_coverage` | `w_weak` | `w_stale` | `w_miss` | `w_fav` |
|---|---|---:|---:|---:|---:|---:|
| No date / far | none, or >30 days | 3.0 | 1.0 | 0.5 | 1.0 | 0.25 |
| Moderate | 8–30 days | 1.5 | 2.0 | 1.0 | 2.0 | 0.25 |
| Near | 0–7 days, or overdue | 0.5 | 2.0 | 0.5 | 3.0 | 0.25 |

Per-task score = `w_coverage·[no evidence] + w_weak·(1 − evidence_score)
+ w_stale·[last_attempt_at > 14 days ago] + w_miss·[recent incorrect/
partial response mapped to this task in the last 14 days] + w_fav·[any
favorited question maps to this task]`. Top 3 by score, random tie-break —
"random selection within a ranked eligible pool," explainable, not a black
box. "No date" and "far" deliberately share weights (documented rationale:
a checkride more than a month out carries no more actionable signal than
having no date at all); the tests prove both land in the same bucket.

**Test design (Section 26), fully deterministic despite the random
tie-break:** three members get identical `task_evidence` — one weak task
(I/B, evidence_score 0.2) and nothing else (leaving the other ~60 tasks at
"no evidence," tied among themselves within any one bucket). Under
"far"/"no date" weights, I/B scores 0.8 against a tied field of ~60 tasks
at 3.0 — **mathematically cannot** be selected (0.8 < 3.0, always, no
randomness involved). Under "near" weights, I/B scores 1.6 against a tied
field at 0.5 — **mathematically guaranteed** to be selected (uniquely
highest). Three scenarios run (no date, far, near); the no-date and far
runs both correctly exclude I/B, the near run correctly includes it.

---

## 20. Today-Date Fix

`mobile-bootstrap` now resolves `member_local_date(profile_id)` first, then
queries `daily_drills` with `drill_date = <that date> and algorithm_version
= 'v1'` via `.maybeSingle()` — a row that doesn't exist correctly produces
`todays_drill: null`, not a stale one. Section 25 proves both halves: the
**old** query shape (`order by drill_date desc limit 1`) against a fixture
with only a yesterday-dated drill really would have returned that row
labeled as "today's" (a straight demonstration the bug was real), and the
**new** exact-match query against the same fixture correctly returns zero
rows.

---

## 21. Mobile API Contracts

Unchanged from the original report's Section 10 table except:
`mobile-practice` gains the `reveal` action (Section 15), and `complete`
is now a thin RPC wrapper (Section 11). `mobile-bootstrap`'s
`home.todays_drill` resolution is fixed (Section 20). No new Edge
Function was added or removed.

---

## 22. DTO Changes

`shared/mobile-dto/index.ts`:
- Added `MobilePracticeRevealRequest` / `MobilePracticeRevealResponse`.
- Added `ReadinessReasonCode` (a documented reference list including the
  new `insufficient_content_coverage`, kept open — `| (string & {})` —
  since `reason_codes` is still `string[]` at the wire level and new codes
  can appear without a breaking type change).
- `MobileReadinessSummary.reason_codes` now typed as
  `ReadinessReasonCode[]` instead of a bare `string[]`.
- No raw database-row type is exposed as a public contract anywhere in
  this file — every exported interface is a hand-shaped response DTO.

---

## 23. RLS / Grants

No RLS policy was weakened anywhere in this pass. New/changed surfaces:

| Object | RLS / Grants |
|---|---|
| `acs_versions`/`acs_tasks`/`content_acs_mappings` | Unchanged from Rev1: public SELECT via policy, no client write |
| `portal_practice_attempt_responses` | Owner SELECT only; no write policy at all — sole write path is `complete_mobile_practice_session()` |
| `complete_mobile_practice_session()` | `auth.uid()`-bound; `authenticated`+`service_role` EXECUTE, `anon`/`public` revoked; ownership re-checked inside the function body itself, not just relied on via RLS |
| `get_active_acs_version()` | `authenticated`+`service_role` EXECUTE, read-only `stable sql` function |
| `idx_acs_versions_one_active_per_cert` | A constraint, not a grant — but it is the enforcement mechanism behind REV2.15 |

---

## 24. Edge Function Test Coverage

**Deno/Supabase CLI availability was checked explicitly (`which deno`,
`which supabase`) before any test was written for this section — neither
is present in this sandbox.** Per REV2.16's own explicit allowance, the
closest executable substitute was built: every mobile-* Edge Function's
actual database contract (the RPC calls and RLS-scoped queries it issues)
is exercised directly against the real, migrated schema — which is what
Sections 16–29 collectively do. Where an Edge Function's own TypeScript
logic (e.g. `reveal`'s two ownership checks, `mobile-bootstrap`'s
`Promise.all` shape) has no database-level equivalent, this report says so
plainly rather than claiming coverage that doesn't exist:

| Function | DB-level coverage | Explicit gap remaining for staging |
|---|---|---|
| mobile-bootstrap | Today-drill query logic (Section 25) | Actual HTTP response shape / `Promise.all` composition |
| mobile-practice `start` | Question/mapping selection queries (Section 16 fixtures) | HTTP shuffling/session-size validation |
| mobile-practice `reveal` | Ownership + membership predicate (Section 24) | HTTP-level auth header handling |
| mobile-practice `complete` | Full RPC behavior incl. concurrency (Sections 21-23) | Thin-wrapper error-message mapping |
| mobile-readiness | Underlying RPC (Sections 18, 28) | HTTP action routing |
| mobile-daily-drill | Underlying RPC (Sections 19, 26, 27) | HTTP action routing |
| mobile-library | Unchanged from Rev1 — `has_study_pack_entitlement()` already covered by prior Sprint 0 work | HTTP action routing |
| mobile-push-token | Unchanged from Rev1 (Section 20 of the original suite) | HTTP action routing |

This is an honest, bounded gap — not a claim that Edge Functions were
executed when they weren't.

---

## 25. Full Regression Results

```
RESULTS: 179 passed, 0 failed
```

- **130** tests carried forward unmodified in behavior from the original
  Phase C pass (one assertion's *expected value* was updated — see below —
  because the underlying correct behavior changed, not because coverage
  was weakened).
- **49** new REV2 tests (sections 16b, 21–29, plus the rewritten section
  16).
- **One pre-existing assertion's expected value changed**, and it is
  called out explicitly rather than silently: "overall_score computed as
  the documented weighted average" now expects `58.07` instead of Rev1's
  `75.00`, because the coverage denominator correctly grew from Rev1's
  2-task stand-in to the real 61-task authoritative ACS — the formula
  itself is unchanged, and the new expected value was hand-derived
  (`0.35·(1/61·100) + 0.30·100 + 0.20·100 + 0.15·50 = 58.07`) and verified
  against the actual test run before being accepted, not reverse-engineered
  to make the test pass.
- No test was deleted or weakened. The baseline of 130 is intact; the
  final count of 179 exceeds the required >130.

**Tests proving each of the five original defects is fixed** (repeating
Section 3's table for direct traceability):
1. Authoritative taxonomy: Section 16 ("61 tasks", "12 Areas of
   Operation", "Area III Task A... still present", "authoritative FAA
   title, not Apex's own paraphrase").
2. Provenance survives rerun: Section 16b (all four assertions).
3. Real concurrency: Section 23 (all five final-state assertions).
4. Progress counters: Section 21 (all three assertions).
5. Today-date fix: Section 25 (both assertions).

---

## 26. Files Changed

**Rewritten in place** (never reached production, so revised directly
rather than layered with compatibility migrations, per the task's explicit
permission):
- `portal/supabase-portal-schema-v112-acs-normalization.sql`
- `portal/supabase-portal-schema-v113-task-evidence.sql`
- `portal/supabase-portal-schema-v114-readiness-snapshots.sql`
- `portal/supabase-portal-schema-v115-daily-drills.sql`

**Unchanged:**
- `portal/supabase-portal-schema-v116-mobile-device-notification-model.sql`
  (reviewed under REV2.17, no defect found)

**Rewritten:**
- `portal/supabase/functions/mobile-practice/index.ts`

**Edited:**
- `portal/supabase/functions/mobile-bootstrap/index.ts`
- `shared/mobile-dto/index.ts`
- `test/sql/00_harness_schema.sql`
- `test/sql/01_fixtures.sql`
- `test/run_security_regression_tests.sh`

**New:**
- `SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV2.md` (this file)

**Unchanged, not re-touched:** `mobile-readiness`, `mobile-daily-drill`,
`mobile-library`, `mobile-push-token` Edge Functions;
`portal-supabase-schema-v111-mission-streak-client-lockout.sql`.

---

## 27. Migration Changes

Summarized by file — see each file's own header comment for the full
reasoning:

- **v112**: `acs_versions` gains `source_document`, a partial unique index
  enforcing one active version per certificate type;
  `get_active_acs_version()` added; `acs_tasks` fully re-seeded from the
  authoritative source (61 rows, real titles, real sort order);
  `content_acs_mappings` gains `mapping_source`/`created_by`; the backfill
  no longer creates `acs_tasks` rows at all (only maps content onto the
  pre-seeded authoritative set) and its delete is now scoped to
  `mapping_source = 'deterministic_backfill'`; the unresolved view gains
  two new reason branches.
- **v113**: `task_evidence`/`record_task_evidence()` unchanged in formula;
  adds `portal_practice_attempt_responses` and
  `complete_mobile_practice_session()`.
- **v114**: query logic updated to use `get_active_acs_version()`; adds the
  `insufficient_content_coverage` reason-code check.
- **v115**: `get_or_create_daily_drill()` fully rewritten (weighted target-
  task scoring, checkride-proximity buckets, real-response-based
  recency); `mark_daily_drill_started()` unchanged.
- **v116**: no changes.

---

## 28. Production Deployment Order

**Not executed. Prepared only, per the explicit stop gate.**

1. **v111** (mission/streak client lockout) — entirely separate track,
   gated on its own scheduled lifecycle-cron confirmation and explicit
   "DEPLOY V111" authorization. Not affected by, and does not affect,
   anything below.
2. **v112** (authoritative ACS) — should be applied against a **current
   production data snapshot first, read-only**, to re-derive the real
   mapping-results numbers (Section 8 notes the 9-row fixture numbers are
   not the production numbers) before actually applying it.
3. **v113** (evidence + response model + atomic completion RPC) — depends
   on v112's `acs_tasks`.
4. **v114** (readiness) — depends on v112 + v113.
5. **v115** (daily drills) — depends on v112 + v113 (reads
   `portal_practice_attempt_responses`).
6. **v116** (devices/preferences) — independent, no dependency on v112-115.
7. **mobile-* Edge Functions** — deploy only after all of the above, since
   `mobile-practice` now calls `complete_mobile_practice_session()`
   (v113) and would fail immediately if deployed first.

**Post-deploy verification queries** (read-only, run before declaring
success):
```sql
-- Confirm the authoritative taxonomy landed correctly
select count(*) from acs_tasks t join acs_versions v on v.id = t.acs_version_id
  where v.certificate_type = 'private_pilot' and v.version_code = 'FAA-S-ACS-6C'; -- expect 61

-- Confirm no accidental duplicate active version
select certificate_type, count(*) from acs_versions where active group by certificate_type
  having count(*) > 1; -- expect 0 rows

-- Confirm the real production mapping-results split (re-derive Section 8's numbers for real data)
select reason, count(*) from acs_unresolved_mappings group by reason order by count(*) desc;

-- Confirm record_task_evidence/compute_readiness_snapshot/get_or_create_daily_drill/
-- complete_mobile_practice_session grants are exactly as intended
select proname, pg_get_function_identity_arguments(oid),
  has_function_privilege('anon', oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', oid, 'EXECUTE') as service_role
from pg_proc where proname in
  ('record_task_evidence','compute_readiness_snapshot','get_or_create_daily_drill',
   'complete_mobile_practice_session','get_active_acs_version','revoke_mobile_device');
```
**Smoke test:** with a real (non-production-critical) test account, call
`mobile-bootstrap`, `mobile-practice` `start`→`reveal`→`complete`,
`mobile-readiness` `refresh`, `mobile-daily-drill` (default action), and
confirm each returns the shapes in `shared/mobile-dto/index.ts` with no
5xx.

---

## 29. Rollback Strategy

Each rewritten migration carries its own `Rollback:` comment (added in
this pass per REV2.17). Order, if a rollback is ever needed post-deploy:
`daily_drills` → `readiness_snapshots` → `complete_mobile_practice_session`
+ `portal_practice_attempt_responses` + `task_evidence` → `acs_versions`/
`acs_tasks`/`content_acs_mappings` (v112, `cascade` handles the FK chain).
`mobile_devices`/`notification_preferences` (v116) can be rolled back
independently at any point. **A schema rollback does not undo already-
written production data** (XP already awarded, evidence already recorded,
study-activity seconds already credited) — this is standard for additive
production writes and is called out explicitly rather than implied to be
reversible.

---

## 30. Known Limitations

- **Production mapping-results numbers are not yet re-derived.** Section 8
  reports the 9-row fixture set's numbers; the real 392-row production
  split must be re-computed by running v112 read-only against a production
  snapshot before deployment (Section 28, step 2).
- **No admin curation UI/RPC** for adding `human_curated` mappings exists
  yet — the safe provenance mechanism is built and proven; the tool a
  human would actually use to add one is deferred.
- **Instrument ACS remains unseeded** — deliberately, pending an
  authoritative source.
- **Confidence capture and a CFI-review signal remain unimplemented** —
  deliberately, per REV2.11's own instruction not to fabricate signals
  that don't exist.
- **Edge Function HTTP-path execution remains unverified** in this
  sandbox (no Deno/Supabase CLI) — Section 24's table names exactly which
  parts are and are not covered.
- **`risk_management_score` still frequently equals `knowledge_score`**
  until more content carries a `risk_management`-tagged `mapping_type` —
  unchanged from Rev1, still honestly documented rather than hidden.

---

## 31. Sprint 1 Expo Handoff

Unchanged in substance from the original report's Section 19 — the same
real tables, RPCs, and DTOs remain the integration surface. Two additions
Sprint 1 should know about:

- Practice completion goes through `mobile-practice`'s `complete` action
  exactly as before from the client's perspective (same request/response
  shape) — the atomicity fix is entirely server-side.
- A **reveal** step now exists between "learner answers out loud" and
  "learner submits a self-rating": call `mobile-practice` with
  `{action: "reveal", session_id, question_id}` to get `model_answer` and
  the debrief fields, matching the product's intended question → answer →
  reveal → self-rate flow.

The concrete Sprint 1 acceptance bar (install, sign in, see checkride
date/access, complete 5 DPE questions, favorite one, see it synced on web)
is unchanged and still satisfied by what's implemented here.

---

## 32. GO / NO-GO Recommendation

**GO for a staged production rollout, in the exact order given in Section
28, with the following pre-conditions treated as blocking, not optional:**

1. Re-run v112 read-only against a production data snapshot and review
   the real mapping-results split (Section 30) before applying it for
   real — the 9-row fixture numbers in this report are illustrative of
   the mechanism, not a substitute for that check.
2. v111 remains on its own separate, already-established gate (scheduled
   lifecycle-cron confirmation + explicit "DEPLOY V111") and must not be
   bundled into the same deployment window as Phase C purely for
   convenience.
3. Before Sprint 1 Expo work begins, run the smoke test in Section 28
   against a real staging/production account to close the one honestly-
   documented gap in this report: actual Deno Edge Function HTTP
   execution, which this sandbox cannot perform.

No defect from the independent review remains open. No shortcut was taken
to make a test pass rather than fix the underlying behavior (the one
changed expected value, Section 25, was hand-derived from the corrected
formula and verified, not reverse-engineered).

---

**SPRINT 0 MOBILE BACKEND REV2 COMPLETE — AWAITING PRODUCTION REVIEW.**
