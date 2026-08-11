-- Apex Advantage — Training OS Phase 1: surface AI DPE session history (v64)
--
-- ai_dpe_sessions (supabase-portal-schema-v32.sql) has stored every AI DPE
-- Practice session's transcript, question count, status, and qualitative
-- debrief since it shipped -- but nothing in the client has ever read it
-- back. Every session's outcome has been captured and then never shown to
-- the member again. This adds a single read-only RPC so the portal can
-- list a member's own past sessions and their debriefs, which is what
-- both the AI DPE History view and the Training Plan's "AI DPE not done
-- recently" / "last debrief flagged X as weak" signals need.
--
-- No new table, no write path -- ai_dpe_sessions already has a
-- select-your-own-rows RLS policy (v32.sql); this RPC exists only so the
-- client can call one function instead of hand-rolling the same
-- `.from('ai_dpe_sessions').select(...).eq('profile_id', ...)` query
-- inline, and so a limit/ordering convention is defined in one place.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v63.

create or replace function public.get_my_recent_ai_dpe_sessions(p_limit integer default 10)
returns table (
  id uuid,
  status text,
  questions_asked integer,
  debrief jsonb,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, status, questions_asked, debrief, started_at, ended_at
  from public.ai_dpe_sessions
  where profile_id = auth.uid()
  order by started_at desc
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.get_my_recent_ai_dpe_sessions(integer) to authenticated;
