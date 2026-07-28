-- Bug fix (v44): portal_events and portal_email_log both grant
-- authenticated users "for all" (full CRUD) on their own rows with no
-- restriction on which event_type/email_type values a client can write.
-- portal_events.event_type = 'premium_unlocked'/'ground_school_purchased'
-- are revenue signals written server-side (stripe-webhook, service role,
-- which bypasses RLS entirely and is unaffected by this migration), and
-- portal_email_log gates the entire pre-purchase upsell drip in
-- send-lifecycle-emails. As written, any signed-in member could forge a
-- fake 'premium_unlocked' event via the client library, or pre-insert a
-- later drip stage's email_type to permanently suppress their own
-- upsell emails, or delete rows to make throttled emails re-fire.
--
-- Fix: replace each "for all" policy with three narrower ones --
-- SELECT own rows, INSERT own rows restricted to the specific
-- event_type/email_type values portal-stable.js's client-side calls
-- actually use (see logEventOnce/logEmailSent), and no UPDATE/DELETE
-- grant at all (the client never legitimately does either). Service-
-- role edge functions are untouched since RLS never applies to them.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v43.

drop policy if exists "Users manage their own events" on public.portal_events;

create policy "Users can view their own events"
  on public.portal_events for select
  using (auth.uid() = profile_id);

create policy "Users can log their own client-side events"
  on public.portal_events for insert
  with check (
    auth.uid() = profile_id
    and (
      event_type in ('first_login', 'first_question_completed', 'checkride_mode_completed_email', 'checkride_passed', 'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90')
      or event_type like 'mock_oral_requested_%'
    )
  );

drop policy if exists "Users manage their own email log" on public.portal_email_log;

create policy "Users can view their own email log"
  on public.portal_email_log for select
  using (auth.uid() = profile_id);

create policy "Users can log their own client-side emails"
  on public.portal_email_log for insert
  with check (
    auth.uid() = profile_id
    and email_type in ('first_question_completed', 'checkride_mode_completed_email', 'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90')
  );
