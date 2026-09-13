-- Apex Advantage — Sprint 3: unified ACS evidence, Part B (v127)
--
-- Verified live against production before writing this migration (per
-- the Sprint 3 review's explicit requirement): record_task_evidence's
-- exact current signature is (uuid, uuid, boolean, boolean), SECURITY
-- DEFINER, granted only to service_role/postgres, with exactly one
-- caller anywhere in the schema -- complete_mobile_practice_session
-- (uuid, jsonb). That signature is preserved verbatim below as a thin
-- compatibility wrapper; complete_mobile_practice_session() needs zero
-- changes and keeps resolving to the exact same behavior it always has.

alter table public.task_evidence
  add column if not exists review_attempt_count integer not null default 0,
  add column if not exists review_correct_count integer not null default 0,
  add column if not exists self_confidence numeric,
  add column if not exists confidence_updated_at timestamptz;

-- ---------------------------------------------------------------------
-- Idempotency ledger -- task_evidence is a pure aggregate with no memory
-- of which source events already contributed to it. Same proven shape
-- as xp_ledger's own guarantee (award_xp(), v52.sql): a unique key per
-- real-world evidence event, checked before any counter is touched.
-- Only enforced when a source is supplied -- every NEW call site always
-- supplies one; the legacy 4-arg wrapper never does, relying on
-- complete_mobile_practice_session()'s own pre-existing
-- already_completed early-return for its idempotency, unchanged.
-- ---------------------------------------------------------------------
create table if not exists public.task_evidence_sources (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  acs_task_id uuid not null references public.acs_tasks(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (profile_id, acs_task_id, source_type, source_id)
);

alter table public.task_evidence_sources enable row level security;

drop policy if exists "Users can view their own evidence sources" on public.task_evidence_sources;
create policy "Users can view their own evidence sources"
  on public.task_evidence_sources for select
  using (auth.uid() = profile_id);

-- ---------------------------------------------------------------------
-- record_task_evidence_internal(): the expanded implementation. p_correct
-- is NULLABLE -- confidence-only evidence (Checkride Corner/Scenario
-- Workshop ratings, and Review outcomes, which Sprint 2's own Review
-- Session UX always treats as self-assessed retrieval, never a re-graded
-- objective answer -- verified directly against openReviewSession()/
-- renderReviewSessionItem() in site/portal-stable.js before writing this)
-- passes null and never touches attempt_count/correct_count at all.
-- ---------------------------------------------------------------------
create or replace function public.record_task_evidence_internal(
  p_profile_id uuid,
  p_acs_task_id uuid,
  p_correct boolean,
  p_is_scenario boolean default false,
  p_source_type text default null,
  p_source_id text default null,
  p_is_review boolean default false,
  p_self_confidence numeric default null
)
returns public.task_evidence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_evidence%rowtype;
  v_ledger_rows integer;
  v_review_success boolean := coalesce(p_self_confidence, 0) >= 0.5;
begin
  if p_source_type is not null and p_source_id is not null then
    insert into public.task_evidence_sources (profile_id, acs_task_id, source_type, source_id)
    values (p_profile_id, p_acs_task_id, p_source_type, p_source_id)
    on conflict do nothing;
    get diagnostics v_ledger_rows = row_count;
    if v_ledger_rows = 0 then
      -- Already recorded for this exact source event -- true no-op.
      select * into v_row from public.task_evidence
      where profile_id = p_profile_id and acs_task_id = p_acs_task_id;
      return v_row;
    end if;
  end if;

  if p_correct is null then
    -- Confidence-only evidence -- never increments attempt_count/
    -- correct_count. self_confidence is the latest rating only (not
    -- cumulative -- self-assessment isn't a running average the way
    -- objective correctness is). review_attempt_count/review_correct_count
    -- are a separate, clearly-labeled counter pair for self-assessed
    -- Review Session outcomes -- never conflated with objective accuracy.
    insert into public.task_evidence (
      profile_id, acs_task_id, self_confidence, confidence_updated_at,
      review_attempt_count, review_correct_count, last_attempt_at
    ) values (
      p_profile_id, p_acs_task_id, p_self_confidence, now(),
      case when p_is_review then 1 else 0 end,
      case when p_is_review and v_review_success then 1 else 0 end,
      now()
    )
    on conflict (profile_id, acs_task_id) do update set
      self_confidence = p_self_confidence,
      confidence_updated_at = now(),
      review_attempt_count = public.task_evidence.review_attempt_count + case when p_is_review then 1 else 0 end,
      review_correct_count = public.task_evidence.review_correct_count + case when p_is_review and v_review_success then 1 else 0 end,
      last_attempt_at = now()
    returning * into v_row;
  else
    -- Objective evidence -- unchanged from the original v113 behavior.
    insert into public.task_evidence (
      profile_id, acs_task_id, attempt_count, correct_count, scenario_attempt_count,
      last_attempt_at, last_correct_at
    ) values (
      p_profile_id, p_acs_task_id, 1,
      case when p_correct then 1 else 0 end,
      case when p_is_scenario then 1 else 0 end,
      now(),
      case when p_correct then now() else null end
    )
    on conflict (profile_id, acs_task_id) do update set
      attempt_count = public.task_evidence.attempt_count + 1,
      correct_count = public.task_evidence.correct_count + case when p_correct then 1 else 0 end,
      scenario_attempt_count = public.task_evidence.scenario_attempt_count + case when p_is_scenario then 1 else 0 end,
      last_attempt_at = now(),
      last_correct_at = case when p_correct then now() else public.task_evidence.last_correct_at end
    returning * into v_row;
  end if;

  -- Recompute derived fields from the row's current state. confidence_
  -- alignment is CALIBRATION (how well self-confidence matches actual
  -- objective performance on this same task), not a raw pass-through of
  -- the rating -- v113/v114's own comments frame it this way explicitly
  -- ("confidence-calibration data"); only ever computed when both a
  -- self-rating and real objective accuracy already exist, else left
  -- null exactly like today's "not yet available" default. evidence_score
  -- keeps its existing accuracy*volume-dampener term unchanged and adds
  -- a small, separately-tracked, bounded review-success bonus: the first
  -- successful review contributes nothing extra (one review can never
  -- jump a task to mastery), each additional success adds +0.03, capped
  -- at +0.15 total, and the final score is clamped to 1.0.
  update public.task_evidence
  set recent_accuracy = round(correct_count::numeric / nullif(attempt_count, 0), 4),
      confidence_alignment = case
        when self_confidence is not null and attempt_count > 0
        then round(1 - abs(self_confidence - (correct_count::numeric / attempt_count)), 4)
        else null
      end,
      evidence_score = least(1.0, round(
        coalesce(correct_count::numeric / nullif(attempt_count, 0), 0) * least(1.0, attempt_count / 5.0)
        + least(0.15, 0.03 * greatest(0, review_correct_count - 1))
      , 4)),
      updated_at = now()
  where profile_id = p_profile_id and acs_task_id = p_acs_task_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) from public, anon, authenticated;
grant execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) to service_role;

-- Existing 4-arg signature preserved verbatim -- complete_mobile_
-- practice_session() calls this exact shape and needs zero changes.
create or replace function public.record_task_evidence(
  p_profile_id uuid, p_acs_task_id uuid, p_correct boolean, p_is_scenario boolean default false
)
returns public.task_evidence
language sql
security definer
set search_path = public
as $$
  select public.record_task_evidence_internal(p_profile_id, p_acs_task_id, p_correct, p_is_scenario);
$$;

revoke execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------
-- record_ground_school_evidence(): the one new client-facing evidence
-- RPC for Ground School content -- module quiz correctness (objective)
-- and Checkride Corner/Scenario Workshop ratings (confidence-only),
-- both resolved through the same content_acs_mappings lookup. A source
-- with no mapping row (e.g. an unmapped process question, or any module
-- besides PPL-M01 today) is silently a no-op -- exactly correct, since
-- unmapped content has nothing to record evidence against.
-- ---------------------------------------------------------------------
create or replace function public.record_ground_school_evidence(
  p_profile_id uuid,
  p_content_type text,
  p_content_id text,
  p_source_id text,
  p_is_correct boolean default null,
  p_self_confidence numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to record evidence for this profile';
  end if;
  if p_content_type not in ('module_quiz_question', 'checkride_corner', 'scenario_workshop') then
    raise exception 'invalid_content_type: %', p_content_type;
  end if;

  for v_task in
    select acs_task_id from public.content_acs_mappings
    where content_type = p_content_type and content_id = p_content_id
  loop
    perform public.record_task_evidence_internal(
      p_profile_id, v_task.acs_task_id, p_is_correct, false,
      p_content_type, p_source_id, false, p_self_confidence
    );
  end loop;
end;
$$;

revoke execute on function public.record_ground_school_evidence(uuid, text, text, text, boolean, numeric) from public, anon;
grant execute on function public.record_ground_school_evidence(uuid, text, text, text, boolean, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- record_review_outcome(): extended to also record review evidence for
-- dpe_question-sourced items (the only source_type with a
-- content_acs_mappings row today). Always confidence-only (p_correct =
-- null, p_is_review = true) -- Review Session never re-grades an answer
-- objectively for any source type, so this must never silently increment
-- correct_count. reinforced -> self_confidence 0.85, needs_another_pass
-- -> 0.15. Source id uses the row's own post-increment review_count
-- (a durable, server-computed value from this same locked transaction,
-- not a client-supplied counter) so distinct review attempts over time
-- get distinct, correctly-ordered ledger entries.
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
  v_task record;
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
  else
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
  end if;

  if v_row.source_type = 'dpe_question' then
    for v_task in
      select acs_task_id from public.content_acs_mappings
      where content_type = 'dpe_question' and content_id = v_row.source_id
    loop
      perform public.record_task_evidence_internal(
        v_row.profile_id, v_task.acs_task_id, null, false,
        'review_outcome', v_row.id::text || ':' || v_row.review_count,
        true,
        case when p_outcome = 'reinforced' then 0.85 else 0.15 end
      );
    end loop;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.record_review_outcome(uuid, text) from public, anon;
grant execute on function public.record_review_outcome(uuid, text) to authenticated;
