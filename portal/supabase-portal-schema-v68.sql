-- Apex Advantage — Retention Sprint Tier 1: free daily question (v68)
--
-- Question of the Day was wrapped in [data-locked-widget] (site/portal.html),
-- which applyUnlockState() (site/portal-stable.js) blurs/disables for any
-- member without checkride_prep_unlocked -- contradicting the retention
-- sprint's central principle that a locked member should always have one
-- real, free, meaningful thing to do today. Removing the CSS lock alone
-- isn't enough: the question data itself (DPE_DATA) only ever gets loaded
-- client-side for unlocked members, via get-premium-content, which
-- requires requirePremiumAccess() and returns the *entire* gated question
-- bank -- not something a free member should receive.
--
-- This RPC serves just today's single question -- the same one every
-- member sees that day, deterministic by day-of-year modulo count,
-- matching computeQotdQuestion()'s existing client-side selection exactly
-- (dayOfYear() % DPE_DATA.length there; extract(doy)::int % count here) --
-- to ANY authenticated member regardless of unlock status, without ever
-- exposing the rest of the bank. security definer is required since
-- dpe_questions/dpe_categories' only existing RLS policies are admin-only
-- (supabase-portal-schema-v5.sql) -- this function runs as its owner,
-- bypassing that, and is the sole thing granted execute to `authenticated`.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v67.

create or replace function public.get_daily_question(p_exam_type text default 'private_pilot')
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
  where q.exam_type = p_exam_type
  order by q.sort_order
  offset (
    extract(doy from now())::int
    % greatest((select count(*) from public.dpe_questions where exam_type = p_exam_type), 1)
  )
  limit 1;
$$;

grant execute on function public.get_daily_question(text) to authenticated;
