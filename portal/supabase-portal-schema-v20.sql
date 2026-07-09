-- Apex Advantage — lifecycle email dedupe hardening (v20)
-- Ensures the email log exists in the portal migration chain and prevents
-- weak-area recommendation drip emails from repeating for the same member.

create table if not exists public.portal_email_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  email_type  text not null,
  sent_at     timestamptz not null default now()
);

alter table public.portal_email_log enable row level security;

drop policy if exists "Users manage their own email log" on public.portal_email_log;
create policy "Users manage their own email log"
  on public.portal_email_log for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists "Admins can view all email log" on public.portal_email_log;
create policy "Admins can view all email log"
  on public.portal_email_log for select
  using (public.is_admin(auth.uid()));

with ranked as (
  select id,
         row_number() over (partition by profile_id, email_type order by sent_at asc, id asc) as rn
  from public.portal_email_log
  where email_type like 'weak_area_%'
)
delete from public.portal_email_log log
using ranked
where log.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists portal_email_log_weak_area_once_idx
  on public.portal_email_log (profile_id, email_type)
  where email_type like 'weak_area_%';
