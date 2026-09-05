# Sprint 0 — Production Deployment Report

## 1. Executive Summary

Sprint 0 Phase 2A (security hardening, `v104`–`v109`) and Phase 2B (Ground School RPC overload hotfix, `v110` + `stripe-webhook` code fix) were deployed to the production Apex Advantage Supabase project (`wqzfhcjsfzwrimvsudxy`) in the approved order: `stripe-webhook` first, then all seven migrations, then a full battery of post-deploy verification. Every verification step passed. No production data was modified by any test performed during this deployment — every behavioral check that involved a write was wrapped in an explicit SQL transaction that was rolled back, and confirmed clean afterward by re-reading the affected rows. The lifecycle cron secret rotation (Steps 9–10) is explicitly **not** performed here — it requires the operator to generate and enter a value outside this session, per the approval's own constraint that no secret may be generated, displayed, or rotated by this session.

## 2. Deployment Date/Time

2026-09-05, this session. Individual step timestamps are implicit in the Supabase Edge Function version metadata (`updated_at`) and the sequence of migration applications recorded below; no wall-clock log was kept beyond what Supabase itself records.

## 3. Commit Deployed

`15645c4bc50e7927122175da0b133cabb7a86ea8` on branch `claude/apex-member-portal-w3yoej` — verified identical to the reviewed Phase 2B commit before deployment began (preflight step, prior turn).

## 4. Edge Function Deployment

- **Function:** `stripe-webhook`
- **Version:** 42 → **43**
- **`verify_jwt`:** `false`, preserved exactly as it was before deployment (Stripe webhook signature verification remains the sole auth mechanism for this endpoint — Supabase JWT verification was never enabled and was not enabled by this deploy).
- **Verification:** pulled the live deployed source immediately after deploying and confirmed it contains `p_payment_status: 'paid'` in the `confirm_scheduled_ground_class_enrollment` RPC call — the only change made to this function.
- No other Edge Function was touched.

## 5. Migration Results (v104–v110)

| Migration | Result |
|---|---|
| v104 — RPC privilege hardening | **success** |
| v105 — function search_path hardening | **success** |
| v106 — claim-function service-role-only | **success** |
| v107 — admin grant tightening | **success** |
| v108 — funnel_report gating | **success** |
| v109 — notifications insert policy hardening | **success** |
| v110 — Ground School RPC overload fix | **success** |

Applied one at a time, in exact order, no skips, no reordering, no failures. No manual improvisation was needed at any step.

## 6. Ground School RPC Final State

Verified directly against `pg_proc` after `v110`:

- Six-argument overload `(uuid,text,text,uuid,text,integer)`: **ABSENT**.
- Seven-argument overload `(uuid,text,text,uuid,text,integer,text)`: **PRESENT** — the only signature under this function name (`count(*) = 1`).
- `p_payment_status` default: **NULL** (no default — mandatory at every call site going forward).
- EXECUTE grants: PUBLIC **NO**, anon **NO**, authenticated **NO**, service_role **YES**.
- Non-charging resolution sanity check (Step 2, pre-migration): a diagnostic call using a nonexistent class id resolved to a normal business-rule error (`P0001: Scheduled ground school class not found.`), **not** an ambiguity error — proving the webhook's new explicit `p_payment_status` argument alone resolves the RPC correctly even before `v110` removed the dead overload.

## 7. Security ACL Before/After

| Function | Before (anon / authenticated / service_role) | After |
|---|---|---|
| `confirm_scheduled_ground_class_enrollment` (both, pre-v110) | true / true / true | n/a — 6-arg dropped; 7-arg: false / false / true |
| `confirm_legacy_ground_registration` | true / true / true | **false / false / true** |
| `award_xp` | true / true / true | **false / false / true** |
| `claim_ground_school_enrollments_by_email` | true / true / true | **false / false / true** |
| `claim_readiness_assessment_by_email` | true / true / true | **false / false / true** |
| `record_referral_signup` | true / true / true | **false / false / true** |
| `admin_award_xp`, `admin_unlock_checkride_prep`, `assign_ground_school_class_bid`, `cancel_scheduled_ground_class_enrollment`, `finish_scheduled_ground_class`, `start_scheduled_ground_class`, all `get_*_funnel_stats`/`get_marketing_*`/`get_retention_kpis`/`get_activation_email_kpis`/`get_analytics_data_quality`/`get_channel_performance`/`get_portal_activation_funnel`/`get_utm_campaign_performance` | true / true / true | **false / true / true** (authenticated preserved — internal `is_admin()`/role check is the real boundary) |
| `is_admin()`, `is_staff()` (no-arg) | `proconfig = null` (no search_path) | `proconfig = ["search_path=public, pg_temp"]` |

All values above were re-read directly from `pg_proc`/`has_function_privilege()` against the live production database after each relevant migration — not assumed from the migration source.

## 8. RLS Verification

Performed as behavioral tests against **real, existing production accounts**, each wrapped in a transaction ending in `ROLLBACK`, confirmed clean afterward by re-reading the affected rows (zero net change in every case):

| Check | Result |
|---|---|
| A real student attempting to self-set `role='admin'`, `checkride_prep_unlocked=true` on their own profile | **PASS** — `lock_profile_privileged_columns` trigger reverted both fields; row confirmed unchanged after rollback |
| A real student attempting to INSERT a notification targeting another real student | **PASS** — denied: `new row violates row-level security policy for table "notifications"` |
| A real admin attempting to INSERT a notification (the intended producer) | **PASS** |
| A real student reading their own notifications | **PASS** |
| A real student reading another student's notifications | **PASS** — 0 rows visible |
| A real student attempting to self-grant a `study_pack_entitlements` row | **PASS** — denied: `new row violates row-level security policy for table "study_pack_entitlements"` |
| A real student reading another real student's `profiles` row | **PASS** — 0 rows visible |
| `anon` attempting to `SELECT` from `funnel_report` | **PASS** — `permission denied` |

## 9. Notification Policy Verification

Live post-deploy state, confirmed via `pg_policies`:
```
policy: "Staff insert notifications"
command: INSERT
roles: authenticated
with check: public.is_staff()
```
Table grant: `anon` INSERT revoked; `authenticated` INSERT retained (gated by the policy above). Behavioral proof in Section 8: a real non-staff student is denied, a real admin succeeds.

## 10. Funnel Report Verification

- `pg_class.reloptions` for `funnel_report`: `{"security_invoker=true"}`.
- `anon` table-level SELECT: revoked (confirmed both by `has_table_privilege` and by a live denied `SELECT` attempt as `anon`).
- `authenticated` table-level SELECT: retained, now correctly subject to `analytics_events`' own admin-only RLS (the bug this migration fixed).

## 11. Portal Smoke Test Results

All performed as server-side contract verification against real accounts (this session has no browser/portal login credentials — these are direct database-level checks of the same code paths the portal UI calls, not a human click-through). Every check that could write data was wrapped in a rolled-back transaction and confirmed clean afterward.

| Area | Result |
|---|---|
| LOGIN — real learner's own profile readable under RLS | **PASS** |
| CHECKRIDE PREP — previously purchased access still resolves | **PASS** |
| STUDY PACKS — entitled access resolves true; non-entitled profile resolves false | **PASS** (both) |
| DPE PRACTICE — own question progress / practice attempts readable | **PASS** |
| AI DPE — existing session still readable by its owner | **PASS** |
| GROUND SCHOOL PACK — pack-entitled registration path (`enroll_in_ground_school_via_pack`) | **PASS** — returned `payment_status='ground_school_pack'`, `enrolled_count` incremented by exactly 1 within the transaction, then rolled back; class confirmed restored to its exact prior state (`capacity=8, enrolled_count=2`) afterward |
| ADMIN — dashboard funnel/KPI RPCs load for a real admin | **PASS** (`get_retention_kpis()`, `get_marketing_executive_funnel()`) |
| NOTIFICATIONS — staff can insert, member cannot insert arbitrary | **PASS** (see Section 8/9) |

## 12. Ground School Revenue Path Verification

No live customer payment was made or attempted anywhere in this deployment.

| Check | Result |
|---|---|
| stripe-webhook passes 7 args with `p_payment_status: 'paid'` | **Confirmed** (Section 4) |
| Database contains exactly 1 seven-argument function | **Confirmed** (Section 6) |
| Capacity logic still enforced | **PASS** — temporarily pinning a real class's `capacity` to its current `enrolled_count` and attempting a new enrollment (as `service_role`, matching the webhook) raised `Scheduled ground school class is full.`; rolled back, class capacity confirmed restored to 8 afterward |
| Idempotency — same `stripe_session_id` does not double-enroll | **PASS** — calling the RPC twice with the same session id returned the same enrollment row both times and incremented `enrolled_count` exactly once; rolled back, zero leftover rows confirmed afterward |
| Refund behavior — real enrollment errors still trigger the existing refund path | **Confirmed by code inspection** — the deployed `stripe-webhook` source's error-handling block (refund + capacity-vs-non-capacity email branching) is byte-identical to before this change except for the one added RPC argument; the capacity-failure test above reproduces the exact `is full` string the webhook's `isCapacityError` regex matches on |

## 13. Lifecycle Cron Status

**Unchanged, still failing — not addressed by this deployment, as explicitly scoped.** Latest recorded run (`net._http_response`, prior to this deployment) returned `401`. This deployment did not touch `send-lifecycle-emails`, its secrets, or `run_streak_maintenance()`/`refresh_mission_progress()` grants. See Section 18 for the required next step, which is an operator action outside this session.

## 14. Security Advisor Results

Ran Supabase's security advisor immediately after all migrations. 134 findings total, all `WARN` level (no `ERROR`).

**Resolved by this deployment** (zero findings against these objects, confirmed by independent advisor scan — not just my own grant queries): `confirm_scheduled_ground_class_enrollment`, `confirm_legacy_ground_registration`, `award_xp` (the direct function itself), `claim_ground_school_enrollments_by_email`, `claim_readiness_assessment_by_email`, `record_referral_signup`, `funnel_report`, `notifications`.

**Remaining findings on in-scope objects — all expected and deliberately accepted, not overlooked:**
- `admin_award_xp`, `admin_unlock_checkride_prep`, `assign_ground_school_class_bid`, `cancel_scheduled_ground_class_enrollment`, `finish_scheduled_ground_class`, `start_scheduled_ground_class`, and all `get_*_funnel_stats`/`get_marketing_*`/`get_retention_kpis`/etc.: flagged as "Signed-In Users Can Execute SECURITY DEFINER Function." This is the intended post-`v107` state — `authenticated` EXECUTE was deliberately preserved because each function's own internal `is_admin()`/role check is the real security boundary, not the grant. The advisor lint doesn't know about internal logic; it flags the grant alone.
- `is_admin()`, `is_staff()` (no-arg): flagged for both anon and authenticated. Expected — these are safe, self-referential predicates (they only ever answer "is the calling session itself an admin/staff member," using `auth.uid()` internally, never a caller-supplied id) and were never a hardening target for grants, only for `search_path` (which is now fixed).
- `award_xp`'s trigger callers (`trg_award_xp_achievement`, `trg_award_xp_milestone`, `trg_award_xp_practice_attempt`): flagged for anon/authenticated. Expected and non-exploitable — Postgres refuses to execute a `RETURNS trigger` function outside trigger context regardless of any EXECUTE grant.

**New findings introduced by this deployment: none.**

**Pre-existing, out-of-scope findings, correctly left untouched** (105 total, unrelated to the 7 approved migrations): 99 further "SECURITY DEFINER function executable by anon/authenticated" findings on other functions never in scope for this sprint; 4 "Function Search Path Mutable" findings on other functions (e.g. `set_scheduled_ground_classes_updated_at`); 1 "Extension in Public" (`pg_net`, already documented in Phase 1 as a deferred P2/P3 item); 1 "Leaked Password Protection Disabled" (an Auth dashboard setting, not a migration, already documented in Phase 1 as a separate to-do). None of these were touched, per the instruction not to automatically fix unrelated warnings.

## 15. Errors Encountered

One recoverable error during authoring (not during production application): the first draft of `v110` used `create or replace function` to remove the `p_payment_status` default, which Postgres rejects (`cannot remove parameter defaults from existing function`). Corrected to `drop function` + `create function` inside an explicit transaction before the migration was ever applied to production — the version actually applied succeeded cleanly on the first attempt. No error occurred against the production database itself during any of the 7 migrations, the Edge Function deploy, or any verification query.

## 16. Rollback Actions Taken

**None.** No migration, deploy, or verification step required a rollback of production state. Every verification transaction that included a write (Sections 8, 11, 12) ended in an explicit `ROLLBACK`, which is not a "rollback action" in the incident sense — it's how those checks were designed to run without side effects, and each was confirmed clean by re-reading the affected rows afterward.

## 17. Remaining Risks

- **Lifecycle cron is still returning 401** (Section 13) — `run_streak_maintenance()` and `refresh_mission_progress()` are not running daily as intended until the operator completes the secret rotation in Section 18. This predates and is unrelated to this deployment.
- **`run_streak_maintenance()`/`refresh_mission_progress()` client EXECUTE remains un-revoked**, per explicit instruction, until the cron path is confirmed healthy post-rotation.
- **105 pre-existing, unrelated security-advisor findings remain open** (Section 14) — none introduced or worsened by this deployment, all correctly out of scope for this narrow sprint.
- **This session has no browser/portal login access**, so Section 11's "smoke tests" are server-side contract verifications against real accounts (always read-only or rolled-back), not literal UI click-throughs. A human click-through of the live portal (login, Checkride Prep, Study Packs, Ground School registration UI, admin dashboard) is still worth doing at the operator's convenience as final confirmation, though nothing in this deployment's design should affect UI behavior that the server-side checks didn't already cover.
- **The affected-transaction reconciliation from the Phase 2B report** (one historical `PAID + NOT ENROLLED` Ground School Checkout Session) still needs a human with Stripe Dashboard access to confirm its refund status directly — unchanged by this deployment.

## 18. Deferred Work

**Steps 9–10 (lifecycle cron secret rotation) are explicitly not performed in this session**, per the approval's own constraint. Required next action, to be done by a human operator outside this session:

1. Generate a new high-entropy secret on your own machine (e.g. `openssl rand -hex 32`). Do not paste it into any chat session.
2. Set it as the Supabase Edge Function secret `LIFECYCLE_CRON_SECRET` for `send-lifecycle-emails` (Dashboard → Edge Functions → Secrets, or `supabase secrets set LIFECYCLE_CRON_SECRET=<value> --project-ref wqzfhcjsfzwrimvsudxy`).
3. Set the **same** value in Supabase Vault as `lifecycle_cron_secret` (SQL editor: `select vault.update_secret((select id from vault.secrets where name = 'lifecycle_cron_secret'), '<value>');`).
4. Manually invoke `https://wqzfhcjsfzwrimvsudxy.supabase.co/functions/v1/send-lifecycle-emails` with `Authorization: Bearer <value>` and confirm **HTTP 200**.
5. Inspect the returned JSON and confirm no error entries for `run_streak_maintenance` or `refresh_mission_progress`.
6. Wait for the next scheduled `pg_cron` firing (`0 13 * * *` UTC) and confirm `net._http_response.status_code = 200` for that run (not `401`) — remember `cron.job_run_details.status = 'succeeded'` only means the request was queued, not that it returned 200.
7. Inspect Edge Function logs for that invocation.
8. Only after 4–7 are confirmed healthy: a follow-up migration (`v111`, suggested name `007_mission_streak_client_lockout`) can revoke `anon`/`authenticated` EXECUTE from `run_streak_maintenance()`/`refresh_mission_progress()` — not performed here, per explicit deferral.

No other Sprint 1 work (Expo, ACS normalization, readiness model, Daily Drill, native purchases, Stripe pricing changes) was started, touched, or scoped in this session.

## 19. GO / NO-GO for Sprint 0 Completion

**GO for the database/webhook portion of Sprint 0 — fully deployed and verified.** All 7 migrations and the webhook fix are live in production, every required verification passed, the security advisor confirms the intended objects are resolved with no new findings, and zero production data was modified by any check performed.

**NO-GO for declaring all of Sprint 0 fully closed** until the operator completes the lifecycle cron secret rotation (Section 18) and confirms the daily job is healthy — that is the one piece of Sprint 0's original scope that remains open, and it was always going to require action outside this session.

SPRINT 0 PRODUCTION DEPLOYMENT COMPLETE — AWAITING FINAL SPRINT 0 REVIEW.
