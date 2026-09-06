# Sprint 1B Stage 1 -- v119 Practice Contract Hardening Report

Status: **v119 Rev2 DEPLOYED AND VERIFIED in production (`wqzfhcjsfzwrimvsudxy`).** See section 10
for the Rev2 independent-review findings and fixes, and section 11 for the production deployment
and smoke-test verification. Sections 1-9 are the original (Rev1) writeup, left intact. Sprint 1B
native Practice UI work has still NOT begun.

## 1. Sprint 1A merge to main

Before any Sprint 1B work began, this session independently re-verified the kickoff task's
claimed git state rather than trusting it:

- `git merge-base --is-ancestor 1024f45 origin/main` -- true (the verified Sprint 1A branch head
  is an ancestor of main).
- `git diff 1024f45 origin/main --stat` -- empty (byte-identical content).
- `git log 88a83cd1..origin/main --oneline` -- exactly the 30 Sprint 1A commits plus their own
  merge commit, nothing else.

Conclusion: main had already been advanced from the stated baseline (`88a83cd1c36a7428348bbddc9f4efe67c6cfa36e`)
to its current head via GitHub PR #242, merging the exact verified Sprint 1A branch head
(`1024f45`) -- consistent with the task's own stated "Final human device verdict: APPROVED FOR
MERGE TO MAIN." This was not unexpected divergence or a conflict requiring STOP; it was the
already-accomplished intended state. Local `main` was fast-forwarded to match (`git merge --ff-only origin/main`).

**New main SHA: `3903a0273274c4ab5b747857be57269c1aad2074`**

### Post-merge verification (all against the new main)

- `cd mobile-expo && npm install && npm test -- --runInBand` -- **125/125 tests passing, 16/16 suites**, exact match to the stated baseline.
- `npm run typecheck` -- clean.
- `npm run lint` -- clean.
- `npx expo-doctor` -- 21/21 checks passed.
- `npx expo export --platform ios` -- succeeded (1316 modules bundled).
- `test/run_security_regression_tests.sh` (full backend suite, rebuilt from the harness schema through every migration v95-v118) -- **322/322 passing, 0 failed**, including the full v118/v118-Rev2 Daily Drill/practice-bridge sections.

Nothing on main deviated from what the physically-verified branch had already produced. No production Supabase was touched.

## 2. Sprint 1B branch

Created `claude/sprint-1b-practice-expansion` from the new main. `SPRINT_1B_PRACTICE_EXPANSION.md`
(commit `6b075c3`) documents the objective (turn Practice from Daily-Drill-only into a repeatable
ad-hoc oral-exam experience) and the eight preservation guarantees Sprint 1A already proved, carried
forward unchanged for both Daily Drill and the new ad-hoc mode.

**Sprint 1B branch base SHA: `6b075c397bcace183be9c90375ba7488007be555`**

## 3. Contract audit (before any implementation)

Both suspected defects named in the kickoff were independently confirmed true by reading
`portal/supabase/functions/mobile-practice/index.ts` end to end, not assumed from the task description:

1. **Targeted-start fallback bug (confirmed).** In `start`, when `acs_task_id` is supplied,
   `content_acs_mappings` is queried for matching `content_id`s. If that query returns zero rows,
   `questionIds` becomes `[]`. The subsequent `dpe_questions` query only applied
   `.in('id', questionIds)` **`if (questionIds.length)`** -- a zero-length array meant NO
   constraint was applied, and the query silently fell through to a fully general, unconstrained
   `dpe_questions` query across the whole private-pilot non-scenario bank. A request naming one
   ACS task could silently receive unrelated general questions.
2. **No authenticated resume action (confirmed).** The file's action dispatch handled only
   `start`, `reveal`, and `complete`, falling through to `{error: 'Unknown action'}` (400) for
   anything else. There was no way for a client that lost its in-memory session state (restart,
   force-close) to re-fetch an ad-hoc practice session's own question set -- unlike Daily Drill's
   existing fetch-or-create path.

Since both were confirmed true (neither "no longer true"), implementation proceeded per the
kickoff's own instruction.

## 4. Targeted-start fail-closed fix

`portal/supabase/functions/mobile-practice/index.ts`, `start` action, rewritten so the query
shape branches explicitly on whether `acs_task_id` was supplied, instead of building one query and
conditionally constraining it:

- **General start (no `acs_task_id`):** unchanged -- an unconstrained `dpe_questions` query over
  the private-pilot, non-scenario pool, exactly as before.
- **Targeted start (`acs_task_id` supplied):**
  1. Query `content_acs_mappings` for that exact task. If zero mapped ids come back, return a
     clean `404` ("No practice questions are available for this ACS task yet.") immediately --
     **zero attempts created**, no fallback query is ever issued.
  2. Otherwise, query `dpe_questions` constrained to `.in('id', mappedIds)` **and** the existing
     `exam_type='private_pilot' AND is_scenario=false` eligibility filter. If nothing survives
     that filter (e.g. every mapped question is a scenario or a different exam type), return the
     same clean `404` -- **zero attempts created**, never a backfill from the general pool.
  3. Otherwise, the session is built **only** from those eligible mapped candidates (shuffled,
     sliced to `session_size`) -- a session may legitimately come back with fewer questions than
     requested when fewer than `session_size` eligible mapped questions exist; it is never padded
     with unrelated general questions.

Daily Drill is untouched -- it never calls this code path (it inserts its own curated,
already-validated `question_ids` directly via `start_daily_drill_practice_session()`).

This branch selection is pure TypeScript inside the Deno Edge Function, which cannot execute in
this sandbox (no deno/supabase-cli runtime -- confirmed absent, matching the same documented
limitation already accepted for `reveal`'s authorization predicate in section 24 and
mobile-daily-drill's fail-closed fix in section 40's closing note of the regression suite).
Regression suite section 41 (V119.1-V119.5) instead proves, at the database level, the exact
conditions this logic now branches on: a zero-mapping task's `content_acs_mappings` count is
genuinely zero; a mapped-but-ineligible task's eligible-question count is genuinely zero; a
mapped-and-eligible task's constrained query resolves to exactly its own mapped ids and nothing
from the general pool; the general pool remains selectable when no task filter applies; and a
mapped set can be smaller than any realistic requested `session_size`.

## 5. Authenticated resume

### Why an RPC, not inline Edge Function logic

`reveal`'s ownership check and the original `start`/`complete` shape all live inline in the Edge
Function. Resume's guarantees are different in kind: **a different learner must never be able to
resume this session, a corrupted stored question set must be refused rather than repaired, and the
returned order must be provably the stored order** -- exactly the class of guarantee this codebase
already puts into a security-definer RPC (`complete_mobile_practice_session()`, v113;
`start_daily_drill_practice_session()`, v118) specifically so it is provable in the SQL regression
harness rather than only asserted in a comment. `resume_mobile_practice_session()` (v119) follows
that same pattern; the Edge Function's `resume` action is a thin wrapper around it, exactly like
`complete`.

### Contract

Request: `{action: "resume", session_id: "<uuid>"}`. Response (mirrors `start`'s shape, minus
target_acs_tasks recomputation being the only derived field, plus `completed_at`):

```
{ session_id, mode, started_at, completed_at, target_acs_tasks, questions: [{id, question, category}] }
```

- `session_id` is **required** in the request (400 if missing) -- checked in the Edge Function
  before the RPC is ever called.
- The RPC authenticates via `auth.uid()` (never a client-supplied `profile_id`), looks up the
  attempt by `session_id`, and:
  - **Missing session** -> raises `session_not_found: ...` -> Edge Function maps to **404**.
  - **Wrong owner** (`attempt.profile_id <> auth.uid()`) -> raises `not_your_session: ...` ->
    Edge Function maps to **403**.
  - **Corrupt stored question set** (see integrity validation below) -> raises
    `invalid_question_set: ...` -> Edge Function maps to **500** (server-side data integrity
    issue, not a malformed client request).
- **Never creates a new attempt** -- the RPC only ever `select`s the existing row; there is no
  `insert` anywhere in its body.
- **Never randomizes or reorders** -- the RPC returns `question_ids` exactly as stored (a jsonb
  array preserves element order), and the Edge Function resolves question text/category by mapping
  over that same array (`storedIds.map(id => byId.get(id))`), never over the `.in()` query's own
  result rows (`.in()` does not preserve input order) -- this is what actually guarantees the wire
  order matches the stored order.
- **Never returns debrief fields** -- only `id, question, category` are selected for the response
  questions; `model_answer` / `common_mistakes` / `dpe_evaluating` / `real_world_application`
  remain exclusive to `reveal`.
- **Already-completed session:** resume still succeeds and returns the real `completed_at`
  (non-null) -- it is not treated as an error and does not restart or clone the session.

### Question-set integrity validation (fail-closed)

Inside `resume_mobile_practice_session()`, before any data is returned:

1. `question_ids` is an array and nonempty (covers both `null` and `'[]'`, the latter being the
   column's own default -- a genuinely reachable corrupt state).
2. Every element is a non-blank string.
3. No duplicate elements (`distinct` count equals array length).
4. Every id resolves to an existing `dpe_questions` row, and the resolved count equals the stored
   count (catches a dangling/deleted id).

Any failure raises `invalid_question_set: ...` and returns nothing -- no mutation, no partial
result, no silent filtering/deduping/substitution/reshuffling. The Edge Function re-checks its own
subsequent `dpe_questions` lookup count as a second, cheap defense-in-depth layer (in case content
changed between the RPC call and that read), also failing closed to a 500 if it ever disagreed.

## 6. DTO changes

`shared/mobile-dto/index.ts`: added `MobilePracticeResumeRequest` (`{action: 'resume', session_id}`)
and `MobilePracticeResumeResponse` (`{session_id, mode, started_at, completed_at, target_acs_tasks,
questions}`), placed alongside the existing practice types. No existing type's shape changed.

## 7. Files changed

- `portal/supabase/functions/mobile-practice/index.ts` -- fail-closed targeted start, new `resume` action.
- `portal/supabase-portal-schema-v119-practice-resume.sql` (new) -- `resume_mobile_practice_session()` RPC only. **No table/column/index changes** -- `portal_practice_attempts` already carried every column resume needed (`id, profile_id, mode, question_ids, started_at, completed_at`).
- `shared/mobile-dto/index.ts` -- added the two resume DTO types.
- `test/run_security_regression_tests.sh` -- new section 41 (V119.1-V119.21, plus sub-assertions 17b/18a/18b/20a/20b).
- `SPRINT_1B_PRACTICE_EXPANSION.md` -- Stage 1 scope (written before this work began).
- This report.

Not touched: `mobile-expo/` (no native UI work), Daily Drill's algorithm or session-linking, the
readiness algorithm, the ACS mapping model, entitlement logic, Stripe, the web portal, Ground
School, Library, or push notifications.

## 8. Test results

`test/run_security_regression_tests.sh`, full run against a freshly rebuilt harness database
(00_harness_schema.sql -> fixtures -> every migration v95 through v119 in order):

**346 passed, 0 failed.**

The 21 required v119 scenarios (plus 5 natural sub-assertions where a single numbered scenario
needed two checks):

- **Targeted start, fail-closed (5): V119.1-V119.5** -- zero-mapping task proven to short-circuit
  rather than fall through; mapped-but-ineligible task proven to have zero eligible candidates;
  mapped-and-eligible task proven to resolve to exactly its own mapped ids; general start proven
  unconstrained; a mapped set proven smaller than a realistic `session_size`.
- **Resume (11): V119.6-V119.16** -- owner can resume; nonexistent session -> `session_not_found`;
  wrong owner -> `not_your_session`; exact stored order returned; repeated resume creates zero new
  attempts; an already-completed session resumes cleanly with `completed_at` set; that resume does
  not mutate the row; empty/duplicate/dangling/blank-element stored question sets all fail closed
  with `invalid_question_set`.
- **Regression (5): V119.17-V119.21** -- Daily Drill generation and start still succeed unchanged;
  ad-hoc completion is idempotent (`already_completed: true` on retry); non-perfect score earns
  exactly 25 XP once; perfect score earns exactly 40 XP once; zero `mobile_practice_completed`
  rows exist anywhere in the ledger.

Every pre-existing assertion from the prior 322-test suite still passes unchanged.

## 9. Explicit confirmations

- **Daily Drill unchanged.** It never routes through ad-hoc practice `start`; its own
  `start_daily_drill_practice_session()` RPC and question-selection algorithm were not modified.
  V119.17/17b re-prove Daily Drill generation and start succeed after v119 is applied.
- **XP unchanged.** `award_xp_on_practice_attempt` (v117) remains the sole XP authority: 25 XP
  `practice_set_completed`, +15 XP `perfect_score_bonus` on a perfect score. No mobile-only XP
  schedule was reintroduced (V119.19, V119.20b, V119.21).
- **No production deployment occurred.** `mobile-practice` was not deployed, the v119 migration
  was not applied to any live database, no production Supabase rows were read or written, and no
  native Sprint 1B UI work began. All of the above ran only against the local disposable
  `apex_test` harness database.

## 10. Rev2 (independent review)

Independent review found three defects in the Rev1 source, all confirmed real and fixed below.
Architecture was approved; no deployment occurred in Rev1 and none has occurred in Rev2 either.

### Blocker 1 -- direct-RPC entitlement bypass

`resume_mobile_practice_session()` is granted directly to `authenticated`, not only reachable
through the Edge Function. Rev1 checked `auth.uid()`, session existence, ownership, and
question-set integrity, but never re-checked current Checkride Prep entitlement -- a direct
authenticated PostgREST/supabase-js caller with a lapsed or never-purchased entitlement could still
resume a session, bypassing the Edge Function's `requirePremiumAccess()` call entirely (the same
class of gap independently caught and fixed during v118).

**Fix:** the RPC now re-checks, before any session lookup, the exact same authoritative predicate
`requirePremiumAccess()` uses -- not a different or narrower rule:

```
profiles.checkride_prep_unlocked = true
OR
a portal_access_purchases row exists for that profile
```

On failure it raises `premium_access_required: Checkride Prep is not unlocked on this account`,
which the Edge Function maps to a 403 -- exactly like `session_not_found` -> 404 and
`not_your_session` -> 403 already did. The check runs before the session is looked up, so an
unentitled direct caller gets the identical response regardless of whether the session exists,
belongs to someone else, or is theirs -- response shape can never be used to enumerate sessions.
The normal Edge Function path is unchanged and still gates it too (defense in depth, as directed).

**Tests added (`test/run_security_regression_tests.sh`, section 42, all passing):**

- **REV2.1** -- an entitled owner (`checkride_prep_unlocked=true`) resumes successfully.
- **REV2.1b** -- confirms zero `portal_access_purchases` rows exist yet, so the denial in REV2.2 is
  genuinely because of zero entitlement, not incidental.
- **REV2.2** -- after entitlement is revoked (`checkride_prep_unlocked=false`, via `service_role` --
  a `lock_profile_privileged_columns` trigger in the harness, mirroring production, silently
  reverts that column when written by any non-`service_role`/non-admin actor, matching how section
  40's own entitlement-loss test already had to do this), a direct authenticated RPC call is
  denied with `premium_access_required`.
- **REV2.3** -- the denied call's output contains no leaked question ids (a raised exception aborts
  the whole statement in Postgres -- there is no such thing as a partial row set on failure, so
  this is structurally guaranteed, not just incidentally true).
- **REV2.4** -- the denied attempt created/mutated nothing -- the session row is byte-identical to
  before (`question_ids`, `total`, `completed_at` unchanged).
- **REV2.5** -- profile flag is `false` but a `portal_access_purchases` row now exists for that
  profile -- resume **is allowed**, proving the RPC mirrors `requirePremiumAccess()`'s OR
  predicate exactly rather than a tightened, `checkride_prep_unlocked`-only rule.

**Harness change required:** `portal_access_purchases` did not exist in
`test/sql/00_harness_schema.sql` (it predates the harness's own baseline). Added with the same
columns the entitlement predicate and the real table actually use (`profile_id`,
`stripe_session_id` unique, `amount_cents`, `tier` check), copied from the real
`portal-schema-v3.sql` definition -- not a redesigned or narrowed shape.

### Blocker 2 -- targeted-mapping pre-eligibility truncation

The `content_acs_mappings` fetch in targeted `start` applied `.limit(session_size * 3)` **before**
`dpe_questions` eligibility filtering (`exam_type='private_pilot' AND is_scenario=false`) ran. If a
task had more mapped questions than that limit and the arbitrary early subset happened to be all
ineligible, the request would 404 even though eligible mapped content existed further down the
mapping list -- the fix's own fail-closed 404 firing on a false premise.

**Fix:** removed the `.limit()` from that query entirely. Every mapped content id for the requested
task is now resolved before eligibility filtering runs, so an eligible question can never be hidden
by an arbitrary truncation regardless of physical row order. (The `dpe_questions` eligibility query
that follows was never limited -- only the mapping fetch was, and only that one needed the fix.)

**Tests added:**

- **REV2.6** (data-level proof) -- a new fixture task (`ZV4`/`LARGE`) is mapped to 35 questions (34
  ineligible `is_scenario=true`, 1 eligible), exceeding the old 30-row truncation point
  (`session_size * 3` at the default `session_size=10`). Confirms both the mapped-set size (35) and
  the eligible count within the full mapped set (exactly 1) in a single assertion.
- **REV2.7** (source check) -- greps the actual `start` action's targeted-mapping-fetch block
  (comment lines excluded, so the explanatory comment mentioning `.limit()` doesn't cause a false
  positive) and fails if any `.limit(` reappears there. Combined with REV2.6, this proves the fix:
  since the full mapped set is always retrieved with no limit, and REV2.6 shows that set contains
  exactly one eligible question among 34 ineligible ones, that question is guaranteed to be found
  regardless of scan order.

This is a source/data-level proof, not an Edge Function integration test -- see the test-runtime
limitation note below.

### Blocker 3 -- explicit invalid `acs_task_id` silently became general practice

`typeof body?.acs_task_id === 'string' ? body.acs_task_id : null` could not distinguish "field
omitted" from "field explicitly supplied but invalid" -- `{action: "start", acs_task_id: ""}` (or
`null`, or a non-string, or a malformed non-UUID string) silently fell through to general practice,
violating the fail-closed targeted-practice contract the rest of v119 established.

**Fix:** extracted the decision into a new, dependency-free `validateAcsTaskId()` function
(`portal/supabase/functions/mobile-practice/validateAcsTaskId.ts`, zero imports by design) that
`start` now calls instead of the inline ternary:

- `undefined` (field omitted) -> `{ok: true, acsTaskId: null}` -- general practice, unchanged.
- Anything else that is not a non-blank string matching the ACS task UUID shape (empty string,
  whitespace-only, `null`, a number, a boolean, an object, or a malformed non-UUID string) ->
  `{ok: false}` -- the Edge Function returns a clean 400 (`acs_task_id must be a valid ACS task id
  when supplied`) and **never** falls back to general practice.
- A valid UUID (optionally with surrounding whitespace, trimmed) -> `{ok: true, acsTaskId:
  <trimmed>}`.

**Why a separate file, and why this counts as real unit coverage, not a workaround:** this function
has zero imports, so unlike the rest of the Edge Function (which imports `https://deno.land/std`
and `@supabase/supabase-js`, both Deno-only in this sandbox), it compiles and runs under plain
`tsc`/`node` with no Deno runtime required. `index.ts` imports and calls this exact function -- the
test is not a hand-written duplicate of the logic that could silently drift from what ships.

**Tests added** (`test/v119_validateAcsTaskId.test.mjs`, compiled by the shell test runner via
`tsc` immediately before execution, then run with plain `node`; its PASS/FAIL lines are folded into
the same regression suite counters):

- **REV2.8** -- omitted -> valid, general practice (`null`).
- **REV2.9** -- empty string -> rejected.
- **REV2.10** -- whitespace-only string -> rejected.
- **REV2.11a-e** -- `null`, a number, a boolean, an object, and a malformed non-UUID string (all
  explicitly supplied) -> rejected.
- **REV2.12 / REV2.12b** -- a valid UUID, with and without surrounding whitespace, is accepted and
  passed through (trimmed) -- a positive sanity check alongside the negative cases above.

### Test-runtime limitation (unchanged from Rev1, restated per review request)

V119.1-V119.5 and REV2.6/REV2.7 prove the database-level conditions and source shape
`start`'s TypeScript branches depend on -- they do **not** execute `mobile-practice`'s HTTP layer,
status-code mapping, or `requirePremiumAccess()` call, because there is still no deno/supabase-cli
runtime in this sandbox. REV2.8-REV2.12 go one step further for the `acs_task_id` decision
specifically, by actually executing that one exported function under Node -- but this is still not
an Edge Function integration test, and this report does not claim otherwise. The actual deployed
Edge Function will receive disposable-account production smoke tests only after this Rev2 source
review approves deployment.

### Validation

Full `test/run_security_regression_tests.sh` run against a freshly rebuilt harness database:

**364 passed, 0 failed** (346 from Rev1 + 18 new: REV2.1, REV2.1b, REV2.2-REV2.7, REV2.8-REV2.12
with 5 sub-cases under REV2.11). Every one of the original 346 assertions still passes unchanged.

Re-confirmed:

- No production migration applied -- `portal-schema-v119-practice-resume.sql` was only applied to
  the local disposable `apex_test` harness database (twice: once for Rev1, re-applied via
  `CREATE OR REPLACE FUNCTION` for Rev2 -- idempotent, no data loss).
- `mobile-practice` was not deployed.
- No production rows were read, written, or mutated.
- `mobile-expo/` remains untouched.

### Files changed (Rev2)

- `portal/supabase-portal-schema-v119-practice-resume.sql` -- entitlement check added to
  `resume_mobile_practice_session()` (in place -- not a new v120 file, since v119 was never
  deployed).
- `portal/supabase/functions/mobile-practice/index.ts` -- Blocker 2 (`.limit()` removed) and
  Blocker 3 (`validateAcsTaskId()` call) fixes; `premium_access_required` added to the `resume`
  error-code mapping.
- `portal/supabase/functions/mobile-practice/validateAcsTaskId.ts` (new) -- extracted, unit-testable
  `acs_task_id` validation.
- `test/v119_validateAcsTaskId.test.mjs` (new) -- Node unit tests for the above.
- `test/run_security_regression_tests.sh` -- new section 42 (REV2.1-REV2.12).
- `test/sql/00_harness_schema.sql` -- added `portal_access_purchases` (did not previously exist in
  the harness; required to test Blocker 1's entitlement predicate at all).
- `.gitignore` -- ignores the throwaway `test/__v119_compiled/` directory the test runner produces
  when compiling `validateAcsTaskId.ts` for the Node unit tests.
- This report.

`shared/mobile-dto/index.ts` was **not** changed -- the wire contract's shapes did not change, only
server-side validation and authorization got stricter.

## 11. Production deployment and verification

Target: Supabase project `wqzfhcjsfzwrimvsudxy`. All 22 preflight/verification/smoke items below
were performed directly against production using the Supabase MCP connection and real HTTP calls
to the deployed Edge Function -- not the local harness -- closing the "Edge Function HTTP-path
execution remains unverified" gap this repo's earlier Sprint 0 reports explicitly and repeatedly
flagged as outstanding.

### Pre-flight (re-confirmed immediately before touching anything)

- `resume_mobile_practice_session(uuid)` did **not** exist yet.
- `portal_access_purchases` existed with exactly the 8 expected columns (`id, profile_id, email,
  full_name, stripe_session_id, amount_cents, tier, created_at`).
- `complete_mobile_practice_session()`'s deployed body still contained the v118 Daily Drill
  completion update (`update public.daily_drills set status='completed'...`) and contained **no**
  `mobile_practice_completed` reference anywhere.
- Live content-mapping query (not trusted from the task description) confirmed: ACS I.A had 43
  mapped / 37 eligible questions (`59e82efe-4aa2-4f2f-a707-10cd13535fb6`); ACS I.H had 2 mapped / 0
  eligible (`15b1a413-dc50-4d66-af13-268528fa469f`). All pre-flight assumptions held -- no STOP
  condition triggered.

### 1. Migration result

Applied `portal-schema-v119-practice-resume.sql` verbatim (byte-identical to the reviewed branch
file) via `apply_migration`. Success.

### 2. Edge Function deployment result

Deployed `mobile-practice` (version 2 -> version 3, `ACTIVE`, `verify_jwt: true` unchanged) with
exactly `index.ts` and `validateAcsTaskId.ts` from the reviewed branch, plus the existing
`_shared/premiumAccess.ts` (fetched from the currently-deployed bundle, byte-identical, **not**
modified). The only textual difference from the git-tracked `index.ts` is the shared-dependency
import path (`'../_shared/premiumAccess.ts'` in the repo's real sibling-directory layout ->
`'./_shared/premiumAccess.ts'` in the deployed bundle) -- this matches the exact self-contained
per-function bundling convention the previously-deployed version already used; confirmed via
`diff` before upload that this was the only line that differed. No other Edge Function was touched
(`mobile-daily-drill` untouched, confirmed still at its prior version).

### 3. Post-apply function/grant verification (all 17 required checks)

Queried `pg_proc`/`has_function_privilege` directly:

1. `resume_mobile_practice_session(uuid)` exists. ✓
2. `SECURITY DEFINER` = true. ✓
3. `search_path` = `public`. ✓
4. `PUBLIC` execute = false. ✓
5. `anon` execute = false. ✓
6. `authenticated` execute = true. ✓
7. Entitlement check runs before session lookup (confirmed by reading the function body's
   statement order, and by Smoke I below). ✓
8. Entitlement predicate is exactly `profiles.checkride_prep_unlocked = true OR EXISTS a
   portal_access_purchases row for auth.uid()`. ✓
9. Ownership uses `auth.uid()` (`v_profile_id uuid := auth.uid()`). ✓
10. No client-supplied `profile_id` -- the only parameter is `p_attempt_id`. ✓
11. Empty `question_ids` fails closed (`jsonb_array_length(...) = 0` check). ✓
12. Blank element fails closed (per-element blank/non-string check). ✓
13. Duplicate question ids fail closed (distinct-count check). ✓
14. Dangling question ids fail closed (`join dpe_questions` count-match check). ✓
15. Stored order is returned unchanged -- the function returns the stored `jsonb` array directly,
    never resorted. ✓
16. No `INSERT`/`UPDATE`/`DELETE` against `portal_practice_attempts` anywhere in the function body
    -- only a single `SELECT`. ✓
17. No XP/evidence/study-activity writes anywhere in the function body. ✓

### 4-16. Smoke tests (real HTTP calls against the deployed Edge Function)

Three existing disposable Sprint 0/Sprint 1A test accounts were reused (all `checkride_prep_unlocked
= true`, zero `portal_access_purchases` rows, matching this repo's own established methodology for
production smoke testing -- see `SPRINT_1A_DAILY_DRILL_PRACTICE_BRIDGE_REPORT.md` section on
disposable test accounts): Account A (`1d78d464-8e9d-49b8-a7e4-42dacafbbfef`), Account B
(`247c0630-e803-488c-b48b-70d1f028a184`), Account C (`917c1b45-3bdb-4e60-9bb5-2374002b6068`). Real
JWTs were obtained by temporarily setting each account's password via `pgcrypto` (`crypt(...,
gen_salt('bf'))`) and signing in through GoTrue's password grant, then calling the deployed
`mobile-practice` Edge Function URL directly with `curl` -- genuine production HTTP execution, not
a database-level proxy.

- **Smoke A (general start):** `{action:"start", session_size:5}` as Account A -- 200, 5 questions,
  exactly 1 new `portal_practice_attempts` row, `mode=dpe_questions`, `question_ids` matched the
  returned questions exactly. **PASS.**
- **Smoke B (targeted start, real content, ACS I.A):** `{action:"start", acs_task_id:"<I.A>",
  session_size:10}` -- 200, 10 questions returned. Read-only DB reconciliation confirmed **every**
  returned question was genuinely mapped to I.A, `exam_type=private_pilot`, `is_scenario=false` --
  zero unrelated general questions. **PASS.**
- **Smoke C (targeted start, zero eligible, ACS I.H):** 404, "No practice questions are available
  for this ACS task yet.", attempt count for Account A unchanged (still 5) -- zero attempts
  created, no fallback to general practice. **PASS.**
- **Smoke D (invalid explicit `acs_task_id`):** empty string, whitespace, `null`, `"not-a-uuid"`,
  and `123` each returned a clean 400 with zero new attempts (count stayed at 5 throughout); omitting
  the field entirely still produced normal general practice (200, 3 questions). **PASS.**
- **Smoke E (resume own session):** resumed Smoke B's session -- same `session_id`, `mode`,
  `started_at`; `completed_at: null`; question order **byte-for-byte identical** to Smoke B's
  original order; response contained only `id`/`question`/`category` -- no `model_answer`,
  `common_mistakes`, `dpe_evaluating`, or `real_world_application` fields anywhere in the payload.
  **PASS.**
- **Smoke F (repeated resume):** resumed the same session 3 more times -- identical question order
  every time; attempt count, `total_xp`, and study-activity seconds for Account A were identical
  before and after (6 / 110 / 360, unchanged). **PASS.**
- **Smoke G (wrong owner):** Account B attempted to resume Account A's session -- 403,
  `not_your_session`, no session/question data in the response, Account B's own attempt count
  unchanged (1), Account A's session `completed_at` unchanged (still null). **PASS.**
- **Smoke H (missing session):** a well-formed but nonexistent UUID -- 404, `session_not_found`.
  **PASS.**
- **Smoke I (direct-RPC entitlement defense):** created a session for Account C, confirmed resume
  succeeded while entitled. Revoked `checkride_prep_unlocked` via the same trusted
  `service_role`-equivalent path this repo already uses for entitlement toggling in tests (setting
  the `request.jwt.claim.role` session GUC that `auth.role()` reads, matching how PostgREST itself
  authenticates a service-role caller -- required because production carries the same
  `lock_profile_privileged_columns` trigger this session's local regression harness was extended to
  model). Then called `resume_mobile_practice_session` **directly via PostgREST**
  (`POST /rest/v1/rpc/resume_mobile_practice_session`), bypassing the Edge Function entirely --
  denied with `premium_access_required: Checkride Prep is not unlocked on this account` (HTTP 400
  from PostgREST's own error-wrapping, `P0001`), zero session/question data returned, zero
  mutation (the session row was confirmed byte-identical before and after). Then, with the profile
  flag still `false`, inserted a disposable test `portal_access_purchases` row for Account C only
  -- the same direct RPC call and the normal Edge Function path **both** then succeeded, proving
  the RPC mirrors `requirePremiumAccess()`'s exact OR predicate rather than a tightened,
  `checkride_prep_unlocked`-only rule. The test purchase row was deleted and the profile flag
  restored to `true` immediately after. **PASS.**
- **Smoke J (completion/XP regression):** completed a non-perfect (1 of 2) session for Account C --
  success, exactly 25 XP (`practice_set_completed`) recorded once; an immediate retry with an empty
  responses array returned `already_completed: true` with no error and no duplicate XP. A second,
  perfect-score (2 of 2) session for the same account recorded exactly 40 XP total (25 + 15
  `perfect_score_bonus`), once. Zero `mobile_practice_completed` rows exist anywhere in the ledger.
  **PASS.**
- **Smoke K (Daily Drill regression):** fetched Account B's today's drill (a fresh one, since
  today's date had no drill yet -- yesterday's drill was already completed and was left untouched);
  started it (`start_daily_drill_practice_session()` linkage succeeded, `session_id` populated);
  completed it via the same `mobile-practice` `complete` action with a perfect response set --
  succeeded, and the linked `daily_drills` row's `completed_at` was byte-identical to the linked
  `portal_practice_attempts` row's `completed_at` (same transaction, atomic, exactly as v118
  designed it). `mobile-daily-drill` itself was not redeployed and was not modified by v119.
  **PASS.**

### 17. Customer data integrity result

Checked every write-producing table for rows outside the three disposable test accounts created
since this session's deployment work began (~02:33 UTC): `portal_practice_attempts` (0 new),
`xp_ledger` (0 new), `task_evidence` (0 new), `daily_drills` for today's date (0 new). One
pre-existing row in each of `portal_practice_attempts` and `daily_drills` was found for the real
account owner (`aserrazina101@gmail.com`) -- both created at 00:58 UTC, roughly 90 minutes **before**
this deployment session's first write, confirming it was pre-existing real usage, not something
this work touched. All entitlement flags for the three disposable accounts were confirmed restored
to their original `true` value; the one test-only `portal_access_purchases` row was deleted; all
three disposable accounts' passwords were rotated to random, Postgres-generated,
never-returned-to-me values (`crypt(gen_random_uuid()::text || gen_random_uuid()::text,
gen_salt('bf'))`) immediately after testing concluded.

### 18. Final local regression count

`test/run_security_regression_tests.sh`, full run against a freshly rebuilt local harness database
(unrelated to and run independently of the production work above): **364 passed, 0 failed** --
identical to the pre-deployment Rev2 count. No test was altered to accommodate production behavior.

### 19. Skipped smoke items and reasons

None skipped. All items A-K, plus the customer-data-integrity sweep, were performed as specified.

### 20. Rollback status

No rollback was necessary -- all 22 verification items passed on the first attempt with no STOP
condition triggered. `resume_mobile_practice_session()` remains deployed; `mobile-practice` remains
at version 3. Per the migration file's own header comment, a schema rollback (dropping the
function) would be a simple `drop function if exists public.resume_mobile_practice_session(uuid);`
if ever needed, and would not affect `complete_mobile_practice_session()`, Daily Drill, or any
already-written production data.

---

**V119 PRACTICE CONTRACT DEPLOYED AND VERIFIED — READY FOR SPRINT 1B NATIVE UI**
