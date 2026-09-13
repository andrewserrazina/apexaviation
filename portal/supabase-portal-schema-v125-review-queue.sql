-- Apex Advantage — My Review Queue (v125)
--
-- Architecture: source data stays authoritative (portal_practice_attempt_
-- responses, module_quiz_attempts.results, guided_notes ratings) --
-- this table holds ONLY spaced-repetition scheduling state that cannot be
-- derived: next-due, review-count, priority, dismissal. sync_review_queue()
-- re-derives weakness from the real signal tables every call (idempotent,
-- safe on every dashboard load) rather than the client stitching together
-- 3-4 separate queries. Same claim_daily_view-style SECURITY DEFINER
-- template: auth.uid() ownership check, set search_path, explicit
-- revoke from public/anon, grant to authenticated only.
--
-- One row per (profile_id, source_type, source_id) -- never duplicated;
-- when a source accumulates more than one applicable signal, reason is
-- resolved by fixed precedence (not_yet > repeated_incorrect > incorrect >
-- needs_review) and only ever moves up, never down, on a single sync call.
-- Entitlement is per-source_type (dpe_question -> checkridePrepUnlocked,
-- everything else -> hasModuleAccess(module_id)) and is enforced entirely
-- client-side at render/session-launch time -- see Sprint 2 report's
-- Entitlement Matrix section. sync_review_queue() itself can only ever
-- read rows the member could only have written by already being entitled
-- (Practice is gated, module content requires module access), so it can't
-- manufacture ineligible rows; it does not need to re-check entitlement
-- itself.

create table if not exists public.portal_review_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('dpe_question','module_quiz_question','scenario','checkride_corner')),
  source_id text not null,
  module_id text,
  acs_category text,
  reason text not null check (reason in ('incorrect','repeated_incorrect','needs_review','not_yet')),
  priority integer not null default 0,
  first_flagged_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  next_review_at timestamptz not null default now(),
  review_count integer not null default 0,
  successful_review_count integer not null default 0,
  status text not null default 'active' check (status in ('active','resolved','dismissed')),
  updated_at timestamptz not null default now(),
  unique (profile_id, source_type, source_id)
);

alter table public.portal_review_items enable row level security;

drop policy if exists "Users can view their own review items" on public.portal_review_items;
create policy "Users can view their own review items"
  on public.portal_review_items for select
  using (auth.uid() = profile_id);

-- Select-only for clients -- all writes (create/reprioritize/reschedule/
-- resolve) funnel through sync_review_queue()/record_review_outcome()
-- below, matching the stronger pattern already used for
-- portal_practice_attempt_responses/task_evidence.

create index if not exists portal_review_items_due_idx
  on public.portal_review_items (profile_id, status, next_review_at);
create index if not exists portal_review_items_category_idx
  on public.portal_review_items (profile_id, acs_category) where status = 'active';
create index if not exists portal_review_items_module_idx
  on public.portal_review_items (profile_id, module_id) where status = 'active';

-- Fixed reason precedence -- not_yet > repeated_incorrect > incorrect >
-- needs_review. Used both to decide which reason wins when a sync call
-- finds a stronger signal for an item that already exists, and as that
-- reason's base priority contribution.
create or replace function public.review_reason_rank(p_reason text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_reason
    when 'not_yet' then 4
    when 'repeated_incorrect' then 3
    when 'incorrect' then 2
    when 'needs_review' then 1
    else 0
  end;
$$;

-- ---------------------------------------------------------------------
-- sync_review_queue(): re-derives weak items from the real signal tables.
-- Safe to call on every dashboard load -- idempotent upserts, cheap given
-- the sources' own existing indexes. Never inserts a second row for the
-- same (profile_id, source_type, source_id); never lowers priority/reason
-- below what a still-applicable stronger signal justifies. Resolves items
-- whose latest signal now says "fine" (source data stays authoritative --
-- a corrected practice question or a re-rated Confident retires the item
-- without a separate event-history subsystem).
-- ---------------------------------------------------------------------
create or replace function public.sync_review_queue(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to sync the review queue for this profile';
  end if;

  -- 1. dpe_question -- latest self_rating per question_id decides current
  -- weakness (source data stays authoritative); 2+ non-correct responses
  -- for the same question upgrades the reason to repeated_incorrect.
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

  -- 2. module_quiz_question -- only the member's most recent attempt per
  -- module decides current weakness (a module's quiz questions don't
  -- change across attempts, so the newest attempt's results supersede
  -- older ones for the same question ids). 2nd-most-recent attempt having
  -- the same question wrong too upgrades the reason.
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
  select p_profile_id, 'module_quiz_question', lw.question_id, lw.module_id, null,
    case when exists (select 1 from prior_wrong pw where pw.module_id = lw.module_id and pw.question_id = lw.question_id)
         then 'repeated_incorrect' else 'incorrect' end,
    2, now()
  from latest_wrong lw
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
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

  -- 3. checkride_corner -- guided_notes rating rows, needs_review/not_yet.
  with rated as (
    select module_id, regexp_replace(prompt_id, '-rating$', '') as source_id, response_text
    from public.guided_notes
    where profile_id = p_profile_id and section_id = 'checkride-corner' and prompt_id like '%-rating'
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'checkride_corner', r.source_id, r.module_id, null,
    case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end,
    public.review_reason_rank(case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end), now()
  from rated r
  where r.response_text in ('needs_review', 'not_yet')
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
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

  -- 4. scenario (Ground School Scenario Workshop) -- one rating per
  -- module, source_id is the module_id itself (one scenario per module).
  with rated as (
    select module_id, response_text
    from public.guided_notes
    where profile_id = p_profile_id and section_id = 'scenario-workshop' and prompt_id = 'scenario-workshop-rating'
  )
  insert into public.portal_review_items (profile_id, source_type, source_id, module_id, acs_category, reason, priority, next_review_at)
  select p_profile_id, 'scenario', r.module_id, r.module_id, null,
    case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end,
    public.review_reason_rank(case when r.response_text = 'not_yet' then 'not_yet' else 'needs_review' end), now()
  from rated r
  where r.response_text in ('needs_review', 'not_yet')
  on conflict (profile_id, source_type, source_id) do update set
    reason = case when public.review_reason_rank(excluded.reason) > public.review_reason_rank(public.portal_review_items.reason)
                  then excluded.reason else public.portal_review_items.reason end,
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

  -- 5. AI DPE weak-domain priority boost -- pure priority bump on already-
  -- existing dpe_question items in a mapped, exact-match category; never
  -- creates a review item by itself, never changes reason. Deterministic
  -- exact-match table (see Sprint 2 report's AI DPE Mapping section) --
  -- no substring/fuzzy matching; an unmapped domain is silently ignored.
  with latest_session as (
    select debrief from public.ai_dpe_sessions
    where profile_id = p_profile_id and status = 'completed' and debrief is not null
    order by ended_at desc limit 1
  ),
  weak_categories as (
    select distinct
      case trim(lower(d ->> 'domain'))
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
      end as category
    from latest_session, jsonb_array_elements(debrief -> 'perDomain') d
    where d ->> 'verdict' = 'weak'
  )
  update public.portal_review_items
  set priority = priority + 2, updated_at = now()
  where profile_id = p_profile_id and source_type = 'dpe_question' and status = 'active'
    and acs_category in (select category from weak_categories where category is not null);
end;
$$;

revoke execute on function public.sync_review_queue(uuid) from public, anon;
grant execute on function public.sync_review_queue(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- record_review_outcome(): the only write path for the deterministic
-- spaced-review schedule. 'reinforced' advances the schedule (+1d / +3d /
-- +7d / previous-interval*2 capped 30d); 'needs_another_pass' bumps
-- priority and resets next_review_at to now (stays due). Ownership
-- checked via the row's own profile_id, not a caller-supplied one.
-- ---------------------------------------------------------------------
create or replace function public.record_review_outcome(p_review_item_id uuid, p_outcome text)
returns public.portal_review_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.portal_review_items%rowtype;
  v_prev_interval interval;
  v_next_interval interval;
begin
  if p_outcome not in ('reinforced', 'needs_another_pass') then
    raise exception 'invalid_outcome: % is not reinforced or needs_another_pass', p_outcome;
  end if;

  select * into v_row from public.portal_review_items where id = p_review_item_id for update;
  if not found then
    raise exception 'review_item_not_found';
  end if;
  if v_row.profile_id <> auth.uid() then
    raise exception 'Not authorized to update this review item';
  end if;

  if p_outcome = 'needs_another_pass' then
    update public.portal_review_items
    set review_count = review_count + 1,
        priority = priority + 1,
        last_reviewed_at = now(),
        next_review_at = now(),
        updated_at = now()
    where id = p_review_item_id
    returning * into v_row;
    return v_row;
  end if;

  v_prev_interval := coalesce(v_row.next_review_at - v_row.last_reviewed_at, interval '1 day');
  v_next_interval := case v_row.successful_review_count + 1
    when 1 then interval '1 day'
    when 2 then interval '3 days'
    when 3 then interval '7 days'
    else least(v_prev_interval * 2, interval '30 days')
  end;

  update public.portal_review_items
  set review_count = review_count + 1,
      successful_review_count = successful_review_count + 1,
      last_reviewed_at = now(),
      next_review_at = now() + v_next_interval,
      updated_at = now()
  where id = p_review_item_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.record_review_outcome(uuid, text) from public, anon;
grant execute on function public.record_review_outcome(uuid, text) to authenticated;
