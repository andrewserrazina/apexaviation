-- Apex Advantage Sprint 0 Phase 2A -- 006_notifications_insert_policy_hardening (v109)
--
-- Confirmed live security issue (verified independently before this
-- migration was approved): public.notifications had an INSERT policy
-- named "Staff insert notifications", role PUBLIC, `with check (true)` --
-- i.e. no check at all -- combined with table-level INSERT privilege held
-- by both anon and authenticated. Any signed-in member (or, per the table
-- grant, even an anonymous caller) could insert a notification row
-- addressed to any other user_id with arbitrary title/body/link content.
--
-- Caller trace performed before choosing the replacement rule (per the
-- Phase 2A instruction not to infer the correct check from the policy
-- name alone):
--   - The ONLY place in the entire repo that inserts into `notifications`
--     is `notify()` in portal/src/context/NotificationContext.jsx.
--   - Its only two call sites are in portal/src/pages/Schedule.jsx,
--     inside handleApproveRequest()/handleDeclineRequest() -- both gated
--     in that component by `isAdmin || isInstructor` (i.e. exactly
--     `public.is_staff()`, which already means role in ('admin','instructor')).
--   - The `/schedule` route itself has no role restriction at the router
--     level (`<ProtectedRoute><Schedule /></ProtectedRoute>`, no `roles`
--     prop) -- students can load the page -- so the UI-level isAdmin/
--     isInstructor branching was never a real security boundary; the RLS
--     policy is the only actual enforcement point, which is exactly why
--     `with check (true)` was exploitable.
--   - No Edge Function, SQL function, or trigger inserts into
--     `notifications` anywhere in the codebase.
--   - office_manager has no notification-producer path today: grepping
--     every office-manager-reachable screen (e.g. AdminGroundSchoolSchedule.jsx)
--     found no call to notify() or a direct insert. Not included in the
--     new policy -- there is nothing in the codebase today that proves
--     that need. Add it in a future migration, alongside a real caller,
--     if that changes -- per this codebase's own stated principle of not
--     designing for a capability nothing currently uses.
--
-- Replacement rule: `public.is_staff()` alone (admin or instructor),
-- which exactly matches the one real producer traced above. is_staff()'s
-- search_path was pinned in 002_function_search_path_hardening (v105),
-- applied before this migration.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY is safe to re-run;
-- REVOKE on an already-revoked privilege is a no-op.
--
-- Rollback:
--   drop policy if exists "Staff insert notifications" on public.notifications;
--   create policy "Staff insert notifications" on public.notifications for insert with check (true);
--   grant insert on public.notifications to anon;

drop policy if exists "Staff insert notifications" on public.notifications;

create policy "Staff insert notifications"
  on public.notifications
  for insert
  to authenticated
  with check (public.is_staff());

-- No current caller inserts as anon; narrow the table-level grant to
-- match the RLS policy's own "to authenticated" scope.
revoke insert on public.notifications from anon;
