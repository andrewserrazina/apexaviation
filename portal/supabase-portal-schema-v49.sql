-- Apex Advantage — Achievement rarity (v49)
--
-- Phase 2 of the habit-layer expansion. The existing achievement system
-- (portal_achievements, ACHIEVEMENT_DEFS in site/portal-stable.js) has
-- no server-side way to compute "X% of pilots have earned this" without
-- exposing other members' individual rows -- portal_achievements' RLS
-- only lets a member read their own. A security-definer function
-- (same pattern as get_member_streak/award_xp in v47, not a view --
-- Postgres view RLS semantics vary by version and this needs to be
-- unambiguously correct) returns only the aggregate.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v48.

create or replace function public.get_achievement_rarity()
returns table (achievement_key text, pct_earned numeric)
language sql
security definer
stable
set search_path = public
as $$
  select
    achievement_key,
    round(
      count(*)::numeric / greatest((select count(*) from public.profiles where checkride_prep_unlocked = true), 1),
      4
    ) as pct_earned
  from public.portal_achievements
  group by achievement_key
$$;

grant execute on function public.get_achievement_rarity() to authenticated;
