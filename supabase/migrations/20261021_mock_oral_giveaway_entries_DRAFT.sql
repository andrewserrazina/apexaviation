-- Draft migration: apply only after Official Rules and age/geography eligibility are approved.
create table if not exists public.mock_oral_giveaway_entries (
 id uuid primary key default gen_random_uuid(),
 campaign_id text not null default 'mock_oral_2026_oct',
 first_name text not null check (char_length(first_name) between 1 and 80),
 email text not null,
 email_normalized text generated always as (lower(btrim(email))) stored,
 checkride_timing text not null check (checkride_timing in ('within_14_days','within_30_days','within_90_days','not_scheduled')),
 entry_method text not null check (entry_method in ('assessment','direct')),
 assessment_completed boolean not null default false,
 marketing_opt_in boolean not null default false,
 eligibility_status text not null default 'pending' check (eligibility_status in ('pending','eligible','ineligible')),
 eligibility_reviewed_at timestamptz,
 eligibility_review_note text,
 eligibility_reviewed_by text,
 rules_accepted_at timestamptz not null,
 created_at timestamptz not null default now(),
 constraint giveaway_unique_email_per_campaign unique(campaign_id,email_normalized)
);
alter table public.mock_oral_giveaway_entries enable row level security;
revoke all on public.mock_oral_giveaway_entries from anon,authenticated;
-- Service role only, through verified server function. Never expose entrant rows to public clients.
create index if not exists idx_giveaway_entries_eligibility on public.mock_oral_giveaway_entries(campaign_id,eligibility_status);
create index if not exists idx_giveaway_entries_created on public.mock_oral_giveaway_entries(campaign_id,created_at);

-- Per-address submission throttling. Not a substitute for edge/WAF IP rate limits.
-- Store only a one-way SHA-256 digest; service-role only.
create table if not exists public.mock_oral_giveaway_rate_limits (
 campaign_id text not null,
 email_hash text not null check (char_length(email_hash)=64),
 window_start timestamptz not null,
 attempts integer not null default 1 check (attempts between 1 and 10000),
 primary key(campaign_id,email_hash,window_start)
);
alter table public.mock_oral_giveaway_rate_limits enable row level security;
revoke all on public.mock_oral_giveaway_rate_limits from anon,authenticated;
-- Atomic account/email-level throttle implemented via RPC; no public execute rights.
create or replace function public.mock_oral_giveaway_take_rate_limit(
 p_campaign text, p_email_hash text, p_bucket timestamptz
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_attempts integer;
begin
 if p_campaign <> 'mock_oral_2026_oct' or
    p_email_hash !~ '^[0-9a-f]{64}$' or p_bucket is null then
    return false;
 end if;
 insert into public.mock_oral_giveaway_rate_limits(campaign_id,email_hash,window_start,attempts)
 values(p_campaign,p_email_hash,p_bucket,1)
 on conflict(campaign_id,email_hash,window_start)
 do update set attempts = mock_oral_giveaway_rate_limits.attempts+1
 returning attempts into v_attempts;
 return v_attempts <= 5;
end; $$;
revoke all on function public.mock_oral_giveaway_take_rate_limit(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mock_oral_giveaway_take_rate_limit(text,text,timestamptz) to service_role;
