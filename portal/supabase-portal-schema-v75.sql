-- Growth + Habit Loop Sprint, section 16 -- multi-rating architecture prep
-- (Private -> Instrument -> Commercial). This sprint does NOT build new
-- rating content or change entitlement/gating behavior -- get-premium-
-- content's exam_type filter stays hard-coded to 'private_pilot' on
-- purpose (see that function's own comment). This just adds the one
-- missing signal: which rating a member is CURRENTLY training toward,
-- so a future rating-specific prep pack has something real to key off
-- of instead of assuming every member means "Private."
--
-- profiles.next_rating_interest already exists (v52.sql) and captures
-- the complementary "what's next after this" signal post-checkride --
-- current_rating is deliberately a separate field, not a replacement.
alter table public.profiles
  add column if not exists current_rating text not null default 'private'
    check (current_rating in ('private', 'instrument', 'commercial'));
