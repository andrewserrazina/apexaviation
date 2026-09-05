# Sprint 0 — Phase 2A: Security Hardening Implementation Report

Status: **implemented and tested locally only. Nothing has been applied to the production Supabase project (`wqzfhcjsfzwrimvsudxy`), and no Edge Function has been deployed.** All work here is source-controlled SQL migrations plus a disposable local test harness, awaiting the review this report requests.

---

## 1. Executive Summary

Six security-hardening migrations were implemented, each targeting one finding from Sprint 0 Phase 1/1B, and each verified against a local Postgres 16 test harness that reproduces the live schema's grants, RLS policies, and function bodies for the objects involved:

- **001** (`v104`) revokes `anon`/`authenticated` EXECUTE on the four P0 forgery-prone functions (`confirm_scheduled_ground_class_enrollment` ×2 overloads, `confirm_legacy_ground_registration`, `award_xp`), leaving `service_role` untouched.
- **002** (`v105`) pins `search_path` on `is_admin()`/`is_staff()`.
- **003** (`v106`) makes the three `claim_*_by_email`/`record_referral_signup` functions server-only (`service_role` only).
- **004** (`v107`) drops `anon` EXECUTE from the admin/staff-gated function family, keeping `authenticated` (the internal role check remains the real gate).
- **005** (`v108`) sets `security_invoker = true` on `funnel_report` and narrows its grants, restoring the view's originally-intended (but never actually working) admin-only behavior.
- **006** (`v109`) replaces `notifications`' `with check (true)` insert policy with `public.is_staff()`, matching the one real producer traced in the codebase.

All 46 automated regression tests pass (10 required categories from the approval, one test per concrete scenario — see Section 7/8).

**One significant, pre-existing, unrelated bug was discovered while building the test harness and must be read as the most urgent item in this report** — see Section 14. It is a live payment-processing failure, not a security hole, and is explicitly **not** fixed here because fixing it is a behavior change outside this sprint's "security hardening only" approval.

---

## 2. Files Changed

All new files. Nothing existing was modified.

```
portal/supabase-portal-schema-v104-rpc-privilege-hardening.sql          (81 lines)
portal/supabase-portal-schema-v105-function-search-path-hardening.sql   (26 lines)
portal/supabase-portal-schema-v106-claim-function-service-role-only.sql (49 lines)
portal/supabase-portal-schema-v107-admin-grant-tightening.sql           (89 lines)
portal/supabase-portal-schema-v108-funnel-report-gating.sql             (61 lines)
portal/supabase-portal-schema-v109-notifications-insert-policy-hardening.sql (59 lines)
test/sql/00_harness_schema.sql                                          (786 lines)
test/sql/01_fixtures.sql                                                (36 lines)
test/run_security_regression_tests.sh                                  (240 lines)
SPRINT_0_PHASE_2A_REPORT.md                                             (this file)
```

`git diff --stat` (all untracked/new, nothing staged or committed — no existing file was touched):

```
 SPRINT_0_PHASE_2A_REPORT.md                                                  | new file
 portal/supabase-portal-schema-v104-rpc-privilege-hardening.sql               | 81 ++++++++
 portal/supabase-portal-schema-v105-function-search-path-hardening.sql        | 26 +++
 portal/supabase-portal-schema-v106-claim-function-service-role-only.sql      | 49 +++++
 portal/supabase-portal-schema-v107-admin-grant-tightening.sql                | 89 +++++++++
 portal/supabase-portal-schema-v108-funnel-report-gating.sql                  | 61 +++++++
 portal/supabase-portal-schema-v109-notifications-insert-policy-hardening.sql | 59 +++++++
 test/run_security_regression_tests.sh                                       | 240 ++++++++++++++++++++
 test/sql/00_harness_schema.sql                                               | 786 +++++++++++++++++++++++++++++
 test/sql/01_fixtures.sql                                                     | 36 +++
 9 files changed, 1427 insertions(+)
```

No edits to `site/`, `portal/src/`, or any Edge Function. No Edge Function was deployed.

---

## 3. Migrations Created

| File | Purpose |
|---|---|
| `portal/supabase-portal-schema-v104-rpc-privilege-hardening.sql` | 001 — revoke client EXECUTE on the 4 P0 functions |
| `portal/supabase-portal-schema-v105-function-search-path-hardening.sql` | 002 — pin `search_path` on `is_admin()`/`is_staff()` |
| `portal/supabase-portal-schema-v106-claim-function-service-role-only.sql` | 003 — make 3 claim-style functions server-only |
| `portal/supabase-portal-schema-v107-admin-grant-tightening.sql` | 004 — drop `anon` EXECUTE from the admin/staff function family |
| `portal/supabase-portal-schema-v108-funnel-report-gating.sql` | 005 — `funnel_report` security-invoker + grant narrowing |
| `portal/supabase-portal-schema-v109-notifications-insert-policy-hardening.sql` | 006 — real `WITH CHECK` on the notifications insert policy |

Each file is self-contained, idempotent (safe to re-run), source-commented with the security rationale and the verified caller trace, and carries its own rollback instructions in a trailing comment block. Numbered `v104`–`v109` to continue this repo's existing flat `supabase-portal-schema-vNNN.sql` convention (last used number was `v103`).

---

## 4. Exact Before/After Privileges

All values below are the **actual live production ACL** read via `pg_proc.proacl` in Phase 1B (not assumed), and the **actual harness-verified post-migration state** (confirmed via `has_function_privilege()` in the test run).

```
FUNCTION: confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)
BEFORE:  PUBLIC: yes (explicit) | anon: yes (explicit) | authenticated: yes (explicit) | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: no | service_role: yes
VERIFIED: has_function_privilege('anon'/'authenticated', ..., 'EXECUTE') = false; service_role = true (test-confirmed)

FUNCTION: confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
BEFORE:  PUBLIC: yes | anon: yes | authenticated: yes | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: no | service_role: yes
VERIFIED: direct anon/authenticated calls denied in test; service_role call succeeds; enroll_in_ground_school_via_pack (its real caller) still succeeds for an entitled learner

FUNCTION: confirm_legacy_ground_registration(uuid,text,text,uuid,text,integer)
BEFORE:  PUBLIC: yes | anon: yes | authenticated: yes | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: no | service_role: yes
VERIFIED: as above

FUNCTION: award_xp(uuid,text,integer,text,text,jsonb)
BEFORE:  PUBLIC: yes | anon: yes | authenticated: yes | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: no | service_role: yes
VERIFIED: direct anon/authenticated calls denied; admin_award_xp, the practice-attempt trigger, and a same-key retry (idempotency) all still work correctly

FUNCTIONS: claim_ground_school_enrollments_by_email(uuid,text), claim_readiness_assessment_by_email(uuid,text), record_referral_signup(uuid,text,text)
BEFORE:  PUBLIC: yes | anon: yes | authenticated: yes | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: no | service_role: yes
VERIFIED: direct anon/authenticated calls denied; service-role calls (matching create-free-account's client) succeed

FUNCTIONS (004 family): admin_award_xp, admin_unlock_checkride_prep, assign_ground_school_class_bid,
  cancel_scheduled_ground_class_enrollment, finish_scheduled_ground_class, start_scheduled_ground_class,
  get_activation_email_kpis, get_analytics_data_quality, get_channel_performance,
  get_checkride_prep_funnel_stats, get_ground_school_funnel_stats, get_marketing_executive_funnel,
  get_marketing_revenue_summary, get_portal_activation_funnel, get_readiness_funnel_stats,
  get_retention_kpis, get_utm_campaign_performance
BEFORE:  PUBLIC: yes | anon: yes | authenticated: yes | service_role: yes
AFTER:   PUBLIC: no | anon: no | authenticated: yes (preserved) | service_role: yes
VERIFIED: anon denied, authenticated non-admin denied (internal check), authenticated admin succeeds

FUNCTIONS (already correct, no change): admin_grant_study_pack_entitlement, admin_revoke_study_pack_entitlement,
  admin_list_study_pack_entitlements
BEFORE = AFTER: PUBLIC: no | anon: no | authenticated: yes | service_role: yes (confirmed via live ACL read before writing 004 -- these three never had the anon/PUBLIC grant the others did)
```

---

## 5. Notification Policy Before/After

**Before (confirmed live, per the review's independent verification):**
```
policy: "Staff insert notifications"
roles: {public}      -- i.e. PUBLIC, no role restriction
command: INSERT
with check: true      -- no check at all
table grants: anon INSERT = yes, authenticated INSERT = yes
```

**After:**
```
policy: "Staff insert notifications"
roles: authenticated (restricted via `for insert to authenticated`)
command: INSERT
with check: public.is_staff()   -- admin or instructor, per is_staff()'s own definition
table grants: anon INSERT = revoked, authenticated INSERT = unchanged
```

**Caller trace performed before writing the policy** (required by the approval — not inferred from the policy's name):
- The only INSERT producer anywhere in the repo is `notify()` in `portal/src/context/NotificationContext.jsx`.
- Its only two call sites are in `portal/src/pages/Schedule.jsx`, inside `handleApproveRequest()`/`handleDeclineRequest()`, both gated in that component by `isAdmin || isInstructor` — exactly `public.is_staff()`.
- The `/schedule` route has **no** role restriction at the router level (`<ProtectedRoute><Schedule /></ProtectedRoute>`, no `roles` prop) — a student can load the page, which is exactly why the client-side `isAdmin`/`isInstructor` branching was never a real security boundary and the RLS policy's `with check (true)` was directly exploitable by any authenticated member (or, per the table grant, even `anon`).
- No Edge Function, SQL function, or trigger inserts into `notifications`.
- `office_manager` has no notification-producer path anywhere in the codebase today (checked every office-manager-reachable screen, e.g. `AdminGroundSchoolSchedule.jsx`) — deliberately **not** added to the policy, per the instruction not to design for a capability nothing currently uses.

---

## 6. Funnel Report Design Decision

**Root cause identified:** `funnel_report` (`supabase-portal-schema-v39.sql`) was created as a plain view with the comment "admin-only via analytics_events' own RLS (views run with the querying role's permissions, not the owner's, by default)." That belief was backwards for a plain view: pre-PG15 (and still by default in PG15+), a view's underlying-table reads are permission-/RLS-checked as the **view owner**, not the querying role. The owner here is `postgres`, which carries `rolbypassrls = true` — so every query through this view has always silently bypassed `analytics_events`' "Admins can view analytics events" RLS policy.

**Caller trace performed before choosing a fix:** a full-repo grep for `funnel_report` found exactly one match — the `v39` migration that created it. No page in `site/` or `portal/src`, no Edge Function, and no other SQL function currently selects from it. The admin dashboard's real funnel reporting already goes through the properly `is_admin()`-gated `get_marketing_executive_funnel()`/`get_checkride_prep_funnel_stats()`/`get_ground_school_funnel_stats()`/`get_readiness_funnel_stats()`/`get_retention_kpis()`/`get_utm_campaign_performance()` RPCs (hardened for grant hygiene in 004). **This view has zero live callers today.**

**Design decision: Approach A** (`security_invoker = true` + underlying RLS), the first-listed preferred option. Chosen over Approach B (revoke + wrap in a new admin RPC) because:
- It's a one-line fix using the exact PG15+ feature built for this footgun, restoring the *original* intended behavior rather than inventing new surface area.
- Approach B would just duplicate `get_marketing_executive_funnel`, which already exists and is already correct.
- No live caller needs preserving, so there's no migration risk either way — Approach A was simply the more correct, more minimal fix.

`anon` access is revoked entirely (never had a legitimate use); `authenticated` keeps `SELECT` — with `security_invoker` now on, a non-admin authenticated caller correctly gets zero rows (the same safe "RLS decides, not the grant" pattern already used elsewhere in this codebase, e.g. `get_member_capabilities`), and an admin caller gets the real aggregate. **Underlying `analytics_events` RLS was not weakened** — if anything, this migration is what makes that RLS apply to this view for the first time.

---

## 7. Tests Added

`test/run_security_regression_tests.sh` (240 lines) — a self-contained script that:
1. Rebuilds a disposable local Postgres database (`apex_test`) from scratch.
2. Applies `test/sql/00_harness_schema.sql` — a **BEFORE-state** reproduction of every table/policy/function these six migrations and the required tests touch, with bodies copied verbatim from `pg_get_functiondef()` output read against the live project in Phase 1/1B (not reconstructed from memory), plus `anon`/`authenticated`/`service_role` roles and an `auth.uid()`/`auth.role()` stub matching Supabase's real semantics closely enough for grant/RLS testing (session GUCs instead of JWT claims).
3. Applies all six migrations (`v104`–`v109`) verbatim, unmodified from what would be applied to production.
4. Loads `test/sql/01_fixtures.sql` (6 profiles across every relevant role, a scheduled class, a legacy session, a referral code, etc.).
5. Runs 46 individual assertions across the 10 required categories, each as its own `psql` invocation under `SET ROLE anon/authenticated/service_role` plus a `myapp.uid` session GUC standing in for `auth.uid()`.

This is a genuine functional/security test against real Postgres objects (grants, RLS, triggers, SECURITY DEFINER execution) — not a mock.

---

## 8. Full Test Results

```
########## 1. GROUND SCHOOL FORGERY ##########
PASS: confirm_scheduled_ground_class_enrollment(6-arg): anon EXECUTE revoked
PASS: confirm_scheduled_ground_class_enrollment(6-arg): authenticated EXECUTE revoked
PASS: confirm_scheduled_ground_class_enrollment(6-arg): service_role EXECUTE preserved
PASS: anon direct RPC confirm_scheduled_ground_class_enrollment(7-arg) -> denied
PASS: authenticated member direct RPC confirm_scheduled_ground_class_enrollment(7-arg) -> denied
PASS: service-role confirm_scheduled_ground_class_enrollment(7-arg) still works
PASS: enroll_in_ground_school_via_pack still works for an entitled learner
PASS: enroll_in_ground_school_via_pack still rejects a non-entitled learner

########## 2. LEGACY GROUND REGISTRATION ##########
PASS: anon direct confirm_legacy_ground_registration -> denied
PASS: authenticated member direct confirm_legacy_ground_registration -> denied
PASS: service-role (stripe-webhook) confirm_legacy_ground_registration still works

########## 3. XP ##########
PASS: anon direct award_xp -> denied
PASS: authenticated member direct award_xp -> denied
PASS: practice-attempt trigger XP path still works
PASS: admin_award_xp still works for a real admin
PASS: admin_award_xp still rejects a non-admin
PASS: no duplicate XP from a retried admin_award_xp with the same idempotency key

########## 4. CLAIM FUNCTIONS ##########
PASS: anon direct claim_ground_school_enrollments_by_email -> denied
PASS: authenticated direct claim_ground_school_enrollments_by_email -> denied
PASS: service-role (create-free-account) claim_ground_school_enrollments_by_email still works
PASS: anon direct claim_readiness_assessment_by_email -> denied
PASS: service-role (create-free-account) claim_readiness_assessment_by_email still works
PASS: authenticated direct record_referral_signup -> denied
PASS: service-role (create-free-account) record_referral_signup still works

########## 5. ADMIN RPCS ##########
PASS: member -> rejected on get_retention_kpis
PASS: authorized admin -> succeeds on get_retention_kpis
PASS: anon -> no EXECUTE on get_retention_kpis
PASS: anon -> no EXECUTE on admin_award_xp

########## 6. PROFILE PRIVILEGE REGRESSION ##########
PASS: self-escalation attempt on role/checkride_prep_unlocked has no effect

########## 7. AI TABLES ##########
PASS: authenticated client direct INSERT into ai_dpe_sessions -> denied
PASS: authenticated client direct INSERT into ai_cfi_messages -> denied
PASS: owner can still read own ai_dpe_sessions row

########## 8. ENTITLEMENTS ##########
PASS: member cannot insert study_pack_entitlements for self
PASS: admin grant to study_pack_entitlements still works

########## 9. NOTIFICATIONS (migration 006) ##########
PASS: anon cannot insert notification
PASS: normal member cannot insert notification targeting another user
PASS: instructor (authorized producer) can insert a notification
PASS: admin (authorized producer) can insert a notification
PASS: normal user can still SELECT own notifications
PASS: normal user can still mark own notification read
PASS: normal user cannot read another user's notifications

########## 10. CROSS-USER ISOLATION ##########
PASS: member A cannot read member B's profile row
PASS: member A cannot read member B's XP ledger
PASS: member A cannot read member B's AI DPE sessions
PASS: member A cannot read member B's study pack entitlements
PASS: member A's update attempt on member B's profile has no effect (RLS filters the row, 0 rows touched)

==================================================
RESULTS: 46 passed, 0 failed
==================================================
```

---

## 9. Web Callers Verified

Full-repo greps (not sampled) confirmed, for every function touched by these six migrations:

- `confirm_scheduled_ground_class_enrollment` (both overloads), `confirm_legacy_ground_registration`: sole caller is `portal/supabase/functions/stripe-webhook/index.ts` (service-role client).
- `award_xp`: **zero** direct `.rpc('award_xp', ...)` call sites anywhere in the repo. Only reached via `admin_award_xp`, `log_daily_dispatch_open`, `refresh_mission_progress`, and the `trg_award_xp_*` triggers.
- `claim_ground_school_enrollments_by_email`, `claim_readiness_assessment_by_email`, `record_referral_signup`: sole caller is `portal/supabase/functions/create-free-account/index.ts`, confirmed at the source line (`createClient(SUPABASE_URL, SERVICE_ROLE_KEY)`, line 91) to use a service-role client for every RPC call in that function.
- Admin/staff function family (004): called exclusively from `portal/src/pages/*.jsx` (the admin/staff React app), always while authenticated.
- `notifications` insert: sole producer is `NotificationContext.jsx`'s `notify()`, called only from `Schedule.jsx`'s admin/instructor-gated handlers (see Section 5).
- `funnel_report`: **zero** current callers anywhere in `site/` or `portal/src` (see Section 6).

---

## 10. Legitimate Server Callers Verified

| Server caller | Client type | Confirmed at |
|---|---|---|
| `stripe-webhook/index.ts` | `service_role` | line 100 (`const SERVICE_ROLE_KEY = ...`), used to construct the Supabase client for both `confirm_scheduled_ground_class_enrollment` calls and `confirm_legacy_ground_registration` |
| `create-free-account/index.ts` | `service_role` | line 91, single client instance used for `record_referral_signup`, `claim_ground_school_enrollments_by_email`, `claim_readiness_assessment_by_email` |
| `send-lifecycle-emails/index.ts` | `service_role` | calls `run_streak_maintenance()` and `refresh_mission_progress()` daily (see Section 11) — not touched by this sprint's migrations, but verified as the authoritative caller for the deferred item |
| `enroll_in_ground_school_via_pack` (internal SQL, not a server process) | executes as `postgres` (shared function owner) | proven safe independent of grants — object-owner privilege, see the header comment in `v104` |
| `admin_award_xp` / trigger functions (internal SQL) | executes as `postgres` | same reasoning, calling `award_xp` |

---

## 11. Deferred Mission/Streak Scheduling Analysis

**Finding: a real, active, authoritative scheduling mechanism for both functions already exists — it was just indirect, which is why the direct `pg_cron` search in the approval came back empty.**

`portal/supabase/functions/send-lifecycle-emails/index.ts` (lines 1426–1439) calls both functions, unconditionally, near the end of its daily run:
```ts
const { error: streakError } = await supabase.rpc('run_streak_maintenance')
...
const { error: missionError } = await supabase.rpc('refresh_mission_progress')
```
using the same service-role client as the rest of that file. That Edge Function **is** scheduled — it's the one active `pg_cron` job in the project (`send-lifecycle-emails-daily`, `0 13 * * *`, confirmed `active = true` in `cron.job` at the time of this report). So "no `pg_cron` job references either function directly" is true and "these functions are unscheduled" is false — they run daily, once, as a side effect of the lifecycle-email cron job, as `service_role`.

**Recommendation:** once this is confirmed against production behavior (e.g. checking `send-lifecycle-emails`' own run logs for `run_streak_maintenance`/`refresh_mission_progress` error entries, to make sure they're actually succeeding day to day), the correct fix for both functions is the exact same pattern as every migration in this report: revoke `anon`/`authenticated` EXECUTE, keep `service_role`. The sole legitimate caller is already service-role and would be completely unaffected. This is a trivial, low-risk follow-up migration (suggested name: `007_mission_streak_client_lockout`) for the **next** approval cycle — not implemented here per the explicit deferral instruction.

---

## 12. Manual QA Required (before production deployment)

1. Run `select pg_get_functiondef(oid) from pg_proc where proname = 'confirm_scheduled_ground_class_enrollment'` against production and confirm the two overload bodies match what this report assumes (they were read directly from production in Phase 1B, but re-confirm immediately before applying, since schema drift is possible between audit and deployment).
2. **Before applying `v104`**, resolve the overload-ambiguity bug in Section 14 — applying `v104` alone does not fix or worsen it, but deploying security fixes on top of a function pair that's silently failing every real call deserves a conscious decision, not an accidental parallel fix.
3. After applying `v109`, manually test the real `Schedule.jsx` "Approve"/"Decline" lesson-request buttons as both an instructor and an admin account against a staging environment, confirming the notification still gets created and the student still sees it.
4. After applying `v108`, manually confirm nothing in the admin dashboard silently broke (Phase 1B's repo-wide grep found no caller, but a staging click-through is cheap insurance).
5. Confirm Supabase's project-level "default privileges" setting (the thing that silently re-grants `anon`/`authenticated` EXECUTE to *newly created* functions) does not also apply retroactively or get re-triggered by any deploy tooling in a way that would silently undo these revocations on a future migration.

---

## 13. Rollback Plan

Each migration file carries its own rollback commands in a trailing SQL comment block (re-`GRANT`, `RESET search_path`, restore the original policy text, `ALTER VIEW ... RESET (security_invoker)`). All six are pure privilege/policy changes — **no migration in this set touches, moves, or deletes a single row of data**, so rollback is a metadata-only operation with no data-loss risk in either direction. Recommended rollback order is the reverse of apply order (`v109` → `v104`), though because each migration is independent (no migration depends on another's schema objects), any subset can be rolled back individually if only one causes an unexpected regression.

---

## 14. Remaining Risks

**Urgent, out-of-scope discovery — read this first.** While building the test harness, invoking `confirm_scheduled_ground_class_enrollment` with exactly the 6 parameters `stripe-webhook/index.ts` actually passes (`p_scheduled_ground_class_id, p_full_name, p_email, p_profile_id, p_stripe_session_id, p_amount_cents` — no `p_payment_status`) produces:
```
ERROR: function public.confirm_scheduled_ground_class_enrollment(...) is not unique
HINT: Could not choose a best candidate function. You might need to add explicit type casts.
```
This was reproduced **both** in the local test harness **and** via a safe, read-only, no-op diagnostic call against the live production database (a nonexistent class id, so the call could only ever raise a normal "not found" error if resolution succeeded — instead it hit the same ambiguity error, confirming this is live in production right now, not a harness artifact). The root cause: the 7-arg overload's `p_payment_status` parameter has a `DEFAULT`, and Postgres's function-resolution rules do not disambiguate between "6 required params" and "6 required + 1 defaulted param" when called with exactly 6 arguments, named or positional, even with exact type casts. **This makes the 6-arg overload permanently unreachable by any caller, and — far more importantly — means `stripe-webhook`'s modern scheduled-class Ground School registration path has likely been failing on every real Stripe payment since the 7-arg overload was introduced**, silently triggering that handler's own refund-and-email-admin fallback (a real customer would be refunded and told "we couldn't complete that registration," and an `info@apexaviationtx.com` alert would fire) rather than completing.

This is a **payment-processing correctness bug, not a security bug**, it existed identically before this sprint started, and this sprint's migrations neither cause nor worsen it (grant revocation happens after Postgres already fails to resolve which overload to call). It is explicitly out of scope for "security hardening only," since any real fix (dropping the 6-arg overload, since it's provably dead code and the 7-arg one already covers `'paid'` as a valid `p_payment_status`; or removing the default from the 7-arg overload; and updating `stripe-webhook` to always pass `p_payment_status`) is a behavior change requiring its own explicit approval. **Recommend raising this as its own urgent, separate item immediately** — every day it's live is a day real Ground School registrations may be silently failing and refunding.

Other remaining risks, all previously identified and unchanged by this sprint:
- Sections B.7/E-P2 items (`refresh_mission_progress`/`run_streak_maintenance` client lockout) — analyzed in Section 11, deferred per instruction.
- `ai_dpe_sessions`/`ai_cfi_messages` write-path assumption is now empirically test-confirmed (Section 8, category 7) rather than merely believed — closes out that Phase 1B open item.
- `profiles`' self-update-then-trigger-reverts design is now test-confirmed (Section 8, category 6) rather than merely believed — closes out that Phase 1B open item.
- The harness is a faithful-but-partial schema reproduction (the objects these six migrations and required tests touch, not the full ~150-table production schema) — a staging-environment smoke test (Section 12) is still warranted before production deployment, not as a substitute for these results but as final confirmation against the real, complete schema.

---

## 15. Recommendation: GO / NO-GO for applying migrations to production

**GO for migrations 001–006 (`v104`–`v109`) as written**, contingent on:
1. Reading and acting on Section 14 as its own urgent item — ideally resolved or at least consciously triaged *before* or *alongside* deploying `v104`, so the ground-school payment bug and this security fix aren't conflated in a single incident review later.
2. Completing the Manual QA checklist in Section 12.

No migration in this set has a known negative interaction with any other pending work, no migration touches data, and every legitimate caller traced in Phase 1B has now been empirically re-verified against real Postgres grant/RLS enforcement, not just read from source.

**SPRINT 0 PHASE 2A COMPLETE — AWAITING PRODUCTION DEPLOYMENT REVIEW.**
