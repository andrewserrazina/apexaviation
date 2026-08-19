-- Growth + Habit Loop Sprint, Tier 2 -- 7-Day Checkride Challenge.
--
-- The full DPE question bank (DPE_DATA/CATEGORY_META in
-- site/portal-stable.js) is fetched by get-premium-content and is only
-- ever returned to accounts with checkride_prep_unlocked = true. The
-- 7-Day Challenge is a free-tier feature, so it can't read from that
-- client-side array (it's empty for locked members) -- it needs its own
-- narrow, server-side read path.
--
-- get_daily_question() (v68.sql) already establishes the precedent this
-- follows: a SECURITY DEFINER function granted to `authenticated` with no
-- checkride_prep_unlocked check, deliberately exposing a small, bounded
-- slice of the paid bank to every member as a free preview/habit hook.
-- This is the same pattern, scoped to a specific category instead of a
-- day-of-year rotation across the whole bank.
create or replace function public.get_challenge_day_questions(p_category text, p_limit int default 5)
returns table (
  id text,
  question text,
  model_answer text,
  dpe_evaluating text,
  real_world_application text,
  category text,
  category_label text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id, q.question, q.model_answer, q.dpe_evaluating, q.real_world_application,
    q.category, c.label as category_label
  from public.dpe_questions q
  join public.dpe_categories c on c.id = q.category
  where q.exam_type = 'private_pilot' and q.category = p_category
  order by q.sort_order
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_challenge_day_questions(text, int) to authenticated;
