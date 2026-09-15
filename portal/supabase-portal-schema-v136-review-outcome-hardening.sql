-- Apex Advantage — Sprint 4.1 Part 5+6: review-outcome idempotency
-- replay contract + Ground School Review Queue -> ACS evidence
--
-- ISSUE 4: record_review_outcome()'s idempotency ledger (v132) already
-- prevented a raw network retry from double-incrementing counters, but
-- only checked that a replayed key belonged to the SAME PROFILE --  not
-- that it represented the SAME logical request. A key reused (by
-- accident or otherwise) against a different review_item_id or a
-- different outcome would silently replay the FIRST result rather than
-- being rejected -- a correctness/security gap, not just a UX one.
-- record_review_outcome() now also verifies stored.review_item_id =
-- p_review_item_id and stored.outcome = p_outcome on every replay; any
-- mismatch raises idempotency_key_conflict and mutates nothing.
--
-- ISSUE 5 (audit finding): Review Queue items exist for four source
-- types (dpe_question, module_quiz_question, checkride_corner,
-- scenario), but record_review_outcome() only ever resolved an ACS
-- task and wrote evidence for source_type = 'dpe_question' -- Ground
-- School-derived review items (created by sync_review_queue() from
-- Sprint 4's 449 new content_acs_mappings) produced ZERO evidence when
-- reviewed, not even confidence-only evidence, because the branch
-- covering them was never written. This extends the exact same
-- confidence-only (p_correct = null) treatment dpe_question already
-- used -- "Reinforced" was never conflated with "objectively correct"
-- for dpe_question either, and stays that way here -- to all three
-- Ground-School source types, resolving each one's content_acs_mappings
-- key from portal_review_items' own source_id/module_id columns:
--   dpe_question        -> content_type 'dpe_question',        content_id = source_id
--   module_quiz_question -> content_type 'module_quiz_question', content_id = source_id
--   checkride_corner     -> content_type 'checkride_corner',     content_id = module_id || ':' || source_id
--   scenario              -> content_type 'scenario_workshop',    content_id = module_id
-- (portal_review_items uses 'scenario' as its own source_type value;
-- content_acs_mappings uses 'scenario_workshop' -- the two do not share
-- a vocabulary and must be translated, not assumed equal.)
create or replace function public.record_review_outcome(
  p_review_item_id uuid, p_outcome text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.portal_review_items%rowtype;
  v_prev_interval interval;
  v_next_interval interval;
  v_task record;
  v_ledger_rows integer;
  v_stored jsonb;
  v_stored_profile_id uuid;
  v_stored_review_item_id uuid;
  v_stored_outcome text;
  v_content_type text;
  v_content_id text;
begin
  if p_outcome not in ('reinforced', 'needs_another_pass') then
    raise exception 'invalid_outcome: % is not reinforced or needs_another_pass', p_outcome;
  end if;
  if p_idempotency_key is null then
    raise exception 'p_idempotency_key is required';
  end if;

  insert into public.review_outcome_submissions (idempotency_key, profile_id, review_item_id, outcome, result)
  values (p_idempotency_key, auth.uid(), p_review_item_id, p_outcome, '{}'::jsonb)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_ledger_rows = row_count;

  if v_ledger_rows = 0 then
    select result, profile_id, review_item_id, outcome
      into v_stored, v_stored_profile_id, v_stored_review_item_id, v_stored_outcome
    from public.review_outcome_submissions where idempotency_key = p_idempotency_key;

    if v_stored_profile_id is distinct from auth.uid() then
      raise exception 'Not authorized to update this review item';
    end if;

    -- Issue 4: a reused key must represent the exact same immutable
    -- logical request -- same review item, same outcome. A mismatch on
    -- either is a distinct logical action smuggled under someone else's
    -- key (accidental reuse or otherwise), never silently replayed.
    if v_stored_review_item_id <> p_review_item_id or v_stored_outcome <> p_outcome then
      raise exception 'idempotency_key_conflict: this key was already used for a different review item or outcome';
    end if;

    if v_stored = '{}'::jsonb then
      raise exception 'review_outcome_in_progress';
    end if;
    return v_stored || jsonb_build_object('was_replay', true);
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

  -- Confidence-only evidence for every source type with a real
  -- content_acs_mappings key. p_correct stays null throughout: a
  -- "Reinforced" review outcome is supporting/confidence evidence, not
  -- a fabricated objective correctness signal, for every source type
  -- including dpe_question (unchanged from v127's original design).
  v_content_type := case v_row.source_type
    when 'scenario' then 'scenario_workshop'
    else v_row.source_type
  end;
  v_content_id := case v_row.source_type
    when 'checkride_corner' then v_row.module_id || ':' || v_row.source_id
    when 'scenario' then v_row.module_id
    else v_row.source_id
  end;

  for v_task in
    select acs_task_id from public.content_acs_mappings
    where content_type = v_content_type and content_id = v_content_id
  loop
    perform public.record_task_evidence_internal(
      v_row.profile_id, v_task.acs_task_id, null, false,
      'review_outcome', v_row.id::text || ':' || v_row.review_count,
      true,
      case when p_outcome = 'reinforced' then 0.85 else 0.15 end
    );
  end loop;

  v_stored := to_jsonb(v_row) || jsonb_build_object('was_replay', false);
  update public.review_outcome_submissions set result = v_stored where idempotency_key = p_idempotency_key;

  return v_stored;
end;
$$;

revoke execute on function public.record_review_outcome(uuid, text, uuid) from public, anon;
grant execute on function public.record_review_outcome(uuid, text, uuid) to authenticated;
