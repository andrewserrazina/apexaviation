-- Apex Advantage — Close anonymous ground_sessions enumeration (v162)
--
-- Final verification pass (Oct 2026) found that ground_sessions (the
-- legacy Group Ground School table) had a SELECT policy of `qual: true`
-- -- readable by a fully anonymous, unauthenticated client. Combined
-- with create-checkout-session's 'ground-school-registration' purpose
-- (now closed in the same deploy as this migration, see the Edge
-- Function's own header comment), this meant a completely anonymous
-- script could discover real session ids and, before that purpose was
-- closed, register and pay for a real session with no login at all.
--
-- scheduled_ground_classes (the modern equivalent table) already
-- required `auth.role() = 'authenticated'` for the same SELECT -- this
-- just brings ground_sessions in line with that same, already-accepted
-- minimum bar. It does not require any particular role or entitlement
-- beyond being signed in, so every existing enrollee (free member or
-- paid) keeps exactly the read access they already had; only a
-- logged-out, anonymous client loses the ability to enumerate rows.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v161.

drop policy if exists "Anyone can view ground sessions" on public.ground_sessions;

create policy "Authenticated members can view ground sessions"
  on public.ground_sessions
  for select
  to public
  using (auth.role() = 'authenticated');
