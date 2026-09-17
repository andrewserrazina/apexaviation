-- Apex Advantage — Email audit follow-up: real unsubscribe/preferences
--
-- The email redesign shipped a footer link to
-- https://apexaviationtx.com/email-preferences.html on every outgoing
-- email, but that page never existed anywhere in the repo and no
-- consent/suppression state existed to back it. This migration adds the
-- one column the preferences page and the lifecycle sender need.
--
-- Deliberately a single boolean on profiles, not a new table or a
-- per-category preference set: every non-essential Apex Advantage email
-- (checkride-upsell, weak-area, weekly-progress, reactivation,
-- inactivity, streak-recovery, ground-school promotional follow-up) is
-- the same "training nudges" relationship in the member's eyes, and a
-- granular per-sequence toggle would be more UI than a member actually
-- wants to manage. Purchase/booking confirmations, milestone
-- celebrations, and the checkride countdown are relationship/
-- transactional messages tied to something the member did themselves
-- (paid, registered, hit a milestone, entered a real checkride date) and
-- are never gated by this flag -- see send-lifecycle-emails/index.ts's
-- own comment at the call sites for the exact classification.
--
-- No self-update policy exists yet for a member's own profile row that
-- would block this: "Members can update their own profile" (v8) already
-- covers UPDATE via auth.uid() = id, and
-- lock_profile_privileged_columns() (v8) only force-reverts role,
-- checkride_prep_unlocked, email, and created_at for non-admins -- this
-- new column passes through untouched, so no trigger change is needed
-- for site/email-preferences.html to work.
alter table public.profiles
  add column if not exists email_marketing_opt_out boolean not null default false;

comment on column public.profiles.email_marketing_opt_out is
  'Set by the member from email-preferences.html (self-update RLS, no new policy needed). true suppresses non-essential lifecycle/marketing sends in send-lifecycle-emails and site/portal-stable.js -- never purchase/booking confirmations, milestones, or the checkride countdown.';
