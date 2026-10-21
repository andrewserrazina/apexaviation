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
 rules_accepted_at timestamptz not null,
 created_at timestamptz not null default now(),
 constraint giveaway_unique_email_per_campaign unique(campaign_id,email_normalized)
);
alter table public.mock_oral_giveaway_entries enable row level security;
revoke all on public.mock_oral_giveaway_entries from anon,authenticated;
-- Service role only, through verified server function. Never expose entrant rows to public clients.
create index if not exists idx_giveaway_entries_created on public.mock_oral_giveaway_entries(campaign_id,created_at);
