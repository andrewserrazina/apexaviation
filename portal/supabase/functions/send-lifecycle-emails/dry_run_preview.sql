-- =============================================================================
-- send-lifecycle-emails: read-only first-run dry-run preview
-- =============================================================================
-- Recovery-safeguard audit, Oct 2026. There is no in-process DRY_RUN mode
-- in index.ts -- building one safely would mean threading a no-op flag
-- through every one of the ~16 send/claim/stamp call sites this function
-- has (sendEmail, markMilestoneSent, portal_email_log inserts, the
-- checkout_session_attempts/mock_oral_bookings atomic-claim UPDATEs,
-- portal_milestone_emails claims), which is materially larger and riskier
-- surgery than the actual safeguards in this file. This script is the
-- documented fallback instead: a read-only mirror of the REAL eligibility
-- predicates (per-campaign age windows, throttles, and the new staleness
-- ceilings), run directly against production with zero writes.
--
-- Two campaigns (readiness milestones -- readiness_25/50/75/90 and
-- checkride_mode_completed_email -- and weak_area_*) depend on a real
-- weighted score / per-category completion computation that lives in
-- index.ts's computeReadinessScore()/categoryCompletion(), not reproduced
-- here. Those two sections below compute an UPPER BOUND (profiles who
-- have SOME activity and are missing a claim), not an exact count --
-- clearly labeled where they appear.
--
-- SAFE TO RUN ANY TIME: every query below is a plain SELECT. Nothing is
-- written, no sent_at/claim column is touched, no email is sent.
--
-- The GLOBAL_SEND_SUCCESS_CAP (10) and GLOBAL_SEND_FAILURE_CAP (10)
-- constants in index.ts mean that regardless of how large any single
-- section's count below is, a real run sends AT MOST 10 emails total,
-- across every campaign combined -- this script reports what's
-- ELIGIBLE, not what WILL be sent; the cap decides the latter, picking
-- the first-encountered eligible candidates in `profiles.id` order
-- (explicit `.order('id')`, added alongside the cap for this reason) for
-- the per-profile campaigns, and in each standalone campaign's own query
-- order for the rest.
-- =============================================================================

-- ── 1. reactivation_inactive (meaningful-activity-based, 14d trigger, 14d
--      throttle, 10d coordination gap, 90d staleness ceiling) ──
with activity as (
  select p.id as profile_id,
    greatest(
      coalesce((select max(updated_at) from portal_question_progress where profile_id = p.id and (answered_count > 0 or completed = true)), 'epoch'),
      coalesce((select max(updated_at) from portal_scenario_progress where profile_id = p.id and completed = true), 'epoch'),
      coalesce((select max(started_at) from portal_practice_attempts where profile_id = p.id), 'epoch'),
      coalesce((select max(started_at) from ai_dpe_sessions where profile_id = p.id), 'epoch')
    ) as last_meaningful
  from profiles p
  where p.email is not null and coalesce(p.email_marketing_opt_out, false) = false
),
last_email as (
  select profile_id,
    max(sent_at) filter (where email_type = 'reactivation_inactive') as last_reactivation,
    max(sent_at) filter (where email_type = 'inactivity_7day') as last_inactivity7
  from portal_email_log group by profile_id
)
select 'reactivation_inactive' as campaign, count(*) as eligible_now
from activity a left join last_email le on le.profile_id = a.profile_id
where (now() - a.last_meaningful) between interval '14 days' and interval '90 days'
  and (le.last_reactivation is null or now() - le.last_reactivation >= interval '14 days')
  and (le.last_inactivity7 is null or now() - le.last_inactivity7 >= interval '10 days')

union all

-- ── 2. inactivity_7day (portal_last_active_at-based, 7d trigger, 30d
--      throttle, 10d coordination gap, 90d staleness ceiling) ──
select 'inactivity_7day', count(*)
from profiles p
left join (
  select profile_id,
    max(sent_at) filter (where email_type = 'inactivity_7day') as last_inactivity7,
    max(sent_at) filter (where email_type = 'reactivation_inactive') as last_reactivation
  from portal_email_log group by profile_id
) le on le.profile_id = p.id
where p.email is not null and coalesce(p.email_marketing_opt_out, false) = false
  and (now() - coalesce(p.portal_last_active_at, p.created_at)) between interval '7 days' and interval '90 days'
  and (le.last_inactivity7 is null or now() - le.last_inactivity7 >= interval '30 days')
  and (le.last_reactivation is null or now() - le.last_reactivation >= interval '10 days')

union all

-- ── 3. weekly_progress (7d throttle, requires real activity in trailing
--      7 days -- inherently self-limiting, no staleness ceiling needed) ──
select 'weekly_progress', count(*)
from profiles p
left join (select profile_id, max(sent_at) as last_weekly from portal_email_log where email_type = 'weekly_progress' group by profile_id) le on le.profile_id = p.id
where p.email is not null and coalesce(p.email_marketing_opt_out, false) = false
  and (le.last_weekly is null or now() - le.last_weekly >= interval '7 days')
  and (
    exists(select 1 from portal_question_progress where profile_id = p.id and updated_at >= now() - interval '7 days' and (answered_count > 0 or completed = true))
    or exists(select 1 from portal_scenario_progress where profile_id = p.id and updated_at >= now() - interval '7 days' and completed = true)
    or exists(select 1 from portal_practice_attempts where profile_id = p.id and started_at >= now() - interval '7 days')
    or exists(select 1 from ai_dpe_sessions where profile_id = p.id and started_at >= now() - interval '7 days')
  )

union all

-- ── 4. first_question_completed (unconditional, one-time via portal_milestone_emails) ──
select 'first_question_completed', count(*)
from profiles p
where p.email is not null
  and exists(select 1 from portal_question_progress where profile_id = p.id and completed = true)
  and not exists(select 1 from portal_milestone_emails where profile_id = p.id and milestone_key = 'first_question_completed')

union all

-- ── 5. readiness_25/50/75/90 + checkride_mode_completed_email -- UPPER
--      BOUND ONLY (real gate needs the weighted score formula) ──
select 'readiness_and_checkride_mode_milestones (UPPER BOUND)', count(*)
from profiles p
where p.checkride_prep_unlocked = true
  and (
    exists(select 1 from portal_question_progress where profile_id = p.id and completed = true)
    or exists(select 1 from portal_scenario_progress where profile_id = p.id and completed = true)
  )
  and (
    not exists(select 1 from portal_milestone_emails where profile_id = p.id and milestone_key in ('readiness_25','readiness_50','readiness_75','readiness_90'))
    or not exists(select 1 from portal_events where profile_id = p.id and event_type = 'checkride_mode_completed_email')
  )

union all

-- ── 6. weak_area_* -- UPPER BOUND ONLY (real gate needs per-category completion) ──
select 'weak_area (UPPER BOUND)', count(*)
from profiles p
where p.email is not null and p.checkride_prep_unlocked = true
  and not exists(select 1 from portal_email_log l where l.profile_id = p.id and l.email_type like 'weak_area_%' and now() - l.sent_at < interval '14 days')

union all

-- ── 7. checkride_countdown_* (date-driven, inherently time-bound) ──
select 'checkride_countdown', count(*)
from portal_checkride_date d
join profiles p on p.id = d.profile_id
where p.email is not null
  and d.checkride_date >= current_date and d.checkride_date <= current_date + 30
  and not exists(select 1 from portal_events e where e.profile_id = d.profile_id and e.event_type = ('checkride_countdown_' || (select min(t) from unnest(array[30,14,7,3,1]) t where t >= (d.checkride_date - current_date))))

union all

-- ── 8. checkride_upsell_day* (not unlocked, exhausts to one latest stage
--      per profile per run -- no staleness ceiling added; its own
--      schedule already tops out at day30, same precedent reused by the
--      readiness-followup ceiling) ──
select 'checkride_upsell (approx -- not unlocked, signup age-based)', count(*)
from profiles p
where p.checkride_prep_unlocked = false and p.email is not null and coalesce(p.email_marketing_opt_out, false) = false

union all

-- ── 9. new_member_activation_day1/3/7 + activation_email_1 catch-up
--      (gated on NEW_MEMBER_ACTIVATION_SINCE being configured -- see this
--      directory's README/report for how presence was confirmed without
--      reading the env var itself; 90d staleness ceiling applied) ──
select 'new_member_activation (requires NEW_MEMBER_ACTIVATION_SINCE configured)', count(*)
from profiles p
where p.email is not null and coalesce(p.email_marketing_opt_out, false) = false
  and now() - p.created_at <= interval '90 days'
  and not exists(select 1 from portal_question_progress where profile_id = p.id and (answered_count > 0 or completed = true))
  and not exists(select 1 from portal_scenario_progress where profile_id = p.id and completed = true)
  and not exists(select 1 from portal_practice_attempts where profile_id = p.id)
  and not exists(select 1 from ai_dpe_sessions where profile_id = p.id)

union all

-- ── 10. Ground-school follow-up (bounded 45 days by existing design) ──
select 'ground_followup', count(*)
from ground_registrations r
left join profiles p on p.id = r.profile_id
where r.attendance_status = 'completed' and r.checked_out_at >= now() - interval '45 days' and r.email is not null
  and coalesce(p.email_marketing_opt_out, false) = false
  and not exists(select 1 from portal_email_log l where l.email_type = 'ground_followup_' || r.id::text)

union all

-- ── 11. Mock-oral 24h reminder (exempt from the global cap -- time-sensitive, inherently small) ──
select 'mock_oral_reminder (exempt from global cap)', count(*)
from mock_oral_bookings b
join mock_oral_availability a on a.id = b.availability_id
where b.status = 'confirmed' and b.reminder_sent_at is null
  and (a.class_date + a.start_time) between now() and now() + interval '24 hours'

union all

-- ── 12/13. Abandoned-checkout recovery, first + second touch (bounded
--      1h-7d / 48h-after-first-touch by existing design) ──
select 'abandoned_checkout_first_touch', count(*)
from checkout_session_attempts
where completed_at is null and recovery_email_sent_at is null and recovery_suppressed_at is null
  and created_at between now() - interval '7 days' and now() - interval '1 hour'

union all

select 'abandoned_checkout_second_touch', count(*)
from checkout_session_attempts
where completed_at is null and recovery_email_sent_at is not null and recovery_email_2_sent_at is null and recovery_suppressed_at is null
  and recovery_email_sent_at <= now() - interval '48 hours'

union all

-- ── 14. Readiness-assessment Day1/3/6 follow-up (already windowed + 30d
--      ceiling + its own 25/run local cap, on top of the global cap) ──
select 'readiness_assessment_followup', count(*)
from readiness_assessment_leads l
where l.email is not null
  and not exists(select 1 from profiles p where p.email ilike l.email)
  and now() - l.created_at <= interval '30 days';
