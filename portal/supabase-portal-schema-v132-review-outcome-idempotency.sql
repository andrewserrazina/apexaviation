-- Apex Advantage — Sprint 4 Part 5: review-outcome idempotency
--
-- Closes the known Sprint 3 limitation: record_review_outcome() had no
-- protection against a raw network retry of one logical button click --
-- a lost response followed by a client retry could increment
-- review_count (and successful_review_count, and write duplicate
-- task_evidence) twice for one logical review action.
--
-- Architecture: a client-generated idempotency key, reused across
-- retries of the SAME logical submission (never regenerated on
-- rerender/retry -- see the paired client-side change), enforced
-- server-side via a durable ledger + INSERT...ON CONFLICT DO NOTHING,
-- adapting the exact shape this repo's own xp_ledger/task_evidence_sources
-- already use (server-computed natural key there; here the key is
-- client-supplied, since the "natural key" for one logical UI submission
-- doesn't otherwise exist before the write happens).
--
-- record_review_outcome()'s only caller (advanceReviewSession(),
-- site/portal-stable.js) is updated in this same sprint, so the RPC's
-- signature and return shape can both change directly -- no legacy-
-- wrapper needed (unlike Sprint 3's record_task_evidence(), which had a
-- real external caller in complete_mobile_practice_session()). The RPC's
-- result was previously discarded entirely by the client (verified via
-- audit), so widening the return type from `portal_review_items` to
-- `jsonb` (to carry a was_replay flag) is safe.
create table if not exists public.review_outcome_submissions (
  idempotency_key uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  review_item_id uuid not null references public.portal_review_items(id) on delete cascade,
  outcome text not null check (outcome in ('reinforced', 'needs_another_pass')),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_outcome_submissions_profile on public.review_outcome_submissions (profile_id, created_at);

alter table public.review_outcome_submissions enable row level security;

drop policy if exists "Members read their own review outcome submissions" on public.review_outcome_submissions;
create policy "Members read their own review outcome submissions"
  on public.review_outcome_submissions for select
  using ((select auth.uid()) = profile_id);

-- No insert/update/delete policy -- the only write path is the
-- SECURITY DEFINER function below.
revoke insert, update, delete on public.review_outcome_submissions from anon, authenticated;

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
begin
  if p_outcome not in ('reinforced', 'needs_another_pass') then
    raise exception 'invalid_outcome: % is not reinforced or needs_another_pass', p_outcome;
  end if;
  if p_idempotency_key is null then
    raise exception 'p_idempotency_key is required';
  end if;

  -- Idempotency gate: try to claim this key first, before touching any
  -- counter. A duplicate claim (row_count = 0) means this exact logical
  -- submission was already processed (or is concurrently in flight) --
  -- replay the stored result rather than redoing any work.
  insert into public.review_outcome_submissions (idempotency_key, profile_id, review_item_id, outcome, result)
  values (p_idempotency_key, auth.uid(), p_review_item_id, p_outcome, '{}'::jsonb)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_ledger_rows = row_count;

  if v_ledger_rows = 0 then
    select result, profile_id into v_stored, v_stored_profile_id
    from public.review_outcome_submissions where idempotency_key = p_idempotency_key;
    if v_stored_profile_id is distinct from auth.uid() then
      raise exception 'Not authorized to update this review item';
    end if;
    if v_stored = '{}'::jsonb then
      -- Genuinely concurrent in-flight duplicate (the first request's
      -- own transaction hasn't committed its result yet) -- exceedingly
      -- rare for a single logical UI submission, which is sequential by
      -- nature (a browser retry only ever follows the first request
      -- ending, not truly parallel to it). Surface a distinct, retryable
      -- error rather than returning an empty result.
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

  v_stored := to_jsonb(v_row) || jsonb_build_object('was_replay', false);
  update public.review_outcome_submissions set result = v_stored where idempotency_key = p_idempotency_key;

  return v_stored;
end;
$$;

revoke execute on function public.record_review_outcome(uuid, text, uuid) from public, anon;
grant execute on function public.record_review_outcome(uuid, text, uuid) to authenticated;

-- The old 2-arg signature is dropped -- its only caller is updated in
-- this same sprint (verified via audit: exactly one call site,
-- advanceReviewSession(), site/portal-stable.js), so no compatibility
-- wrapper is needed.
drop function if exists public.record_review_outcome(uuid, text);
