# Sprint 0 — Mobile Backend Implementation Report

**Project:** Apex Advantage (production Supabase project `wqzfhcjsfzwrimvsudxy`)
**Branch:** `claude/apex-member-portal-w3yoej`
**Scope:** Phase A (lifecycle cron restoration), Phase B (mission/streak client
lockout — v111), Phase C (mobile backend primitives — v112-v116 + Edge
Functions + shared TypeScript DTOs)
**Status:** Phase A deployed and healthy in production. Phase B (v111) and
all of Phase C are **source-controlled only — nothing in this report beyond
Phase A has been applied to production.**

---

## 1. Executive Summary

This report closes out Sprint 0's three-part objective:

1. **Restore the lifecycle cron to healthy operation** — done, deployed,
   verified in production (Section 3).
2. **Finish the deferred privilege hardening for mission/streak
   maintenance** — written, locally tested (73→130 regression tests
   passing across the whole suite), **held for explicit "DEPLOY V111"
   authorization** per instruction (Section 4).
3. **Build the mobile-specific backend primitives the future Expo app
   needs**, entirely in source-controlled form, entirely reusing the
   existing identity/progress/entitlement model — **no migration or Edge
   Function from this phase has been applied to production** (Sections
   5-15).

Every safety rule from the governing task brief was followed: no
application table was dropped, no production data was touched, no Stripe
pricing/purchase data was touched, no production user was modified, no RLS
was weakened, no service-role credential was printed or committed, and no
duplicate mobile-specific identity/progress/entitlement/content table was
created. **ONE ACCOUNT, ONE PROGRESS MODEL, ONE ENTITLEMENT MODEL, ONE
CONTENT SYSTEM** — verified in Section 16.

---

## 2. Safety Constraints — Compliance Checklist

| Constraint | Status |
|---|---|
| No dropped application tables | ✅ none dropped |
| No deleted production data | ✅ none deleted |
| No rewritten progress | ✅ `portal_question_progress`/`portal_practice_attempts`/`portal_study_activity` read and appended to only, via the same idempotent paths already in production |
| No regenerated entitlements | ✅ `study_pack_entitlements`/`checkride_prep_unlocked` read-only from the mobile side |
| No Stripe pricing/purchase changes | ✅ untouched |
| No production user modification | ✅ untouched |
| No weakened RLS | ✅ every new table is RLS-enabled; v111 *tightens* two grants, does not loosen anything |
| No exposed service-role credentials | ✅ none printed, logged, or committed |
| No separate mobile identity/progress/entitlement system | ✅ verified table-by-table in Section 16 |
| No duplicate mobile tables from the "DO NOT DUPLICATE" list | ✅ `mobile_profiles`, `mobile_question_progress`, `mobile_entitlements`, `mobile_study_packs`, `mobile_ai_sessions`, `mobile_favorites`, `mobile_xp` — **none of these exist anywhere in this branch** |
| All schema changes source-controlled | ✅ v112-v116, numbered, comment-documented |
| `auth.uid()`/server-derived identity used wherever possible | ✅ `compute_readiness_snapshot()`, `get_or_create_daily_drill()`, `mark_daily_drill_started()`, `revoke_mobile_device()` all bind to `auth.uid()`, never a caller-supplied profile id |
| No production deployment without the final stop gate | ✅ nothing beyond Phase A is deployed — see Section 17 |

---

## 3. Phase A — Lifecycle Cron Restoration (DEPLOYED)

**Problem found:** the daily `send-lifecycle-emails-daily` pg_cron job was
failing silently in two independent ways:

1. **401 Unauthorized** — the Edge Function's `LIFECYCLE_CRON_SECRET`
   environment variable and the value the cron job's `pg_net.http_post`
   call presented had drifted out of sync. Fixed by the operator
   rotating the secret in both places (Vault + Edge Function env) under
   manual, non-logged supervision — the secret value itself was never
   generated, displayed, or handled by this session.
2. **pg_net default timeout too short** — `net.http_post`'s default
   `timeout_milliseconds` (5000ms) was shorter than the real end-to-end
   runtime of the function (~27 seconds for the full daily run across all
   recipients), so even a *successful* run was being recorded as
   `timed_out: true` in `net._http_response`. Fixed by explicitly passing
   `timeout_milliseconds := 60000` — first to prove out the manual
   verification call, then, per explicit instruction, applied permanently
   to the production cron job via `cron.alter_job()`.

**Verification performed:**
- Rolled-back-transaction-free, read-only inspection of `net._http_response`
  confirmed a real `HTTP 200` body with `run_streak_maintenance`/
  `refresh_mission_progress` both completing with no errors.
- `cron.job.command` re-read after `cron.alter_job()` to confirm the new
  `timeout_milliseconds := 60000` is present with the schedule, URL, and
  Vault-secret lookup otherwise byte-for-byte unchanged.

**Outstanding verification (task explicitly deferred to its own schedule,
not blocking Phase C):** confirming the next *scheduled* (not manually
triggered) run at/after 2026-09-05 13:00 UTC also returns HTTP 200 with no
lifecycle errors. This is tracked separately and reported on its own —
see Section 17.

---

## 4. Phase B — Mission/Streak Client Lockout (v111) — NOT DEPLOYED

**File:** `portal/supabase-portal-schema-v111-mission-streak-client-lockout.sql`

**Final caller trace (B1):** `run_streak_maintenance()` and
`refresh_mission_progress()` have exactly one real caller each —
`send-lifecycle-emails/index.ts` (lines 1431/1438), invoked via the
service-role client. No web portal code, no other Edge Function, and no
other RPC path calls either function.

**Privilege design (B2):**
```sql
revoke execute on function public.run_streak_maintenance() from public, anon, authenticated;
grant  execute on function public.run_streak_maintenance() to service_role;

revoke execute on function public.refresh_mission_progress() from public, anon, authenticated;
grant  execute on function public.refresh_mission_progress() to service_role;
```

**Test results (B3):** all required cases pass locally —
anon/authenticated denied on both functions, service_role succeeds on
both, the full lifecycle path (mission completion + XP-exactly-once,
streak-freeze/Recovery-Sortie logic, safe to run twice) verified against
faithfully-reproduced production function bodies. See Section 14 for the
full current test count (130/130 passing across the whole suite,
comfortably over the required 60+).

**Deployment status (B4): NOT deployed.** Per explicit instruction, this
migration is held pending (a) confirmation of a clean *scheduled* lifecycle
cron run at/after 13:00 UTC (Section 17) and (b) the operator's explicit
"DEPLOY V111" authorization. Nothing in Phase C depended on v111 being
live — Phase C's new functions (`record_task_evidence`,
`compute_readiness_snapshot`, `get_or_create_daily_drill`,
`mark_daily_drill_started`) are independent objects with their own
grants, unaffected by whether v111 has shipped.

---

## 5. Phase C1 — ACS Normalization (v112)

**File:** `portal/supabase-portal-schema-v112-acs-normalization.sql`

Adds three purely-additive tables — `acs_versions`, `acs_tasks`,
`content_acs_mappings` — giving the mobile app (and eventually the web
app) a real, queryable ACS task taxonomy without ever touching
`dpe_questions.acs_reference` (which remains the free-text source of
truth for display).

**Backfill methodology:** a deterministic, non-guessing parse of the
strict shape `^Area of Operation <roman>, Task <letter> — <title> (...)`,
requiring every row sharing the same `(exam_type, area_code, task_code)`
to agree on `<title>` before auto-mapping (a defensive title-conflict
check — none exist in the current dataset, but it is in place for future
content). Rows with a `/` (multi-task references) or a `Special Emphasis
Area` prefix, or that simply don't match the shape, are **never guessed
at** — they are left unmapped and captured by name in the
`acs_unresolved_mappings` reporting view (service-role-only).

**Results against live production data (read-only, verified before
writing the migration):**

| | Count | % |
|---|---:|---:|
| Total `dpe_questions` rows | 392 | 100% |
| Auto-resolved | 305 | 77.8% |
| Unresolved: multi-task `/` reference | 24 | 6.1% |
| Unresolved: Special Emphasis Area (no single task) | 63 | 16.1% |
| Title conflicts found | 0 | 0% |

The 87 unresolved rows are a known, named backlog for a human curator to
disambiguate by hand (via a direct `content_acs_mappings` insert) — not a
gap this migration silently papers over.

---

## 6. Phase C2 — Task Evidence Model (v113)

**File:** `portal/supabase-portal-schema-v113-task-evidence.sql`

`task_evidence` (one row per learner × ACS task) is readable by its
owner only, and has **no INSERT/UPDATE/DELETE policy for any client
role at all** — the sole write path is `record_task_evidence()`,
SECURITY DEFINER, `service_role`-only. A learner can never write their
own `evidence_score` directly, by RPC or by direct table access.

**Formula (v1, versioned):**
```
recent_accuracy = correct_count / attempt_count
evidence_score  = recent_accuracy * least(1.0, attempt_count / 5.0)
```
The volume dampener is the direct anti-inflation guard: a single lucky
(or unlucky) attempt cannot swing a task's evidence to an extreme value —
1 correct out of 1 attempt scores 0.20, not 1.00; the dampener stops
suppressing raw accuracy only once 5+ attempts exist. Verified in the
regression suite with exact values (0.2000 at 1 attempt, 1.0000 at 5
saturating attempts).

---

## 7. Phase C3 — Readiness Snapshots (v114)

**File:** `portal/supabase-portal-schema-v114-readiness-snapshots.sql`

**This is a training-readiness INDICATOR, never a pass-probability
estimate.** No field, comment, or downstream consumer (Edge Functions,
DTOs, this report) expresses it as "chance of passing." Every consumer is
required to surface `evidence_level` and `reason_codes` alongside
`overall_score` — never the score alone.

**Algorithm v1:**
- `coverage_score` — % of the certificate's ACS tasks with ≥1 attempt.
- `knowledge_score` — average `evidence_score` across all task evidence.
- `risk_management_score` — average `evidence_score` restricted to
  risk-management-tagged tasks, falling back to `knowledge_score` when
  no such tag exists yet (never divides by zero into an undefined value).
- `confidence_score` — defaults to a neutral 50 with reason code
  `confidence_calibration_not_yet_available`, since nothing in the app
  captures a genuine self-reported confidence rating yet. **Documented as
  a v1 placeholder, not fabricated data.**
- `overall_score = 0.35·coverage + 0.30·knowledge + 0.20·risk + 0.15·confidence`
- `evidence_level`: <10 total attempts → `low`, <40 → `moderate`, else
  `high`. `low` always adds `reason_codes: ["low_sample_size"]`.

**Guards, all verified with exact values in the regression suite:**
- **Single-session-swing guard** — if a same-algorithm-version snapshot
  exists from the last 24h and the new score would move >15 points
  without a proportional (≥20%) increase in total evidence volume, the
  move is clamped to 15 points and `reason_codes` gets
  `score_change_dampened`. Test: seeded a fabricated prior snapshot
  (`overall=10`, `evidence_volume=100`), computed a real score of 75 from
  only 5 new attempts → clamped to exactly 25 (`10+15`), confirmed via
  `reason_codes @> '["score_change_dampened"]'`.
- **Duplicate-submission guard** — the function recomputes entirely from
  current `task_evidence` state; calling it twice with no new evidence
  produces an identical score. Real duplicate-*attempt* prevention lives
  one layer down, in the practice-completion idempotency guarantee
  (Section 9) that `task_evidence` is built from.

`compute_readiness_snapshot()` is `auth.uid()`-bound — no caller-supplied
`profile_id` exists anywhere in its signature.

---

## 8. Phase C4 — Daily Drills (v115)

**File:** `portal/supabase-portal-schema-v115-daily-drills.sql`

`get_or_create_daily_drill()` is idempotent and `auth.uid()`-bound:
- Entitlement (`checkride_prep_unlocked`) is read server-side from
  `profiles` — **never a caller-supplied claim.** Verified: a
  non-entitled learner is rejected with the exact same server-side check
  every other premium surface uses.
- Day boundary uses `member_local_date()` — the same helper
  `run_streak_maintenance()` already relies on — so "today" matches the
  learner's own clock, not UTC.
- The unique constraint on `(profile_id, drill_date, algorithm_version)`
  means a second same-day call returns the **same row**, not a
  regenerated set of questions — verified directly (two calls in the same
  test, same drill id both times).
- Targets 2-4 weakest/least-covered ACS tasks (lowest `evidence_score`
  first, a coverage gap treated as weaker than a low-but-nonzero score),
  then 5-8 questions mapped to those tasks, excluding anything answered
  correctly in the last 3 days.
- `mark_daily_drill_started()` is a safe no-op if already
  started/completed — verified (calling it twice does not reset
  `started_at` or revert `status`).

**Known v1 limitation, deliberately not half-implemented:**
checkride-date proximity is not yet its own branch of the target-task
selection — documented as a v2 candidate rather than bolted on
incompletely (see Section 15).

---

## 9. Phase C5 — Mobile Device / Notification Model (v116)

**File:** `portal/supabase-portal-schema-v116-mobile-device-notification-model.sql`

`mobile_devices` and `notification_preferences` use **direct, self-scoped
client RLS** (`auth.uid() = profile_id`, all operations) rather than the
RPC-gated pattern used for evidence/readiness/drills — a deliberate,
documented distinction: a push token or a notification toggle is
low-risk, self-owned data with no forgeable entitlement or score behind
it, unlike evidence/readiness data. Verified: a learner can manage their
own rows freely but the RLS `with check` blocks writing a row under
someone else's `profile_id`.

`notification_preferences` has **no timezone column** — `profiles.timezone`
(already used by `member_local_date()`) is documented as the single
source of truth, specifically to prevent the two from drifting apart.

`revoke_mobile_device()` is a dedicated RPC (not a raw client `UPDATE`) so
"revoked" keeps one unambiguous meaning — `revoked_at` set, never unset —
regardless of what a future client version sends. Ownership is enforced
inside the function itself (`Device not found.` for a non-owner), not just
by RLS, and verified as such.

---

## 10. Phase C6-C9 — Mobile API Contract

Six Edge Functions, all under `portal/supabase/functions/mobile-*`, all
**NOT deployed**, all following this codebase's existing conventions
(Deno `serve()`, `esm.sh/@supabase/supabase-js@2`, shared CORS headers,
`_shared/premiumAccess.ts` for entitlement checks where Checkride Prep
gating applies):

| Function | Purpose |
|---|---|
| `mobile-bootstrap` | The one call after sign-in — identity, access, progress, home-screen data, in one mobile-safe DTO (Section 11). |
| `mobile-practice` | `start`/`complete` a practice session against `dpe_questions`, idempotent completion (Section 12). |
| `mobile-readiness` | `latest`/`refresh` — wraps `compute_readiness_snapshot()`, never adds pass-probability language. |
| `mobile-daily-drill` | Fetch-or-create today's drill + resolve its questions; `start` action wraps `mark_daily_drill_started()`. |
| `mobile-library` | Study Pack catalog + gated content (Section 13) — reuses `has_study_pack_entitlement()` verbatim, no new entitlement logic. |
| `mobile-push-token` | Register/list/revoke the caller's own `mobile_devices` rows. |

None of these introduce a new entitlement check, a new identity model, or
a new content table — every one of them reads from and writes to tables
that already exist for the web portal (plus the five new Phase C tables
above), reshaped into a mobile-appropriate response.

---

## 11. Phase C7 — Mobile Bootstrap DTO

**File:** `portal/supabase/functions/mobile-bootstrap/index.ts`

Explicitly excludes: staff-only profile fields (`is_staff`/`is_admin`
flags beyond the one documented exception below), instructor pay rates,
admin flags, any Stripe session/payment-intent id, signup/UTM attribution
fields, and all service-role metadata.

**One documented exception:** `profile.role` is included in the `user`
object, but *only* so the app can distinguish an admin/instructor test
account for app-role UI handling (e.g., showing an instructor-specific
screen) — it is explicitly never used as a content gate; every
underlying table and RPC still enforces its own entitlement/RLS logic
regardless of this value.

The DTO shape is codified in `shared/mobile-dto/index.ts` as
`MobileBootstrapDTO` (Section 15).

---

## 12. Phase C8 — Practice Contract

**File:** `portal/supabase/functions/mobile-practice/index.ts`

`dpe_questions` was confirmed, via a live schema query before writing any
code, to be an **oral-exam question bank** — `question` / `model_answer`
/ `common_mistakes` / `dpe_evaluating` / `real_world_application` — with
no `correct_answer`/`choices` columns to auto-grade against. The practice
contract is therefore self-assessed: the learner answers out loud, then
reveals `model_answer` and submits a `self_rating` per question
(`correct`/`incorrect`/`partial`), exactly mirroring how this content
already works.

**Idempotency (the hard requirement):** the session record *is*
`portal_practice_attempts` — `start` inserts it, `complete` updates the
same row by id. If `completed_at` is already set, `complete` returns the
stored result unchanged (`already_completed: true`) instead of
reprocessing — no double XP, no double evidence, no double
streak/study-activity credit on a retried network call. As a second,
independent safety net, XP is awarded through the existing `award_xp` RPC
with `p_source_id` set to the attempt id, so `award_xp`'s own
`unique(profile_id, event_type, source_id)` constraint (from the earlier
v104 hardening) is the actual mechanism preventing double-XP even if a
retry ever arrived with a different client-side idempotency key.

---

## 13. Phase C9 — Library Contract

**File:** `portal/supabase/functions/mobile-library/index.ts`

The server decides entitlement, never the client: the `content` action
calls `has_study_pack_entitlement()` — the exact same RPC
`get-study-pack-content` already uses for the web portal — before ever
touching `study_pack_versions.content`. The `catalog` (default) action
returns only public catalog fields (name, subtitle, price) plus an
`owned` boolean per pack; it never returns gated content regardless of
ownership shown there. No new entitlement table, no new Study Pack model
— this is a pure reshape of the existing v99 Study Pack schema for a
mobile client.

---

## 14. Phase C10/C12 — RLS, Security, and Test Coverage

Every new table (`acs_versions`, `acs_tasks`, `content_acs_mappings`,
`task_evidence`, `readiness_snapshots`, `daily_drills`, `mobile_devices`,
`notification_preferences`) has RLS enabled from the moment it is
created. The local regression harness (`test/sql/00_harness_schema.sql`,
`test/sql/01_fixtures.sql`, `test/run_security_regression_tests.sh`)
was extended with:
- `dpe_categories`/`dpe_questions` (previously absent from the harness),
  seeded with six fixture rows specifically shaped to exercise every
  branch of the v112 backfill regex (title-consistency match, a distinct
  second task, a multi-task `/` reference, a Special Emphasis Area
  reference, and a no-match reference).
- Two dedicated Phase C fixture profiles (`Mobile Member`, entitled;
  `No Entitlement Member`, not entitled) so entitlement-gated behavior is
  tested against a real "denied" case, not just a "succeeds" case.
- v112-v116 added to the migration-application loop (applied directly,
  same pattern as v110/v111).
- **55 new test assertions** across five new sections (16-20): ACS
  normalization RLS + backfill correctness, task evidence write-path
  lockout + score formula exactness, readiness snapshot RLS + algorithm
  correctness + the single-session-swing guard's exact clamped value,
  daily drill entitlement/idempotency/ownership, and mobile
  device/notification self-scoped RLS + ownership-scoped RPCs.

**Full suite result: 130 passed, 0 failed** (75 pre-existing + 55 new),
run against a disposable local Postgres 16 database reproducing
production's real grants, RLS policies, and function bodies verbatim.

---

## 15. Phase C11 — Shared TypeScript DTOs

**File:** `shared/mobile-dto/index.ts`

Deliberately placed **outside** `portal/src` (the web app's Vite build)
and **outside** `mobile/` (the pre-existing Capacitor web-view wrapper app
— a different, already-shipped project, not touched by this work and not
to be confused with the future Expo app). The file is plain,
dependency-free TypeScript (interfaces and type aliases only) so it can
be imported unmodified by a future Expo/React Native app, by a Deno Edge
Function, or by Node-based tooling, without forcing a React Native
dependency into the web app's build.

Exported types mirror every mobile-* Edge Function's wire shape exactly:
`MobileBootstrapDTO`, `MobilePracticeStartResponse`/
`MobilePracticeCompleteResponse`, `MobileReadinessResponse`,
`MobileDailyDrillResponse`, `MobileLibraryCatalogResponse`/
`MobileLibraryContentResponse`, `MobileDeviceDTO`, plus the shared
`MobileReadinessSummary` type (used by both bootstrap and the dedicated
readiness endpoint) whose own doc comment repeats the pass-probability
ban at the type level. Hand-kept in sync with the Edge Functions today;
the Edge Function source is the documented source of truth if the two
ever disagree.

---

## 16. Mobile Data Reuse Matrix — Confirmation

| Existing table (reused as-is) | Mobile surface that reads/writes it |
|---|---|
| `profiles` | bootstrap identity, `checkride_prep_unlocked`, `timezone` via `member_local_date()` |
| `portal_checkride_date` | bootstrap `training.checkride_date` |
| `portal_question_progress` | practice completion, daily drill recency exclusion |
| `portal_practice_attempts` | practice session record (start/complete) |
| `portal_study_activity` | practice completion study-time credit |
| `study_packs` / `study_pack_versions` / `study_pack_entitlements` | library catalog + gated content |
| `xp_ledger` (via `award_xp`) | practice completion XP |
| `get_member_streak()` | bootstrap `progress.current_streak`/`longest_streak` |

No table on the explicit "DO NOT DUPLICATE" list
(`mobile_profiles`, `mobile_question_progress`, `mobile_entitlements`,
`mobile_study_packs`, `mobile_ai_sessions`, `mobile_favorites`,
`mobile_xp`) exists anywhere in this branch. Favorites continue to live on
`portal_question_progress.favorited` / `portal_scenario_progress.favorited`
— nothing new was built for them.

---

## 17. Production Deployment Status

| Item | Status |
|---|---|
| Phase A (lifecycle cron secret rotation + 60s timeout) | **DEPLOYED**, verified via manual invocation |
| Phase A scheduled-run confirmation (≥13:00 UTC 2026-09-05) | **Pending — tracked separately, not yet performed as of this report.** Will be reported on its own as either "V111 READY FOR PRODUCTION: YES" (with a full stop for explicit "DEPLOY V111" authorization) or a continued-failure report. |
| v111 (mission/streak client lockout) | **NOT deployed** — held for the scheduled-run confirmation above plus explicit "DEPLOY V111" authorization |
| v112-v116 (Phase C schema) | **NOT deployed** |
| All six `mobile-*` Edge Functions | **NOT deployed** |
| `shared/mobile-dto/index.ts` | source file only, not published/consumed anywhere yet |

Nothing in this report authorizes or performs a production deployment
beyond what Phase A already completed.

---

## 18. Known Risks / Deferred Work (v2 candidates — not half-implemented here)

- **Checkride-date proximity** is not yet a branch of daily-drill target
  selection (Section 8) — a real v2 feature, not bolted on incompletely.
- **Confidence calibration** has no real capture mechanism yet;
  `confidence_score` is a documented neutral-50 placeholder everywhere it
  appears (Section 7). A future mobile UI that captures genuine
  self-reported confidence is a prerequisite for this dimension to mean
  anything.
- **87 unresolved ACS mappings** (24 multi-task, 63 Special Emphasis
  Area) are a named backlog for human curation, not a silently-dropped
  gap (Section 5).
- **`risk_management_score` fallback**: until more content is tagged with
  a risk-management `mapping_type`, this dimension is frequently
  identical to `knowledge_score` for a given learner — documented, not
  hidden.
- **No generated-types pipeline** exists yet for Edge Function response
  shapes; `shared/mobile-dto/index.ts` is hand-kept in sync (Section 15).

---

## 19. Sprint 1 Expo Handoff Contract

This is the concrete, testable bar for Sprint 1: **a real existing member
account must be able to install the Expo app, sign into the same account,
see the correct checkride date and access flags, complete 5 DPE
questions, favorite one, and see the same synced state reflected back on
the web portal.** Every ID, endpoint, and field below is real and already
implemented in this branch.

**1. Auth.** Sign in with Supabase Auth exactly as the web portal does
(email/password or whatever providers are already configured) — there is
no separate mobile auth path. The resulting session JWT is the only
credential every call below needs.

**2. Bootstrap.** `POST` to `mobile-bootstrap` with
`Authorization: Bearer <jwt>`, no body. Response is `MobileBootstrapDTO`
(`shared/mobile-dto/index.ts`). Read `training.checkride_date` and
`access.checkride_prep` directly from this one response — do not query
`profiles` or `portal_checkride_date` from the client.

**3. Practice 5 questions.**
- `POST mobile-practice` `{ "action": "start", "session_size": 5 }` →
  `MobilePracticeStartResponse`. Store `session_id`.
- For each of the 5 `questions`, show `question`, let the learner answer
  out loud, then reveal (a second call can fetch `model_answer` via the
  same service-role path if a "reveal" surface is added in Sprint 1 —
  today the model answer is intentionally not sent in the `start`
  response) and collect a `self_rating`.
- `POST mobile-practice` `{ "action": "complete", "session_id": "<id>",
  "responses": [ { "question_id": "...", "self_rating": "correct" }, ... ] }`
  → `MobilePracticeCompleteResponse`. This single call updates
  `portal_question_progress`, `task_evidence` (per mapped ACS task via
  `record_task_evidence`), `portal_study_activity` for today, and awards
  XP through `award_xp` — the exact same tables and functions the web
  portal's own practice UI already writes to.

**4. Favorite one question.** Favorites already exist on
`portal_question_progress.favorited` — no mobile-specific favorites
table exists or should be built. A Sprint 1 favorite toggle is a direct
`update public.portal_question_progress set favorited = true where
profile_id = auth.uid() and question_id = '<id>'` under the caller's own
authenticated session (RLS already scopes this to the owner) — no new
Edge Function or RPC is required for this specific action.

**5. Verify the sync on web.** Sign into the same account on the
existing web portal. The just-completed 5 questions must show as
completed in the portal's own DPE practice progress view (reading
`portal_question_progress`), the favorited question must show as
favorited there too, and any XP/streak change must be visible in the same
`profiles.total_xp`/`get_member_streak()` values the portal already
displays — because mobile and web wrote to literally the same rows.

**Everything above depends only on tables and functions that already
exist and are described in this report — Sprint 1 does not need any new
schema to hit this bar**, beyond deploying what Section 17 lists as not
yet deployed.

---

## 20. File Manifest

**New (this phase, all source-controlled, none deployed except Phase A):**
- `portal/supabase-portal-schema-v112-acs-normalization.sql`
- `portal/supabase-portal-schema-v113-task-evidence.sql`
- `portal/supabase-portal-schema-v114-readiness-snapshots.sql`
- `portal/supabase-portal-schema-v115-daily-drills.sql`
- `portal/supabase-portal-schema-v116-mobile-device-notification-model.sql`
- `portal/supabase/functions/mobile-bootstrap/index.ts`
- `portal/supabase/functions/mobile-practice/index.ts`
- `portal/supabase/functions/mobile-readiness/index.ts`
- `portal/supabase/functions/mobile-daily-drill/index.ts`
- `portal/supabase/functions/mobile-library/index.ts`
- `portal/supabase/functions/mobile-push-token/index.ts`
- `shared/mobile-dto/index.ts`
- `SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT.md` (this file)

**Modified (test harness extensions only, no production code touched):**
- `test/sql/00_harness_schema.sql`
- `test/sql/01_fixtures.sql`
- `test/run_security_regression_tests.sh`

**Already committed prior to this segment (Phase B, referenced not
re-touched):** `portal/supabase-portal-schema-v111-mission-streak-client-lockout.sql`

---

## 21. Final Stop Gate

**No Expo development has started. No Phase C migration or Edge Function
has been deployed. No App Store/Play Store build exists.** This report,
the six new migrations, the six new Edge Functions, and the shared DTO
file are committed and pushed to `claude/apex-member-portal-w3yoej` as
source-controlled implementation only.

Separately, and on its own timeline per explicit instruction: the
scheduled lifecycle cron run at/after 2026-09-05 13:00 UTC will be
checked and reported on its own — either **"V111 READY FOR PRODUCTION:
YES"** with a full stop for explicit **"DEPLOY V111"** authorization, or a
report of continued failure. That check has not yet been performed as of
this report and is not gated behind, or gating, anything in this
document.

**SPRINT 0 MOBILE BACKEND IMPLEMENTATION COMPLETE — AWAITING PRODUCTION
REVIEW.**
