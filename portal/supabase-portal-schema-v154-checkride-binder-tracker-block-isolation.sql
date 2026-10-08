-- Checkride Binder Builder -- Tracker Block Isolation Fix (v154)
--
-- Live verification of the Checkride Binder Builder (walking through it
-- end-to-end as a real test account, per the user's request after the
-- feature was already confirmed deployed) found that
-- checkride_binder_tracker_entries is keyed only by (profile_id,
-- section_id) -- never by WHICH tracker block within that section.
-- 9 of the 27 sections have more than one tracker block in the same
-- section (endorsements-experience has 5: Endorsement Tracker,
-- Missing-Item Action Plan, and three Experience Audit trackers), so
-- every one of those sections rendered ALL of its tracker rows into
-- EVERY tracker table in that section, and removing one row emptied
-- every table in the section at once -- confirmed live: adding one row
-- in the Endorsements & Experience section made a "Remove" row appear in
-- BOTH the Endorsement Tracker AND the unrelated Missing-Item Action
-- Plan table, and clicking Remove on it cleared both.
--
-- One real customer already has 8 real rows in `wb-performance` (which
-- has two tracker blocks, "W&B Source Inputs -- Loading Inputs" and
-- "W&B Calculation Workspace"). Inspected and confirmed every one of
-- those 8 rows' `fields.weight` value matches a Loading-Inputs seedRows
-- label exactly (Basic empty weight, Pilot / front seat, Passenger /
-- front seat, Rear passengers, Baggage area 1, Baggage area 2, Fuel at
-- departure, Other installed / carried item -- all 8, no duplicates,
-- none touching the "check" column unique to Calculation Workspace), so
-- backfilling them to that block is a verified fact, not a guess.
--
-- Fix:
--   a) every tracker-type content block gets a stable `id` (by exact
--      title match against the one-time enumeration of all 19 tracker
--      blocks across the 9 affected sections -- verified 19/19 matched
--      after this ran, zero left without an id);
--   b) a new `block_key` column on checkride_binder_tracker_entries
--      records which block a row belongs to, backfilled for the one
--      real affected row set, nullable for any row written before this
--      column existed;
--   c) the matching client-side fix (site/portal-stable.js:
--      cbRenderTracker/cbAddTrackerRow/cbSeedTrackerRowsIfNeeded) is a
--      separate, same-session commit -- it filters rendered/seeded rows
--      by block_key, falling back to treating a NULL block_key as
--      belonging to the section's first tracker block only (matching
--      where such a row would have rendered before this fix), never
--      duplicating it into every tracker the way the bug did.
--   d) cbSeedTrackerRowsIfNeeded's own "has this already been seeded"
--      check was scoped to the whole section, not the specific tracker
--      block -- so a section with a second, already-used tracker (e.g.
--      a manually-added Calculation Workspace row) would silently skip
--      ever seeding Loading Inputs for that member. Also fixed to check
--      per-block.

alter table public.checkride_binder_tracker_entries
  add column if not exists block_key text;

comment on column public.checkride_binder_tracker_entries.block_key is
  'Which tracker block within section_id this row belongs to (matches the tracker content block''s own `id` in checkride_binder_content) -- required because several sections have more than one tracker block (e.g. endorsements-experience has 5). NULL means this row predates the column; site/portal-stable.js treats a NULL/unmatched block_key as belonging to whichever tracker block is first in the section for backward display purposes only, never as a license to keep writing rows without one.';

with id_map(section_id, title, new_id) as (values
  ('endorsements-experience', 'Endorsement Tracker', 'endorsement-tracker'),
  ('endorsements-experience', 'Missing-Item Action Plan', 'missing-item-action-plan'),
  ('endorsements-experience', 'Experience Audit: Cross-Country Training (3 hr minimum)', 'xc-training-audit'),
  ('endorsements-experience', 'Experience Audit: Night Training (3 hr minimum)', 'night-training-audit'),
  ('endorsements-experience', 'Experience Audit: Instrument-Reference Training (3 hr minimum)', 'instrument-training-audit'),
  ('maintenance-airworthiness', 'Recurring AD Tracker (leave blank if no recurring AD applies)', 'recurring-ad-tracker'),
  ('maintenance-airworthiness', 'Inoperative Equipment Practice Drills', 'inop-equipment-drills'),
  ('maintenance-airworthiness', 'Aircraft Discrepancy Action Log', 'discrepancy-action-log'),
  ('wb-performance', 'W&B Source Inputs -- Loading Inputs', 'loading-inputs'),
  ('wb-performance', 'W&B Calculation Workspace', 'calculation-workspace'),
  ('oral-answer-framework', '10-Question Rapid-Fire Oral Log', 'rapid-fire-oral-log'),
  ('oral-answer-framework', 'Oral Weak-Area Action Plan', 'oral-weak-area-plan'),
  ('cfi-final-review', 'Open Items Before Sign-Off', 'open-items-before-signoff'),
  ('cfi-final-review', 'Final Open-Item Closure', 'final-open-item-closure'),
  ('knowledge-test-report', 'Deficient Knowledge Areas', 'deficient-knowledge-areas'),
  ('knowledge-test-report', 'Knowledge Deficiency Review', 'knowledge-deficiency-review'),
  ('cross-country-planning', 'Checkpoint / Leg Map', 'checkpoint-leg-map'),
  ('open-items-log', 'Open Items', 'open-items'),
  ('weather-decision-making', 'Relevant NOTAMs', 'relevant-notams')
),
rebuilt as (
  select c.section_id,
    jsonb_set(c.content, '{blocks}',
      (select jsonb_agg(
        case when b->>'type' = 'tracker' and m.new_id is not null
          then b || jsonb_build_object('id', m.new_id)
          else b
        end
        order by ord
      )
      from jsonb_array_elements(c.content->'blocks') with ordinality as t(b, ord)
      left join id_map m on m.section_id = c.section_id and m.title = b->>'title'
      )
    ) as new_content
  from checkride_binder_content c
)
update checkride_binder_content c
set content = r.new_content
from rebuilt r
where r.section_id = c.section_id;

-- The one real, unambiguous backfill (see header comment).
update public.checkride_binder_tracker_entries
set block_key = 'loading-inputs'
where section_id = 'wb-performance' and block_key is null;
