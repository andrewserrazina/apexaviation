-- Acquisition & Revenue Attribution Repair (v156)
--
-- *** THIS MIGRATION IS NOT APPLIED TO PRODUCTION. ***
-- Written and validated against a local harness only (see
-- test/sql/v156_attribution_harness.sql). Applying it to the live
-- project requires separate, explicit human approval -- see this
-- session's report for why (new columns/tables only, no data mutation,
-- but still a production migration).
--
-- Context (verified production findings, Oct 8 2026): 271 profiles, 128
-- with signup_utm_source, 143 without. Reconciliation against analytics
-- events, anonymous identity links, and readiness-assessment leads found
-- 29 additional profiles with recoverable external-channel signals (18
-- Facebook, 5 Instagram, 6 Email) that signup_utm_source alone misses.
-- 26 paid invoices / 24 distinct customers / $1,967 total gross, spread
-- across invoices + ground_registrations with no legitimate way to sum
-- them as independent totals (verified_purchases, v153, already unions
-- them correctly with no overlap -- this migration extends that view,
-- it does not replace it or add a second revenue total next to it).
--
-- Root causes found by this migration's audit (see the session report
-- for the full walkthrough of every code path read):
--   1. analytics-events.js captured UTM params and a `ref` code, but
--      never document.referrer or ad-platform click IDs (fbclid/gclid/
--      etc) -- a paid click that landed with no utm_* at all (several ad
--      templates omit them) left zero channel signal whatsoever, even
--      though the referrer or click id would have identified it.
--   2. There was no "signup-touch" concept distinct from first-touch --
--      profiles.signup_utm_* is written once, at account-creation time,
--      from the client's `_first`-suffixed (genuine first-touch)
--      localStorage keys. That's correct as far as it goes, but nothing
--      captured what the LATEST touch was at that same moment, so a
--      visitor who first arrived organically, then returned later via a
--      Facebook retargeting ad and signed up on that visit, has their
--      Facebook touch recorded nowhere -- signup_utm_source holds only
--      the original organic value, and nothing else exists to hold the
--      ad touch.
--   3. checkout_session_attempts (the purchase-touch record) carried
--      utm_* but never referrer/click_ids, so the same gap as #1
--      repeats at the moment of payment specifically.
--   4. There is no reviewable backfill path for the 143 UTM-less
--      profiles -- any fix had to either (a) silently guess and write
--      directly to profiles (rejected -- the task explicitly forbids
--      inventing attribution), or (b) surface evidence-backed proposals
--      for a human to approve. This migration builds (b): a propose-
--      only table, never auto-applied, with a confidence tier per
--      evidence source.
--   5. verified_purchases (v153) unions invoices + ground_registrations
--      correctly (no double-counting), but doesn't expose
--      stripe_session_id, so there was no safe way to join a real paid
--      transaction back to the checkout_session_attempts row that
--      captured its purchase-touch. Fixed by extending the view
--      (additive column; every known consumer selects explicit columns,
--      confirmed by reading supabase-portal-schema-v153*.sql's 5 RPCs).
--
-- Everything below is additive: new nullable columns, a new table, a
-- view extended with one more selected column, and new functions. No
-- existing column is altered, no existing row is updated, and nothing
-- here writes to `profiles` except the proposals table itself (which is
-- never profiles).

-- ============================================================
-- 1. profiles -- new first-touch fields + new signup-touch fields
-- ============================================================
-- first_touch_referrer/first_touch_click_ids/first_touch_anon_id sit
-- alongside the existing first_touch_landing_page/first_touch_at (v?.sql)
-- -- same "write once at signup, never overwritten again" contract.
-- signup_touch_* is the new concept this migration adds: whichever touch
-- (UTM + referrer + click ids + landing page) was active at the EXACT
-- moment of account creation, which may differ from first_touch_* when a
-- visitor converts on a later, differently-tagged session. Never written
-- except at the moment create-free-account/create-checkout-session
-- creates the profile row, so there is no overwrite risk -- these
-- columns are null by construction until that one write.
alter table public.profiles
  add column if not exists first_touch_referrer text,
  add column if not exists first_touch_click_ids jsonb,
  add column if not exists first_touch_anon_id text,
  add column if not exists signup_touch_source text,
  add column if not exists signup_touch_medium text,
  add column if not exists signup_touch_campaign text,
  add column if not exists signup_touch_content text,
  add column if not exists signup_touch_term text,
  add column if not exists signup_touch_referrer text,
  add column if not exists signup_touch_click_ids jsonb,
  add column if not exists signup_touch_landing_page text,
  add column if not exists signup_touch_at timestamptz;

comment on column public.profiles.first_touch_referrer is
  'document.referrer captured on the visitor''s very first ever tagged touch (UTM param or ad click id present in the URL) -- write-once, same contract as first_touch_landing_page/first_touch_at. NULL for every profile created before this column existed, and for any visitor whose browser blocked document.referrer.';
comment on column public.profiles.first_touch_click_ids is
  'jsonb map of ad-platform click ids (fbclid/gclid/msclkid/ttclid/gbraid/wbraid) present on the visitor''s first ever tagged touch. Write-once. A genuine channel signal independent of utm_source -- several ad templates land with a click id and no utm_* at all.';
comment on column public.profiles.first_touch_anon_id is
  'The anon_id (site/analytics-events.js) active at the moment of the visitor''s first ever tagged touch. Lets a later reconciliation join this profile back to every analytics_events row from that original anonymous session, even ones that predate the eventual analytics_identity_map link (which only starts at first authenticated event).';
comment on column public.profiles.signup_touch_source is 'Whichever utm_source was active at the EXACT moment this profile was created -- distinct from signup_utm_source (the visitor''s first-ever touch, which may be an earlier, differently-tagged session). Written once, at account creation, never overwritten after.';
comment on column public.profiles.signup_touch_medium is 'See signup_touch_source.';
comment on column public.profiles.signup_touch_campaign is 'See signup_touch_source.';
comment on column public.profiles.signup_touch_content is 'See signup_touch_source.';
comment on column public.profiles.signup_touch_term is 'See signup_touch_source.';
comment on column public.profiles.signup_touch_referrer is 'document.referrer active at the exact moment of account creation. See signup_touch_source.';
comment on column public.profiles.signup_touch_click_ids is 'Ad-platform click ids active at the exact moment of account creation. See signup_touch_source.';
comment on column public.profiles.signup_touch_landing_page is 'Landing page URL active at the exact moment of account creation. See signup_touch_source.';
comment on column public.profiles.signup_touch_at is 'Timestamp this signup-touch snapshot was captured client-side. See signup_touch_source.';

-- ============================================================
-- 2. checkout_session_attempts -- purchase-touch referrer/click ids
-- ============================================================
-- Mirrors the existing utm_source/utm_medium/.../utm_term columns on
-- this table (whichever touch was active at THIS specific checkout
-- attempt) -- adds the same referrer/click-id signal create-checkout-
-- session/index.ts's logCheckoutAttempt() now captures. Per-attempt, not
-- per-profile, so a later purchase by an email-retargeted return visitor
-- is captured as its own purchase-touch and never conflated with that
-- visitor's first-touch or signup-touch.
alter table public.checkout_session_attempts
  add column if not exists referrer text,
  add column if not exists click_ids jsonb;

comment on column public.checkout_session_attempts.referrer is
  'document.referrer active at the moment this specific checkout attempt was created -- the purchase-touch referrer. Independent of profiles.first_touch_referrer/signup_touch_referrer, which capture different moments in the same visitor''s lifecycle.';
comment on column public.checkout_session_attempts.click_ids is
  'Ad-platform click ids active at the moment this specific checkout attempt was created -- the purchase-touch click ids.';

-- ============================================================
-- 3. verified_purchases -- extend with stripe_session_id (additive)
-- ============================================================
-- Every known consumer of this view (the 5 RPCs in supabase-portal-
-- schema-v153-revenue-reporting-accuracy.sql) selects explicit columns
-- (uid, product, amount_cents, paid_at / vp.uid, vp.amount_cents, ...),
-- never `select *`, so adding a column here is safe and does not change
-- any existing query's result shape. This is required to join a real
-- paid transaction back to the checkout_session_attempts row that
-- captured its purchase-touch (see canonical_paid_transaction_attribution
-- below) -- without stripe_session_id there was no reliable key to do
-- that join on.
create or replace view public.verified_purchases as
  select student_id::text as uid, product, amount_cents, issued_at as paid_at, stripe_session_id
  from public.invoices
  where status = 'paid' and product is not null
  union all
  select profile_id::text as uid, 'ground_school_class' as product, amount_cents, registered_at as paid_at, stripe_session_id
  from public.ground_registrations
  where payment_status = 'paid';

-- view owner's privileges apply (see v153's own comment on this same
-- revoke) -- re-asserted here since `create or replace view` does not
-- reset grants, but this keeps the intent explicit and self-contained in
-- case this view is ever recreated from scratch instead of replaced.
revoke all on public.verified_purchases from public, anon, authenticated;

-- ============================================================
-- 4. canonical_paid_transaction_attribution -- one row per real paid
--    transaction, with first-touch / signup-touch / purchase-touch each
--    in their own clearly-labeled columns. Never sums or duplicates
--    revenue -- it's verified_purchases (already de-duplicated, v153)
--    left-joined outward to attribution context, so its row count and
--    total amount_cents always match verified_purchases exactly.
-- ============================================================
create or replace view public.canonical_paid_transaction_attribution as
  select
    vp.uid as profile_id,
    vp.product,
    vp.amount_cents,
    vp.paid_at,
    vp.stripe_session_id,
    -- First-touch: the visitor's very first ever recorded touch.
    p.first_touch_landing_page,
    p.first_touch_at,
    p.first_touch_referrer,
    p.first_touch_click_ids,
    p.first_touch_anon_id,
    p.signup_utm_source as first_touch_source,
    p.signup_utm_medium as first_touch_medium,
    p.signup_utm_campaign as first_touch_campaign,
    public.normalize_marketing_source(p.signup_utm_source) as first_touch_source_normalized,
    public.classify_marketing_channel(nullif(p.signup_utm_source, ''), nullif(p.signup_utm_medium, '')) as first_touch_channel,
    -- Signup-touch: whichever touch was active at the exact moment this
    -- profile was created (may differ from first-touch -- never labeled
    -- as first-touch even when it happens to match).
    p.signup_touch_source,
    p.signup_touch_medium,
    p.signup_touch_campaign,
    p.signup_touch_referrer,
    p.signup_touch_click_ids,
    p.signup_touch_landing_page,
    p.signup_touch_at,
    public.normalize_marketing_source(p.signup_touch_source) as signup_touch_source_normalized,
    public.classify_marketing_channel(nullif(p.signup_touch_source, ''), nullif(p.signup_touch_medium, '')) as signup_touch_channel,
    -- Purchase-touch: whichever touch was active at the moment of THIS
    -- specific checkout attempt -- joined via stripe_session_id, the
    -- same key stripe-webhook uses to mark a checkout_session_attempts
    -- row completed. A transaction with no matching attempt row (e.g.
    -- pre-dates checkout_session_attempts existing) simply has null
    -- purchase-touch columns rather than falling back to another touch
    -- type and silently mislabeling it.
    csa.utm_source as purchase_touch_source,
    csa.utm_medium as purchase_touch_medium,
    csa.utm_campaign as purchase_touch_campaign,
    csa.referrer as purchase_touch_referrer,
    csa.click_ids as purchase_touch_click_ids,
    public.normalize_marketing_source(csa.utm_source) as purchase_touch_source_normalized,
    public.classify_marketing_channel(nullif(csa.utm_source, ''), nullif(csa.utm_medium, '')) as purchase_touch_channel
  from public.verified_purchases vp
  left join public.profiles p on p.id::text = vp.uid
  left join public.checkout_session_attempts csa on csa.stripe_session_id = vp.stripe_session_id;

comment on view public.canonical_paid_transaction_attribution is
  'Acquisition Attribution Repair (v156) -- one row per real, de-duplicated paid transaction (from verified_purchases, v153), with first-touch, signup-touch, and purchase-touch each in their own distinctly-named columns plus a normalized source/channel alongside every raw value. Never aggregates or re-sums revenue -- row count and total amount_cents always match verified_purchases exactly. A later touch recovered via attribution_backfill_proposals is NEVER written into this view''s first_touch_* columns unless a human has approved and applied that specific proposal to profiles.signup_utm_source itself -- this view only ever reflects what profiles/checkout_session_attempts actually hold.';

revoke all on public.canonical_paid_transaction_attribution from public, anon, authenticated;

-- ============================================================
-- 5. attribution_backfill_proposals -- evidence-backed, PROPOSE-ONLY.
--    Never written to by anything except generate_attribution_backfill_
--    proposals() below (INSERT only) and an admin's own explicit review
--    (UPDATE applied/applied_at/applied_by once they've manually decided
--    to act on a proposal, e.g. by then separately updating profiles
--    themselves). This table never writes to profiles -- it exists so a
--    human can see the evidence and decide, never to auto-backfill.
-- ============================================================
create table if not exists public.attribution_backfill_proposals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  field_name text not null,
  current_value text,
  proposed_value text not null,
  evidence_source text not null check (evidence_source in (
    'analytics_identity_map', 'readiness_assessment_leads', 'checkout_session_attempts', 'email_click_through'
  )),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  reasoning text not null,
  evidence_at timestamptz,
  detected_at timestamptz not null default now(),
  applied boolean not null default false,
  applied_at timestamptz,
  applied_by uuid references public.profiles(id),
  unique (profile_id, field_name, evidence_source)
);

comment on table public.attribution_backfill_proposals is
  'Acquisition Attribution Repair (v156) -- evidence-backed proposals for filling in missing profiles.signup_utm_* (or related) fields, generated by generate_attribution_backfill_proposals() below. PROPOSE-ONLY: nothing in this migration or its function ever writes to profiles directly. An admin reviews a proposal''s reasoning/confidence/evidence_source, decides whether to act on it, and if so updates profiles themselves -- then (ideally) marks this row applied=true/applied_at/applied_by for an audit trail. confidence reflects how directly the evidence source implies a genuine first-touch: analytics_identity_map and readiness_assessment_leads are both high (closest available signal to an actual pre-signup touch); checkout_session_attempts is medium (it''s a PURCHASE-touch proxy -- the visitor''s channel at time of payment, which may postdate their real first-touch, so it is never proposed as a high-confidence first-touch claim, and only proposed at all when no higher-confidence evidence source already covers the same profile/field).';

alter table public.attribution_backfill_proposals enable row level security;

create policy "Admins can view attribution backfill proposals"
  on public.attribution_backfill_proposals for select
  using (public.is_admin(auth.uid()));

create policy "Admins can update attribution backfill proposals"
  on public.attribution_backfill_proposals for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

revoke all on public.attribution_backfill_proposals from public, anon;
grant select, update on public.attribution_backfill_proposals to authenticated;

create index if not exists idx_attribution_backfill_proposals_profile on public.attribution_backfill_proposals (profile_id);

-- ============================================================
-- 6. generate_attribution_backfill_proposals() -- read-mostly, admin-
--    gated. INSERTs proposal rows only; never touches profiles.
-- ============================================================
create or replace function public.generate_attribution_backfill_proposals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_count integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  -- Tier 1 (high confidence): the earliest analytics_events row linked
  -- to this profile via analytics_identity_map (first-link-wins anon_id
  -- -> profile_id map) that carried a utm_source. Two historical
  -- property-key spellings exist in real event data (traffic_source,
  -- the current analytics-events.js convention, and utm_source, an
  -- older one) -- coalesced so neither is silently missed.
  insert into public.attribution_backfill_proposals
    (profile_id, field_name, current_value, proposed_value, evidence_source, confidence, reasoning, evidence_at)
  select
    p.id, 'signup_utm_source', p.signup_utm_source, ev.src, 'analytics_identity_map', 'high',
    'Earliest analytics_events row linked to this profile via analytics_identity_map (anon_id ' || aim.anon_id || ') carried a utm/traffic source of "' || ev.src || '" at ' || ev.at::text || '.',
    ev.at
  from public.profiles p
  join public.analytics_identity_map aim on aim.profile_id = p.id
  join lateral (
    select coalesce(ae.properties->>'traffic_source', ae.properties->>'utm_source') as src, ae.created_at as at
    from public.analytics_events ae
    where ae.anon_id = aim.anon_id
      and coalesce(ae.properties->>'traffic_source', ae.properties->>'utm_source') is not null
    order by ae.created_at asc
    limit 1
  ) ev on true
  where p.signup_utm_source is null
  on conflict (profile_id, field_name, evidence_source) do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted + v_count;

  -- Tier 2 (high confidence): a readiness_assessment_leads row already
  -- tied to this profile (claim_readiness_assessment_by_email links by
  -- email at signup time -- see create-free-account/index.ts) that
  -- carried a utm_source. Equally direct a signal as tier 1 -- the
  -- assessment is itself a pre-signup touch, not a proxy for one.
  insert into public.attribution_backfill_proposals
    (profile_id, field_name, current_value, proposed_value, evidence_source, confidence, reasoning, evidence_at)
  select distinct on (p.id)
    p.id, 'signup_utm_source', p.signup_utm_source, ral.utm_source, 'readiness_assessment_leads', 'high',
    'Readiness assessment lead tied to this profile (claimed by email at signup) carried utm_source="' || ral.utm_source || '" at ' || ral.created_at::text || '.',
    ral.created_at
  from public.profiles p
  join public.readiness_assessment_leads ral on ral.profile_id = p.id
  where p.signup_utm_source is null and ral.utm_source is not null
  order by p.id, ral.created_at asc
  on conflict (profile_id, field_name, evidence_source) do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted + v_count;

  -- Tier 3 (medium confidence): checkout_session_attempts.utm_source is
  -- a PURCHASE-touch, not a first-touch -- it reflects whichever channel
  -- was active at the moment of payment, which can postdate the
  -- visitor's real first-ever touch (the explicit email-retargeting
  -- scenario this task calls out). Only proposed when no higher-
  -- confidence tier already covers this profile/field, and always
  -- labeled medium so an admin reviewing it understands the caveat
  -- before ever promoting it to signup_utm_source.
  insert into public.attribution_backfill_proposals
    (profile_id, field_name, current_value, proposed_value, evidence_source, confidence, reasoning, evidence_at)
  select distinct on (p.id)
    p.id, 'signup_utm_source', p.signup_utm_source, csa.utm_source, 'checkout_session_attempts', 'medium',
    'No analytics-identity or readiness-assessment evidence found. A checkout_session_attempts row tied to this profile carried utm_source="' || csa.utm_source || '" -- this is the channel active AT THE MOMENT OF PURCHASE, not necessarily this visitor''s original first-touch (e.g. an email-retargeting return visit after an earlier, differently-tagged or untagged first touch). Review before treating as first-touch.',
    csa.created_at
  from public.profiles p
  join public.checkout_session_attempts csa on csa.profile_id = p.id
  where p.signup_utm_source is null
    and csa.utm_source is not null
    and not exists (
      select 1 from public.attribution_backfill_proposals existing
      where existing.profile_id = p.id and existing.field_name = 'signup_utm_source'
        and existing.evidence_source in ('analytics_identity_map', 'readiness_assessment_leads')
    )
  order by p.id, csa.created_at asc
  on conflict (profile_id, field_name, evidence_source) do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted + v_count;

  return v_inserted;
end;
$$;

comment on function public.generate_attribution_backfill_proposals() is
  'Acquisition Attribution Repair (v156) -- admin-only. Scans profiles with signup_utm_source still null and INSERTs evidence-backed rows into attribution_backfill_proposals across 3 confidence tiers (see that table''s comment). Never writes to profiles. Safe to re-run -- unique(profile_id, field_name, evidence_source) plus ON CONFLICT DO NOTHING means re-running after new analytics/leads/checkout data arrives only adds genuinely new evidence, never duplicates or overwrites an existing proposal (including one an admin already reviewed and marked applied).';

revoke all on function public.generate_attribution_backfill_proposals() from public, anon;
grant execute on function public.generate_attribution_backfill_proposals() to authenticated;
