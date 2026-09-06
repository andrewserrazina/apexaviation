# Sprint 1A -- Daily Drill / Mobile-Practice Bridge (v118, Rev2) -- DEPLOYED

Status: **DEPLOYED TO PRODUCTION and verified.** `daily_drills.practice_attempt_id`, `start_daily_drill_practice_session()`, and the extended `complete_mobile_practice_session()` are live on `wqzfhcjsfzwrimvsudxy`; `mobile-daily-drill` (version 3) is live. Expo implementation not yet resumed.

This report documents the resolution of the Sprint 1A pre-build integration gate raised during Daily Drill / mobile-practice contract review, per the user's "INTEGRATION DECISION APPROVED -- DAILY DRILL / PRACTICE BRIDGE" directive, the Rev2 revision made in response to independent review of the original v118 (commit `6209cdd`), and the "DEPLOY V118 REV2" authorization that put it into production. **Section 15 covers Rev2**, **Section 16 covers the production deployment and verification** -- sections 1-14 are the original submission, updated in place only where Rev2 changed the described behavior.

---

## 1. The integration gap

Tracing the reviewed backend (`mobile-daily-drill/index.ts`, `mobile-practice/index.ts`, `portal-supabase-portal-schema-v115-daily-drills.sql`) found:

- `mobile-daily-drill`'s response (`{drill, questions}`) carried no `session_id`.
- Nothing in v115 ever linked a `daily_drills` row to a `portal_practice_attempts` row.
- `mobile-practice`'s `reveal`/`complete` actions operate exclusively against a `portal_practice_attempts` row, and only `mobile-practice`'s own `start` action could create one -- which independently re-queries and shuffles its own question set, never the caller's explicit `question_ids`.
- No existing RPC ever transitioned `daily_drills.status` to `'completed'`.

Net effect: a learner could not complete Today's Drill's own curated questions through the reveal/self-rate/complete contract as originally specified in the Sprint 1 task. This was a genuine backend gap, not an Expo-side implementation detail, so building the native UI against it as-is would have required inventing a client-side workaround -- explicitly disallowed by the Sprint 1 stop-gate.

## 2. Architecture chosen

A narrow bridge, touching nothing else:

1. `daily_drills` gains a nullable `practice_attempt_id` (FK to `portal_practice_attempts(id)`, `ON DELETE SET NULL`, `UNIQUE`).
2. A new RPC, `start_daily_drill_practice_session(p_drill_id uuid)`, supersedes `mark_daily_drill_started()` as the entry point `mobile-daily-drill`'s `start` action calls.
3. `complete_mobile_practice_session()` gains one additional step, in the same transaction as the existing completion logic: if the completing attempt is linked to a drill, mark that drill `completed` too.

The Daily Drill selection algorithm, the readiness algorithm, XP amounts, and ad-hoc `mobile-practice` sessions are untouched.

## 3. Exact schema change

```sql
alter table public.daily_drills
  add column if not exists practice_attempt_id uuid references public.portal_practice_attempts(id) on delete set null;

-- + a guarded unique constraint (daily_drills_practice_attempt_id_key) and a
-- descriptive column comment.
```

One attempt can never be linked to more than one drill (unique constraint); deleting an attempt (nothing does today) would only null the link, never cascade-delete the drill.

## 4. Exact Start RPC contract

`start_daily_drill_practice_session(p_drill_id uuid) returns public.daily_drills`, `SECURITY DEFINER`, `auth.uid()`-bound. As of Rev2, in exact order:

1. Locks the drill row (`SELECT ... FOR UPDATE`), raises `'Drill not found.'` for both a nonexistent id and a different owner's id (same wording either way -- never confirms another learner's drill exists).
2. If `practice_attempt_id` is already set (pending, in_progress, **or** completed), returns the existing linkage untouched -- this is both the resume path and what prevents ever resetting a completed drill. **Entitlement is never re-checked here** -- resuming (or simply re-fetching) an existing session must keep working even if the learner's entitlement has since changed.
3. **(Rev2)** If the drill's `status = 'completed'` but it has no linked attempt (a shape today's code never produces, but the function must not assume it can't exist), returns the completed row as-is, `session_id` still null, and creates nothing.
4. **(Rev2, Blocker 1 fix)** Re-checks `profiles.checkride_prep_unlocked` for the caller -- the exact same rule `get_or_create_daily_drill()` uses -- and raises `'Checkride Prep is not unlocked on this account.'` if false. This is the gate on ever reaching step 6 (creating a new attempt); it never applies to steps 2-3.
5. **(Rev2, integrity hardening)** Validates the drill's stored `question_ids`: must be a non-empty JSON array, every element a non-empty string, no duplicates, and every id must resolve to a real `dpe_questions` row. Any violation raises a specific error (`'...no questions to practice.'`, `'...contains an invalid question id.'`, `'...contains a duplicate question id.'`, `'...references a question that no longer exists.'`) and creates nothing -- no repair, dedup, or re-randomization is ever attempted.
6. Inserts exactly one `portal_practice_attempts` row with `mode='dpe_questions'` and the drill's own `question_ids`/`total` (never client-supplied), links it, and transitions `status` `pending` -> `in_progress` (idempotent no-op if already `in_progress`).
- `EXECUTE` revoked from `public`/`anon`; granted to `authenticated`/`service_role`.
- `mark_daily_drill_started()`'s `authenticated` grant is revoked (calling it directly could now produce an inconsistent `in_progress`-with-no-session state); the function itself is left in place since nothing else in the codebase calls it.

## 5. Exact completion linkage

`complete_mobile_practice_session()` is the verified-live v117 production body, verbatim (re-confirmed via `pg_get_functiondef` against production immediately before writing this migration -- zero drift), plus one new step inserted after the existing practice-attempt completion `UPDATE`:

```sql
update public.daily_drills
set status = 'completed', completed_at = v_attempt.completed_at
where practice_attempt_id = p_attempt_id
  and profile_id = v_profile_id
  and status <> 'completed';
```

This only ever matches a row when a real link exists (`practice_attempt_id = p_attempt_id`) -- an ordinary ad-hoc `mobile-practice` session with no linked drill is a complete no-op here. Every other guarantee of the v117 body (row lock, ownership check, full payload validation, duplicate-question rejection, per-question response history, task evidence, study activity, the shared `award_xp_on_practice_attempt` trigger as sole XP authority, no `mobile_practice_completed` event) is unchanged.

## 6. Concurrency design

Both new/modified write paths reuse the same `SELECT ... FOR UPDATE` serialization pattern already proven in v113/v117:

- **Start**: the drill row lock means two concurrent Start calls on the same never-before-started drill serialize -- the second sees `practice_attempt_id` already set by the first (once it commits) and returns that same linkage instead of creating a second attempt.
- **Complete**: unchanged locking on the practice-attempt row. The new drill-completion step only runs on the genuine-first-completion code path (the existing `already_completed` short-circuit already returned before reaching it), so a drill can only ever be marked completed once, by construction -- no separate idempotency mechanism was needed for the new step.

Both were verified with real two-process concurrency tests (not sequential retries), matching the existing section 23 pattern.

## 7. DTO changes (`shared/mobile-dto/index.ts`)

- `MobileDailyDrill` gains `session_id: string | null` (mirrors `daily_drills.practice_attempt_id`).
- `MobileDailyDrillResponse` gains a top-level `session_id: string | null` alongside `drill` and `questions`, so `start`'s one deliverable doesn't require reaching into `drill`.
- No new type was duplicated; both the default (fetch-or-create) and `start` actions share the same response shape.

## 8. Edge Function changes (`mobile-daily-drill/index.ts`)

- `start` now calls `start_daily_drill_practice_session(p_drill_id)` instead of the superseded `mark_daily_drill_started`.
- A `shapeDrill()` helper surfaces `session_id: drill.practice_attempt_id ?? null` on every response.
- A `resolveDrillQuestions()` helper fetches the drill's questions **and** deterministically reorders them to match the drill's own stored `question_ids` sequence (the prior query returned whatever order Postgres happened to produce for an unordered `IN (...)`; this was tightened while making the change since the drill's ordering must be preserved deterministically for both display and pairing with `reveal`). **(Rev2)** It now also fails closed: if any stored id fails to resolve to a real `dpe_questions` row, it throws rather than silently returning a shorter list via `.filter(Boolean)` -- the caller's existing catch-all turns this into a generic `Internal error`, never a partial drill and never a raw database error.
- Both the default and `start` actions now return the enriched `{drill, session_id, questions}` shape.
- `mobile-practice/index.ts` was read and re-verified but is **unmodified** -- its `start` action remains the independent ad-hoc-session path, unchanged, exactly as instructed.

## 9. Migration SQL

`portal/supabase-portal-schema-v118-daily-drill-practice-bridge.sql` -- full file, extensively commented (integration-gap rationale, design, security guarantees, and explicit rollback SQL with a warning against dropping `practice_attempt_id` once any row is linked). Not applied to production; applied only inside the disposable local test database.

## 10. Tests added

`test/run_security_regression_tests.sh`, new section 40, placed **after** section 19 (Daily Drills) and section 20b (v117) so v118's `mark_daily_drill_started` grant revocation cannot retroactively break either section's pre-existing assertions. Uses its own fresh test profiles (`V118_MEMBER`, `V118_OTHER`, `V118_CONC_MEMBER`, `EMPTY_DRILL_MEMBER`). Covers:

1. `mark_daily_drill_started` EXECUTE grant is revoked from `authenticated`.
2. Anon direct RPC call to `start_daily_drill_practice_session` denied.
3. Cross-user Start denied (ownership, not just RLS).
4. Start succeeds and links exactly one `practice_attempt_id`; drill transitions to `in_progress` with `started_at` set.
5. The linked attempt's `question_ids` are byte-identical to the drill's own (captured before Start, compared after).
6. The linked attempt's `mode` is `dpe_questions`.
7. Retrying Start on an already-linked drill is a safe no-op, returns the same `session_id`, and creates no duplicate attempt.
8. Real two-process concurrent Start on the same never-before-started drill creates exactly one attempt.
9. Fetching the drill again after Start still shows the same `session_id`.
10. Reveal succeeds for a question that is part of the linked session; the underlying membership check still rejects one that isn't.
11. Cross-user Complete on the linked session is still denied.
12. Completing the linked session with a self-rating for every question succeeds; the practice attempt AND the linked Daily Drill are both marked completed in the same transaction, with matching `completed_at`.
13. XP behavior is exactly preserved: no `mobile_practice_completed` event, exactly one `practice_set_completed` (25 XP) event, `perfect_score_bonus` (+15 XP) only on a perfect score.
14. Real two-process concurrent re-Complete against an already-completed linked session produces zero additional side effects (no double XP, drill stays `completed`, no error).
15. An ordinary ad-hoc `mobile-practice` session (no linked drill) still completes normally and never creates or updates any `daily_drills` row.
16. Starting a Daily Drill with an empty question set is rejected outright, never silently turned into a 0-question practice attempt.
17. A pre-v118 drill row created earlier in the suite (section 19's `DRILL_ID_1`, already `in_progress` via the old `mark_daily_drill_started` path) is untouched by the migration (`practice_attempt_id` still null) and can still be bridged forward correctly by the new RPC.

(Rev2 adds 24 more scenarios in a new section 40b -- see section 15.)

## 11. Full regression result (original v118 submission)

```
RESULTS: 300 passed, 0 failed
```

Full suite (all 40 sections, v104-v118), run against a freshly rebuilt disposable local database. One test-authoring bug was found and fixed during this work: two bash variable captures of raw JSON text (the drill's `question_ids` and the constructed self-rating payload) were piped through `xargs`, which strips embedded double quotes from its input -- corrupting both the equality comparison and the JSON payload sent to `complete_mobile_practice_session` (reproduced exactly as a Postgres `invalid input syntax for type json` error naming the unquoted `question_id` token). Fixed by trimming with `sed` instead of `xargs` for those two captures; no assertion was weakened.

**Superseded by Rev2's 321-passed result -- see section 15.**

## 12. Production deployment plan (executed -- see section 16)

When authorized:
1. Apply `portal/supabase-portal-schema-v118-daily-drill-practice-bridge.sql` to production via `mcp__Supabase__apply_migration`.
2. Deploy the updated `mobile-daily-drill` Edge Function via `mcp__Supabase__deploy_edge_function`.
3. Confirm via `pg_get_functiondef` that the deployed `complete_mobile_practice_session` matches this file exactly (the same verification discipline used before writing this migration).
4. Smoke-test Start/reveal/complete against a disposable production test account, mirroring the Sprint 0 Phase 9 HTTP smoke-test pattern.

`mobile-practice` requires no redeploy -- its source is unchanged.

## 13. Rollback considerations

Documented in the migration's own header comment. Safe only if no row has been linked yet: revoke/drop the new RPC, restore `mark_daily_drill_started`'s grant, drop the unique constraint and column, and revert `complete_mobile_practice_session` to the v117 body (reproduced verbatim in that same header comment, minus the new step). If any row **has** been linked, dropping `practice_attempt_id` requires first deciding what should happen to those learners' in-progress or completed drills -- the migration comment flags this explicitly rather than assuming.

## 14. Confirmation: nothing deployed (at time of original v118/Rev2 submission)

- v118 was applied only to the disposable local test database (`apex_test`), never to the production Supabase project (`wqzfhcjsfzwrimvsudxy`).
- `mobile-daily-drill`'s updated source was not deployed via `mcp__Supabase__deploy_edge_function`.
- `mobile-practice` was read-only-verified, not modified, not redeployed.
- No Expo/React Native implementation work has resumed -- this bridge was the explicit prerequisite the Sprint 1A stop-gate required before continuing.

**This section describes the state as of the Rev2 submission for review. Production deployment was subsequently authorized and executed -- see section 16.**

---

## 15. Rev2 -- independent review findings and fixes

Independent review of commit `6209cdd` approved the overall bridge architecture but found two blocking issues and required one preventative hardening item, all scoped to `start_daily_drill_practice_session()` and `mobile-daily-drill/index.ts`. Nothing else in the design changed: the schema, `complete_mobile_practice_session()`'s completion-linkage step, the Daily Drill selection algorithm, XP, entitlements infrastructure, and every other reviewed guarantee are untouched.

### Blocker 1 -- entitlement was not re-checked before creating a new session

**Finding:** `start_daily_drill_practice_session()` is directly callable by `authenticated` (its grant, not `mobile-daily-drill`'s `requirePremiumAccess()`, is what actually gates it at the database). The original body assumed that because `get_or_create_daily_drill()` checked `checkride_prep_unlocked` when the drill was generated, the learner was still entitled at Start time. A learner who lost access after generating a drill could call the RPC directly and still mint a brand-new premium practice attempt.

**Fix:** Added a re-check of `profiles.checkride_prep_unlocked` -- the exact same rule `get_or_create_daily_drill()` already uses, no new entitlement model -- immediately before the function's only branch that can insert a new `portal_practice_attempts` row. Not entitled raises `'Checkride Prep is not unlocked on this account.'`, creates no attempt, modifies no drill row, exposes no session.

**Ordering decision:** the check sits *after* the already-linked early-return and the completed-drill early-return, and *before* the question-set integrity validation. Rationale: entitlement is the gate on *creating* a session, never on *resuming or re-fetching* one that already exists -- a learner who loses access mid-drill must still be able to finish a session they already started. Placing it before question-set validation means a cheaper, more fundamental check runs first.

**Test added (`test/run_security_regression_tests.sh`, section 40b):**
- Entitled learner generates a drill; entitlement is revoked (`checkride_prep_unlocked = false`, applied via `service_role` -- see the test-authoring note below); a direct `authenticated` call to `start_daily_drill_practice_session()` is denied with `not unlocked`; `practice_attempt_id` remains null; zero `portal_practice_attempts` rows exist for that learner; re-entitling and retrying succeeds (confirms the denial was genuinely entitlement-gated, not a different bug).
- A second test confirms the opposite: an *already-linked* drill can still be Start-resumed with entitlement currently revoked (entitlement never blocks resuming).

**Test-authoring bug found while writing this test:** the first attempt at the revoke step used `run_sql postgres` (superuser) for the `UPDATE`, which silently had no effect -- `profiles` carries a `lock_profile_privileged_columns` trigger that resets `role`/`checkride_prep_unlocked`/`email`/`created_at` back to their old values on any `UPDATE` unless the caller is `service_role` or an admin (proven by an existing section 10 self-escalation test). The update succeeded with no error but the column silently stayed `true`, which is exactly the self-escalation protection working as designed against a caller that wasn't `service_role`. Fixed by issuing the revoke/restore through `run_sql service_role` instead of `run_sql postgres`.

### Blocker 2 -- a completed drill could still be turned into a new session

**Finding:** the only guard against re-touching a completed drill was the already-linked early-return. A completed drill that somehow had `practice_attempt_id = null` (a legacy row, a manual repair, a future rollback artifact -- not producible by today's code, but not impossible either) would fall through into ordinary attempt creation, resetting a drill that should be permanently done.

**Fix:** added an explicit `status = 'completed'` check immediately after the already-linked check. Contract chosen (simplest stable option): return the completed row as-is, with `session_id` staying null in that edge case -- a deliberate "nothing to start, this is already done" response, not an error and not a fabricated session. No new attempt is created, `status` is not touched, `completed_at` is not touched.

**Tests added:**
- *Completed + linked* (reusing section 40's already-completed `V118_DRILL`/`V118_SESSION`): calling Start again succeeds, creates zero new practice attempts (attempt count unchanged), the linkage is unchanged, and `status` is still `completed`.
- *Completed + unlinked* (a row inserted directly to construct the edge case, since normal code can't produce it): calling Start succeeds without error, creates zero practice attempts, and the drill remains `completed` with `practice_attempt_id` still null.

### Integrity hardening -- invalid stored question sets now fail closed

**Finding:** the bridge's whole guarantee is that the created attempt represents *exactly* the drill's stored `question_ids`. The original code only checked for non-empty; a malformed stored set (duplicates, a dangling id, a non-string element) would have been inserted verbatim into `portal_practice_attempts`, creating a session the learner could never actually complete (duplicate ids would fail `complete_mobile_practice_session`'s existing duplicate-question check; a dangling id would fail `reveal`).

**Fix:** before inserting, the stored `question_ids` are now validated to be: a JSON array (not just non-empty, but genuinely an array); every element a non-empty string; no duplicate ids (checked via `count(distinct qid) <> jsonb_array_length(...)`); every id present in `dpe_questions` (checked via a `left join ... where dq.id is null`). Any violation raises a specific, clearly worded exception and creates zero attempts, mutates nothing. No replacement ids are ever accepted from the client (unchanged -- none were before either); a bad stored set is never repaired, deduplicated, or re-randomized.

Per the review's own note, production currently has zero multi-mapped DPE questions, zero Daily Drills with duplicate question ids, and one Daily Drill row total -- this is preventative hardening, not remediation of existing data, and no production data was read, written, or altered while implementing or testing it.

**Tests added:**
- Duplicate stored question id -> rejected (`'...contains a duplicate question id.'`), zero attempts created, drill remains unlinked.
- Nonexistent stored question id -> rejected (`'...references a question that no longer exists.'`), zero attempts created, drill remains unlinked.
- Blank/malformed stored question id (an empty-string element) -> rejected (`'...contains an invalid question id.'`), zero attempts created. (Not explicitly requested by the review, but exercises the "every item must be a valid non-empty question id" clause of the hardening requirement, since the code enforces it.)
- The pre-existing empty-question-set test from the original submission continues to pass unchanged.

### Edge Function exactness -- `resolveDrillQuestions()` now fails closed

**Finding:** `resolveDrillQuestions()` mapped `questionIds` through a lookup and `.filter(Boolean)` -- if any stored id failed to resolve to a real `dpe_questions` row, the function would silently return fewer questions than the session actually contains, exposing a drill the client could never fully complete via `reveal`/`complete`.

**Fix:** the `.filter(Boolean)` was replaced with a `.map()` that throws if a given id has no matching row. That throw is caught by the Edge Function's existing top-level `catch`, which already returns a generic `{ error: 'Internal error' }` with a 500 -- so this fix never exposes a raw database error, never returns a partial drill, and never substitutes another question.

**Testing note:** this fix is TypeScript running inside a Deno Edge Function, which -- as already documented for `reveal` (section 24) and the error-contract tests (section 38) -- cannot execute in this sandbox (no `deno`/`supabase-cli` runtime available). It is not independently regression-tested here for that reason. It is, however, now a defense-in-depth backstop rather than the only guard: the RPC-level integrity checks added above already reject any drill whose stored `question_ids` contain a dangling id *before* an attempt can ever be created, so in practice `resolveDrillQuestions()` should never actually encounter a missing id for a v118-linked session going forward. It remains fail-closed regardless, for both a v118-linked session and the `get_or_create_daily_drill()` default-action path (which does not go through the new RPC's validation).

### New total regression count

```
RESULTS: 321 passed, 0 failed
```

Full suite (all 40 + 40b sections, v104-v118 Rev2), run against a freshly rebuilt disposable local database. 21 new assertions across 24 new named test lines (some lines assert more than one fact) were added in section 40b, covering exactly the six required cases: the entitlement-loss direct-RPC test, the completed+linked Start test, the completed+unlinked Start test, duplicate-question-id rejection, nonexistent-question-id rejection, and the (necessarily manual/code-review, not automated) confirmation of the Edge Function's fail-closed behavior described above. All 300 tests from the original v118 submission continue to pass unchanged.

### Confirmation: nothing deployed (Rev2, at time of that submission)

- Rev2 was applied only to the disposable local test database (`apex_test`), never to production.
- `mobile-daily-drill`'s Rev2 source was not deployed.
- No production data was read, written, or altered at any point during Rev2 (the "0 multi-mapped questions / 0 duplicate-question drills / 1 drill row" figures cited above come from the review's own independently-stated audit, not a fresh production query run as part of this fix).
- No Expo/React Native implementation work has resumed.

---

## 16. Production deployment and verification (v118 Rev2 GO)

Authorized by "DEPLOY V118 REV2 -- DAILY DRILL / PRACTICE BRIDGE" against reviewed commit `cf548c2d91c4b0ef7e210fa0ab6359b6f20609f4`, independent review verdict "V118 REV2 -- GO FOR PRODUCTION".

### 16.1 Source-hygiene cleanup (commit `d4bfdb8`)

Two non-functional fixes applied and committed separately before deployment, per the review's request:

1. **`shared/mobile-dto/index.ts`**: `MobileDailyDrillResponse`'s comment previously claimed `start` always guarantees a non-null `session_id`. Corrected to describe both the normal case (non-null) and the completed+unlinked edge case (deliberately null), with an explicit note that callers must honor the nullable type. The wire type itself (`string | null`) was already correct and unchanged.
2. **`test/run_security_regression_tests.sh`**: the assertion labelled "the drill's completed_at is unchanged" was actually querying `status`. Captured `completed_at` before the redundant Start call and added a real byte-identical comparison after it, keeping the original (now correctly labelled) status assertion alongside it.

No product or backend logic was touched in this commit.

### 16.2 Final regression count

```
RESULTS: 322 passed, 0 failed
```

Full suite, all sections (v104-v118 Rev2 plus the corrected assertion), run against a freshly rebuilt disposable local database immediately before production deployment.

### 16.3 Production pre-flight (re-confirmed immediately before applying anything)

| Check | Expected (per review's own prior audit) | Found |
|---|---|---|
| `daily_drills.practice_attempt_id` exists | absent | **absent** (0 columns) |
| `start_daily_drill_practice_session` exists | absent | **absent** (0 functions) |
| `complete_mobile_practice_session()` body | exact reviewed v117 body | **byte-identical** (queried live via `pg_get_functiondef`) |
| `portal_practice_attempts_mode_check` | allows `checkride`, `rapidfire`, `dpe_questions` | **matches exactly** |
| `daily_drills` row count | 1 | **1** |
| pending / in_progress / completed | 1 / 0 / 0 | **1 / 0 / 0** |
| dangling question refs | 0 | **0** |
| duplicate question ids | 0 | **0** |

No drift from the review's stated assumptions. Proceeded to deploy.

### 16.4 Migration application result

Applied `v118_daily_drill_practice_bridge` via `mcp__Supabase__apply_migration` -- full file, unchanged from the reviewed source (`{"success":true}`). Post-apply, all 13 required verifications passed:

1. `daily_drills.practice_attempt_id` exists (type `uuid`) -- **yes**
2. FK target -- **`portal_practice_attempts`** -- **yes**
3. `ON DELETE SET NULL` (`confdeltype = 'n'`) -- **yes**
4. Unique constraint `daily_drills_practice_attempt_id_key` exists -- **yes**
5. Existing Daily Drill row unmodified except for the new column -- **yes** (same status/timestamps/question_ids as pre-flight)
6. Existing row's `practice_attempt_id` is `NULL` -- **yes**
7. `start_daily_drill_practice_session(uuid)` exists -- **yes**
8. `PUBLIC` execute -- **NO** (confirmed via `has_function_privilege`)
9. `anon` execute -- **NO**
10. `authenticated` execute -- **YES**
11. `mark_daily_drill_started(uuid)` `authenticated` execute -- **NO**
12. `complete_mobile_practice_session()` contains the exact reviewed v118 Daily Drill completion `UPDATE` block -- **yes** (matched verbatim via a `prosrc LIKE` check against the exact statement text)
13. No `mobile_practice_completed` XP award reappeared -- **yes** (`position('mobile_practice_completed' in prosrc) = 0`)

No STOP conditions triggered.

### 16.5 Edge Function deployment result

Deployed `mobile-daily-drill` via `mcp__Supabase__deploy_edge_function` (version 2 -> **version 3**, `ACTIVE`). Bundle contained the reviewed `index.ts` (import path adjusted from `../_shared/premiumAccess.ts` to `./_shared/premiumAccess.ts` to match the flat per-function bundle layout Supabase deployment requires -- the same adjustment the prior deployed version already used) plus an unmodified copy of `_shared/premiumAccess.ts` (confirmed byte-identical to the currently-deployed copy before re-uploading it). Fetched the deployed function back via `mcp__Supabase__get_edge_function` and confirmed the source matches the reviewed branch exactly. `mobile-practice` was **not** redeployed (unmodified); no other Edge Function was touched.

### 16.6 Production schema/grant verification

Covered in full by 16.4's 13-point list above -- all passed.

### 16.7 Production smoke tests

Two existing disposable Sprint 0 accounts were available (`1d78d464-8e9d-49b8-a7e4-42dacafbbfef` = "Account A", `247c0630-e803-488c-b48b-70d1f028a184` = "Account B"), both `checkride_prep_unlocked = true`. **Account A already had the one pre-existing real Daily Drill row** the pre-flight audit found (created during earlier Sprint 0 testing) -- per the explicit "do not mutate the existing real Daily Drill row" instruction, Account A was used **only** for the read-only FETCH check; the full Start-through-Complete flow ran against **Account B**, which had no Daily Drill row for today.

Authentication was obtained by setting a temporary bcrypt password on each test account directly (via `pgcrypto`'s `crypt()`/`gen_salt('bf')`, the same hashing Supabase Auth itself uses) and completing a normal password-grant login against the project's own `/auth/v1/token` endpoint -- yielding a genuine, unmodified Supabase session JWT, not a synthetic one. All temporary passwords were rotated to random, unrecoverable values immediately after testing concluded (section 16.10).

**A. FETCH** (Account A, default action): HTTP 200. Returned the existing drill (`20c45b5e-...`, `pending`, `session_id: null`) and its 7 questions in the drill's own stored order. No mutation.

**A. FETCH** (Account B, default action -- generates today's drill): HTTP 200. New drill `052a1c7c-7382-4e40-8669-c96cbb861461` created, `pending`, `session_id: null`, 7 questions returned.

**B. START** (Account B): HTTP 200. `session_id: 4e7cec19-f4f0-45b1-af15-a6a99581fbe7`, drill status `in_progress`, `started_at` set. Verified directly against `portal_practice_attempts`: exactly one row, `mode = 'dpe_questions'`, `total = 7`, `question_ids` byte-identical to the drill's own stored array.

**C. START RETRY** (Account B): HTTP 200. Identical `session_id`, identical question order to the first Start call. Confirmed exactly one `portal_practice_attempts` row exists for the account (no second attempt created).

**D. REVEAL** (via unmodified `mobile-practice`): revealing a question that IS part of the linked session (`aeromed-8`) returned HTTP 200 with the full model-answer/debrief fields. Revealing a question NOT part of the session (`q1`) returned HTTP 403, `"That question is not part of this session"`.

**E. COMPLETE** (Account B, one `correct` rating per question): HTTP 200, `score: 7, total: 7, already_completed: false`. Verified directly against the database:
- `daily_drills.status = 'completed'`, matching the linked attempt's `completed_at` exactly (byte-identical timestamps).
- Exactly 7 `portal_practice_attempt_responses` rows (once per question).
- `task_evidence` rows created (2, once per mapped ACS task -- no duplication).
- `portal_study_activity.seconds = 315` (`7 * 45`, credited exactly once).
- **XP**: zero `mobile_practice_completed` events; exactly one `practice_set_completed` (25 XP) event; exactly one `perfect_score_bonus` (15 XP) event (score = total = 7, a perfect session); total XP = 40, matching the shared `award_xp_on_practice_attempt` trigger's schedule exactly.

**F. COMPLETE RETRY** (Account B, identical payload): HTTP 200, `already_completed: true`, `completed_at` byte-identical to the first call. Re-verified all counts from E: still exactly 7 response rows, 2 evidence rows, 315 study seconds, 40 total XP, drill still `completed` -- zero duplicated side effects.

### 16.8 Direct RPC entitlement-loss test

Per the instruction to use a **second** disposable account for this test, and because Account B's drill was now completed (its early-return path would resume/return existing state without ever reaching the entitlement check, making it useless for testing Blocker 1) and Account A's existing row could not be touched, a **third disposable test account** was created for full isolation, cloned structurally from Account A's `auth.users` row (same `aud`/`role`/`raw_app_meta_data` shape) with a fresh id (`917c1b45-3bdb-4e60-9bb5-2374002b6068`) and a `+apexaviationtx.com` test email -- the `on_auth_user_created` trigger auto-created its `profiles` row as normal.

1. Entitlement granted (`checkride_prep_unlocked = true`) via the trusted `service_role` path (`set local request.jwt.claim.role = 'service_role'`, satisfying the `lock_profile_privileged_columns` trigger's own guard -- confirmed this trigger exists and silently reverts the column for any non-`service_role`, non-admin caller, exactly the self-escalation protection this project already relies on elsewhere).
2. Logged in as the account, called `mobile-daily-drill` default action -> generated drill `6d9ac218-bdde-4b72-9efc-a61c77b35a2f`, `pending`, unlinked.
3. Entitlement revoked (`checkride_prep_unlocked = false`) via the same trusted `service_role` path.
4. Called `start_daily_drill_practice_session` **directly against the PostgREST `/rest/v1/rpc/` endpoint**, bypassing `mobile-daily-drill` entirely -- the exact attack path Blocker 1 was written to close.

**Result:** HTTP 400, `{"message":"Checkride Prep is not unlocked on this account."}`. Verified directly: `practice_attempt_id` still `NULL`, drill `status` still `pending`, zero `portal_practice_attempts` rows for the account. Entitlement was then restored to `true` (the account is otherwise left in the same disposable-but-entitled state as the other two).

### 16.9 Completed-state test

**Completed + linked**: called `start` again (via `mobile-daily-drill`, normal path) on Account B's now-completed drill. Result: HTTP 200, identical `session_id`, identical `completed_at`. Verified: attempt count for the account unchanged (still 1), drill's `completed_at` unchanged (byte-identical to before the call).

**Completed + unlinked**: **skipped**, as explicitly permitted. Constructing this state in production would require directly fabricating a `daily_drills` row with `status='completed'` and no application flow ever producing that shape -- exactly the "unsafe or unnecessary manipulation" the instructions said to avoid. This exact scenario is covered by two dedicated local regression tests (section 40b: "completed + UNLINKED" -- Start succeeds without error, creates no attempt, drill remains completed with `session_id` null) and is relied on here instead.

### 16.10 Customer-data integrity result

- The pre-existing real Daily Drill row (`20c45b5e-...`, Account A) was read once (FETCH) and never mutated -- confirmed identical `status`/`practice_attempt_id`/`started_at`/`completed_at`/`question_ids` before and after all testing.
- `daily_drills` total row count is 3 (the 1 pre-existing row + the 2 created by this testing for Accounts B and the entitlement-test account) -- no other rows were created or touched.
- Zero `portal_practice_attempts` rows and zero `xp_ledger` rows were created for any profile outside the three disposable test accounts in the hour surrounding this work.
- All writes (drill generation, Start, Complete, entitlement grant/revoke/restore) were scoped to the three disposable accounts by explicit id, or driven by those accounts' own authenticated sessions.
- The temporary passwords set on all three disposable accounts to obtain test sessions were rotated to random, unrecoverable values immediately after testing (via `pgcrypto`, no password retained anywhere).

### 16.11 Unexpected behavior

None. Every result matched the reviewed design and the smoke-test expectations exactly; no STOP condition was triggered.

### 16.12 Rollback status

Not needed -- no STOP condition was hit. The rollback procedure remains documented in the migration's own header comment (section 13) and is now the "at least one row has been linked" case (Account B's, and the entitlement-test account's), so **the unconditional first branch of that rollback note no longer applies** -- a future rollback would need to explicitly decide the fate of those two learners' drills before dropping `practice_attempt_id`, exactly as the migration comment already warns.

---

**V118 DAILY DRILL PRACTICE BRIDGE DEPLOYED AND VERIFIED -- READY TO RESUME SPRINT 1A**
