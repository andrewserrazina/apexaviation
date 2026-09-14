-- Apex Advantage — Sprint 4.1 Part 6+7: Ground School Review Queue ACS
-- categorization + idempotent AI DPE priority boost
--
-- ISSUE 5 (remaining half): sync_review_queue() populates acs_category
-- for dpe_question review items (joined straight off dpe_questions.
-- category), but INSERTS module_quiz_question/checkride_corner/scenario
-- items with acs_category always null -- these three source types were
-- never wired to content_acs_mappings at all. Since every category-
-- specific consumer (Training Report's dueReviewCountForCategory(),
-- Readiness Detail's readinessCategoryActionLabel(),
-- computeTrainingPlan()'s weakest-category matching) filters on
-- source_type = 'dpe_question' && acs_category = X, this silently made
-- every Ground-School-derived review item invisible to all
-- category-aware UI even after Sprint 4 mapped 449 pieces of content --
-- the item would still show up in the flat Review Queue list, just
-- never counted against its actual category anywhere else. This
-- migration resolves acs_category for all three source types from
-- content_acs_mappings, using the same content_type/content_id
-- translation record_review_outcome() (v136) now uses. A content item
-- mapped to more than one task/category (rare, and only when Issue 9's
-- targeted QA genuinely justifies a dual mapping) resolves to one
-- category deterministically (lowest category id) -- acs_category
-- remains a single supporting-signal field here, matching the existing
-- dpe_question convention of one category per item.
--
-- ISSUE 7: the AI-DPE weak-domain priority boost was a bare
-- `priority = priority + 2` applied to every matching active item on
-- EVERY sync_review_queue() call, with no memory of whether that boost
-- was already applied -- repeated syncs against the same AI DPE
-- session compounded the boost indefinitely (5 -> 7 -> 9 -> 11 ...)
-- with no new evidence. Adds ai_dpe_boosted (a plain marker of whether
-- THIS item currently carries the +2), and makes the boost fully
-- derived each sync: remove it from items that no longer match a
-- current weak category, apply it (once) to items that do and don't
-- have it yet. Same source state (same weak categories, same active
-- items) now always produces the same priority after any number of
-- repeated syncs.
alter table public.portal_review_items
  add column if not exists ai_dpe_boosted boolean not null default false;

create or replace function public.sync_review_queue(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ai_weak_categories text[];
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to sync the review queue for this profile';
  end if;

  with latest as (
    select distinct on (question_id)
      question_id, self_rating, answered_at
    from public.portal_practice_attempt_responses
    where profile_id = p_profile_id
    order by question_id, answered_at desc
  ),
  miss_counts as (
    select question_id, count(*) as miss_count
    from public.portal_practice_attempt_responses
    where profile_id = p_profile_id and self_rating <> 'correct'
    group by question_id
  ),
  weak as (
    select
      l.question_id,
      case
        when l.self_rating = 'partial' then 'needs_review'
        when coalesce(m.miss_count, 0) >= 2 then 'repeated_incorrect'
        else 'incorrect'
      end as reason,
      dq.category as acs_category
    from latest l
    left join miss_counts m on m.question_id = l.question_id
    left join public.dpe_questions dq on dq.id = l.question_id
    where l.self_rating <> 'correct'
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'dpe_question', w.question_id, null, w.acs_category, w.reason, public.review_reason_rank(w.reason), now()
  from weak w
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
    acs_category = coalesce(excluded.acs_category, public.portal_review_items.acs_category),
    priority = greatest(public.portal_review_items.priority, public.review_reason_rank(excluded.reason)),
    next_review_at = least(public.portal_review_items.next_review_at, now()),
    status = 'active',
    updated_at = now();

  update public.portal_review_items
  set status = 'resolved', updated_at = now()
  where profile_id = p_profile_id and source_type = 'dpe_question' and status = 'active'
    and source_id not in (select question_id from (
      select distinct on (question_id) question_id, self_rating from public.portal_practice_attempt_responses
      where profile_id = p_profile_id order by question_id, answered_at desc
    ) latest2 where latest2.self_rating <> 'correct');

  with ranked as (
    select id, course_id, module_id, results,
      row_number() over (partition by profile_id, course_id, module_id order by completed_at desc) as rn
    from public.module_quiz_attempts
    where profile_id = p_profile_id and results is not null
  ),
  latest_wrong as (
    select course_id, module_id, kv.key as question_id
    from ranked, jsonb_each(results) kv
    where rn = 1 and kv.value = 'false'::jsonb
  ),
  prior_wrong as (
    select course_id, module_id, kv.key as question_id
    from ranked, jsonb_each(results) kv
    where rn = 2 and kv.value = 'false'::jsonb
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'module_quiz_question', lw.question_id, lw.module_id,
    (select t.dpe_category from public.content_acs_mappings m
       join public.acs_tasks t on t.id = m.acs_task_id
       where m.content_type = 'module_quiz_question' and m.content_id = lw.question_id
       order by t.dpe_category limit 1),
    case when exists (select 1 from prior_wrong pw where pw.module_id = lw.module_id and pw.question_id = lw.question_id)
         then 'repeated_incorrect' else 'incorrect' end,
    2, now()
  from latest_wrong lw
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
    acs_category = coalesce(excluded.acs_category, public.portal_review_items.acs_category),
    priority = greatest(public.portal_review_items.priority, public.review_reason_rank(excluded.reason)),
    next_review_at = least(public.portal_review_items.next_review_at, now()),
    status = 'active',
    updated_at = now();

  with ranked as (
    select id, course_id, module_id, results,
      row_number() over (partition by profile_id, course_id, module_id order by completed_at desc) as rn
    from public.module_quiz_attempts
    where profile_id = p_profile_id and results is not null
  ),
  latest_right as (
    select module_id, kv.key as question_id
    from ranked, jsonb_each(results) kv
    where rn = 1 and kv.value = 'true'::jsonb
  )
  update public.portal_review_items ri
  set status = 'resolved', updated_at = now()
  from latest_right lr
  where ri.profile_id = p_profile_id and ri.source_type = 'module_quiz_question' and ri.status = 'active'
    and ri.module_id = lr.module_id and ri.source_id = lr.question_id;

  with rated as (
    select module_id, regexp_replace(prompt_id, '-rating$', '') as source_id, response_text
    from public.guided_notes
    where profile_id = p_profile_id and section_id = 'checkride-corner' and prompt_id like '%-rating'
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'checkride_corner', r.source_id, r.module_id,
    (select t.dpe_category from public.content_acs_mappings m
       join public.acs_tasks t on t.id = m.acs_task_id
       where m.content_type = 'checkride_corner' and m.content_id = r.module_id || ':' || r.source_id
       order by t.dpe_category limit 1),
    case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end,
    public.review_reason_rank(case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end), now()
  from rated r
  where r.response_text in ('needs_review', 'not_yet')
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
    acs_category = coalesce(excluded.acs_category, public.portal_review_items.acs_category),
    priority = greatest(public.portal_review_items.priority, public.review_reason_rank(excluded.reason)),
    next_review_at = least(public.portal_review_items.next_review_at, now()),
    status = 'active',
    updated_at = now();

  update public.portal_review_items ri
  set status = 'resolved', updated_at = now()
  where ri.profile_id = p_profile_id and ri.source_type = 'checkride_corner' and ri.status = 'active'
    and exists (
      select 1 from public.guided_notes gn
      where gn.profile_id = p_profile_id and gn.section_id = 'checkride-corner'
        and gn.prompt_id = ri.source_id || '-rating' and gn.response_text = 'confident'
    );

  with rated as (
    select module_id, response_text
    from public.guided_notes
    where profile_id = p_profile_id and section_id = 'scenario-workshop' and prompt_id = 'scenario-workshop-rating'
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'scenario', r.module_id, r.module_id,
    (select t.dpe_category from public.content_acs_mappings m
       join public.acs_tasks t on t.id = m.acs_task_id
       where m.content_type = 'scenario_workshop' and m.content_id = r.module_id
       order by t.dpe_category limit 1),
    case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end,
    public.review_reason_rank(case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end), now()
  from rated r
  where r.response_text in ('needs_review', 'not_yet')
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
    acs_category = coalesce(excluded.acs_category, public.portal_review_items.acs_category),
    priority = greatest(public.portal_review_items.priority, public.review_reason_rank(excluded.reason)),
    next_review_at = least(public.portal_review_items.next_review_at, now()),
    status = 'active',
    updated_at = now();

  update public.portal_review_items ri
  set status = 'resolved', updated_at = now()
  where ri.profile_id = p_profile_id and ri.source_type = 'scenario' and ri.status = 'active'
    and exists (
      select 1 from public.guided_notes gn
      where gn.profile_id = p_profile_id and gn.section_id = 'scenario-workshop'
        and gn.prompt_id = 'scenario-workshop-rating' and gn.module_id = ri.module_id and gn.response_text = 'confident'
    );

  -- AI DPE weak-domain priority boost (Issue 7): derived, not
  -- incremented. v_ai_weak_categories is computed once per call from
  -- the current latest completed AI DPE session; the boost is then
  -- applied/removed to match that state exactly, regardless of how
  -- many times sync_review_queue() has already run against it.
  with latest_session as (
    select debrief from public.ai_dpe_sessions
    where profile_id = p_profile_id and status = 'completed' and debrief is not null
    order by ended_at desc limit 1
  )
  select coalesce(array_agg(distinct cat), array[]::text[]) into v_ai_weak_categories
  from (
    select case trim(lower(d ->> 'domain'))
      when 'eligibility & documents' then 'eligibility'
      when 'airworthiness' then 'airworthiness'
      when 'privileges & limitations' then 'privileges'
      when 'airspace' then 'airspace'
      when 'weather' then 'weather'
      when 'performance & w&b' then 'performance'
      when 'aeromedical factors' then 'aeromedical'
      when 'cross-country planning' then 'crosscountry'
      when 'emergency operations' then 'emergency'
      when 'aircraft systems' then 'aircraft-systems'
      when 'aeronautical decision-making & risk management' then 'adm'
      else null
    end as cat
    from latest_session, jsonb_array_elements(debrief -> 'perDomain') d
    where d ->> 'verdict' = 'weak'
  ) x
  where cat is not null;

  update public.portal_review_items
  set priority = priority - 2, ai_dpe_boosted = false, updated_at = now()
  where profile_id = p_profile_id and source_type = 'dpe_question' and status = 'active'
    and ai_dpe_boosted = true
    and coalesce(acs_category = any(v_ai_weak_categories), false) = false;

  update public.portal_review_items
  set priority = priority + 2, ai_dpe_boosted = true, updated_at = now()
  where profile_id = p_profile_id and source_type = 'dpe_question' and status = 'active'
    and ai_dpe_boosted = false
    and acs_category = any(v_ai_weak_categories);
end;
$function$;

revoke execute on function public.sync_review_queue(uuid) from public, anon;
grant execute on function public.sync_review_queue(uuid) to authenticated;
