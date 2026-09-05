# Sprint 1A -- Daily Drill / Mobile-Practice Bridge (v118)

Status: **source-controlled only. Not deployed to production. Not deployed to Supabase Edge Functions. Expo implementation not resumed.**

This report documents the resolution of the Sprint 1A pre-build integration gate raised during Daily Drill / mobile-practice contract review, per the user's "INTEGRATION DECISION APPROVED -- DAILY DRILL / PRACTICE BRIDGE" directive.

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

`start_daily_drill_practice_session(p_drill_id uuid) returns public.daily_drills`, `SECURITY DEFINER`, `auth.uid()`-bound:

- Locks the drill row (`SELECT ... FOR UPDATE`), raises `'Drill not found.'` for both a nonexistent id and a different owner's id (same wording either way -- never confirms another learner's drill exists).
- If `practice_attempt_id` is already set (pending, in_progress, **or** completed), returns the existing linkage untouched -- this is both the resume path and what prevents ever resetting a completed drill.
- Otherwise validates the drill's own `question_ids` are non-empty (raises `'This Daily Drill has no questions to practice.'` if empty), inserts exactly one `portal_practice_attempts` row with `mode='dpe_questions'` and the drill's own `question_ids`/`total` (never client-supplied), links it, and transitions `status` `pending` -> `in_progress` (idempotent no-op if already `in_progress` or `completed`).
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
- A `resolveDrillQuestions()` helper fetches the drill's questions **and** deterministically reorders them to match the drill's own stored `question_ids` sequence (the prior query returned whatever order Postgres happened to produce for an unordered `IN (...)`; this was tightened while making the change since the drill's ordering must be preserved deterministically for both display and pairing with `reveal`).
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

## 11. Full regression result

```
RESULTS: 300 passed, 0 failed
```

Full suite (all 40 sections, v104-v118), run against a freshly rebuilt disposable local database. One test-authoring bug was found and fixed during this work: two bash variable captures of raw JSON text (the drill's `question_ids` and the constructed self-rating payload) were piped through `xargs`, which strips embedded double quotes from its input -- corrupting both the equality comparison and the JSON payload sent to `complete_mobile_practice_session` (reproduced exactly as a Postgres `invalid input syntax for type json` error naming the unquoted `question_id` token). Fixed by trimming with `sed` instead of `xargs` for those two captures; no assertion was weakened.

## 12. Production deployment plan (not executed)

When authorized:
1. Apply `portal/supabase-portal-schema-v118-daily-drill-practice-bridge.sql` to production via `mcp__Supabase__apply_migration`.
2. Deploy the updated `mobile-daily-drill` Edge Function via `mcp__Supabase__deploy_edge_function`.
3. Confirm via `pg_get_functiondef` that the deployed `complete_mobile_practice_session` matches this file exactly (the same verification discipline used before writing this migration).
4. Smoke-test Start/reveal/complete against a disposable production test account, mirroring the Sprint 0 Phase 9 HTTP smoke-test pattern.

`mobile-practice` requires no redeploy -- its source is unchanged.

## 13. Rollback considerations

Documented in the migration's own header comment. Safe only if no row has been linked yet: revoke/drop the new RPC, restore `mark_daily_drill_started`'s grant, drop the unique constraint and column, and revert `complete_mobile_practice_session` to the v117 body (reproduced verbatim in that same header comment, minus the new step). If any row **has** been linked, dropping `practice_attempt_id` requires first deciding what should happen to those learners' in-progress or completed drills -- the migration comment flags this explicitly rather than assuming.

## 14. Confirmation: nothing deployed

- v118 was applied only to the disposable local test database (`apex_test`), never to the production Supabase project (`wqzfhcjsfzwrimvsudxy`).
- `mobile-daily-drill`'s updated source was not deployed via `mcp__Supabase__deploy_edge_function`.
- `mobile-practice` was read-only-verified, not modified, not redeployed.
- No Expo/React Native implementation work has resumed -- this bridge was the explicit prerequisite the Sprint 1A stop-gate required before continuing.

---

**SPRINT 1A DAILY DRILL PRACTICE BRIDGE READY -- AWAITING REVIEW**
