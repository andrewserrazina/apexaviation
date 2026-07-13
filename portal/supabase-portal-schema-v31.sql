-- Abandoned-checkout recovery: logs every Stripe Checkout Session
-- create-checkout-session creates, across all purposes (Checkride Prep
-- unlock, the combined signup+unlock, ground school registration, mock
-- oral booking). stripe-webhook stamps completed_at the moment a
-- session actually completes; send-lifecycle-emails' new
-- processAbandonedCheckouts() finds rows still uncompleted a while
-- later and sends a one-time nudge, using this table (not a fresh
-- Stripe API call) as the single source of truth for "did this ever
-- finish" -- consistent with the rest of this schema's pattern of
-- treating the webhook as authoritative over checkout outcomes.
create table public.checkout_session_attempts (
  id                      uuid primary key default gen_random_uuid(),
  stripe_session_id       text not null unique,
  purpose                 text not null,
  email                   text,
  profile_id              uuid references public.profiles(id),
  amount_cents            integer,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz,
  recovery_email_sent_at  timestamptz
);

alter table public.checkout_session_attempts enable row level security;

create policy "Admins can view all checkout session attempts"
  on public.checkout_session_attempts for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
