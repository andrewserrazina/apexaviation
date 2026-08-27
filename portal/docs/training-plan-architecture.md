# Apex Advantage Training OS — Phase 1 architecture

Scope note: this is the foundation-and-first-slice pass of a much larger spec
("Apex Advantage Training Operating System"). It ships real, verified code for
the highest-leverage/lowest-risk pieces and documents the rest as designed but
deferred, rather than shipping shallow, unverified versions of everything.
See the "Deferred" section at the bottom for what's next and why it wasn't
done in this pass.

## 1. What existed before this pass

Three independent systems all answered some version of "what should this
member do next," none sharing logic or data model:

1. **`renderMyTraining()`** (`site/portal-stable.js`) — "what to study,"
   feeding both the Next Best Action card and Today's Flight Plan checklist.
   Priority: unstudied QOTD → weakest ACS category → unstudied scenario →
   "caught up."
2. **`renderRecommendedNextStep()` / `getMemberConversionState()`** —
   "what stage of the program you're at" (new free member, individual-class
   student, checkride-soon, etc.), driving a separate upsell card.
3. **`renderCheckrideCountdown()`** — a standalone day-count widget reading
   the same `checkrideDate` as #2 but with its own (slightly different)
   day-math.

Three separate implementations of "find the member's worst ACS category"
existed across `weakestCategory()`, `renderWeakAreas()`, and
`checkWeakAreaEmail()`.

## 2. What this pass changed

**`computeTrainingPlan()`** (new, `site/portal-stable.js`) is now the single
source of truth for "what should this member do today." It implements the
spec's exact priority order:

1. Upcoming registered Ground School class within 24 hours (elevates a
   pre-class banner + a "Join the class" task, outranks everything else)
2. Not-unlocked state (returns the unlock-prompt task list, same as before)
3. Checkride within 14 days + a weak category → both surface in the "why"
   explanation together
4. Weakest ACS category → review task
5. An unstudied scenario *within that weak category* specifically (not just
   any scenario, per spec) → task
6. Today's oral-exam question if unstudied (kept — a real daily-habit signal
   the original system already had)
7. AI DPE Practice if the member's last session (`myAiDpeSessions[0]`, via
   the new `get_my_recent_ai_dpe_sessions` RPC) is ≥7 days old or doesn't
   exist
8. Otherwise, a lighter DPE Rapid Fire suggestion
9. "All ACS areas complete" / caught-up state when there's no weak category
   left

Task list is capped at 4 items (matches the spec's mockup). `renderMyTraining()`
now calls this once and renders its output into a redesigned dashboard card
(`Your Training Plan` — `site/portal.html`) showing Checkride days / Readiness
% / Primary Focus up top, the flight-plan checklist, and a "why these tasks"
line — replacing the old 3-mini-card grid (Next Best Action / Next Class /
Resume Studying), which is retired (nothing else referenced those DOM IDs).

`renderRecommendedNextStep()` and `renderCheckrideCountdown()` are
**unchanged in their own right** — they still serve genuinely distinct
purposes (stage-based upsell messaging; the actual date-editing control) and
nothing in the spec requires deleting working systems. What changed is that
they're no longer the *only* place a member sees their checkride countdown or
weak-area signal — that summary now also appears, consistently, in the
unified Training Plan card.

### Bug fixed as a side effect

`renderMyTraining()`'s old "Next Class" check only read the legacy
`myGroundRegistrations` table, so a member registered only for a modern
`scheduled_ground_classes` class saw "No registered class yet." The new
`upcomingRegisteredClass()` helper merges both sources.

## 3. Why computed, not persisted (`daily_tasks` table)

The spec explicitly allows either approach ("If a new table is not necessary
and the plan can be generated dynamically from existing progress state,
prefer the simpler architecture"). This pass computes the plan live, every
render, with no new table. Reasoning:

- Every signal the plan needs already persists in its own table/RPC
  (`portal_question_progress`, `portal_scenario_progress`,
  `scheduled_ground_class_enrollments`, `ai_dpe_sessions`,
  `portal_checkride_date`). A `daily_tasks` table would be a *cache* of a
  join across all of them, not a new source of truth — and caches go stale.
- A persisted table needs a generation job (what runs it — page load? cron?
  webhook?), a completion-sync mechanism, and a migration path for every
  future change to the priority logic. None of that exists today, and this
  session has no way to stand up or test a cron job against a live database.
- The plan is cheap to compute: it's array filters and a handful of
  comparisons over data that's already loaded into the client for other
  widgets on the same page load. There's no performance case for caching it.

**Tradeoff being accepted:** a persisted table would let the plan carry
state across a session (e.g., "this task was explicitly dismissed today, not
just completed") and would support the notification event catalog in
section 8 more naturally (a change to a persisted task row is a clean
webhook trigger; a recomputed-every-render value isn't). If/when
notifications become real infrastructure, revisit this — a lightweight
`training_plan_snapshots` table written once per day per member (not a full
task-tracking system) would likely be the right middle ground.

## 4. Module ↔ content mapping (`GS_MODULE_CONTENT_MAP`)

No mapping between the 20 Ground School modules and the 11 DPE/scenario
categories existed anywhere in the codebase before this. Built in
`site/portal-stable.js` next to `ACS_TRACKER` (which already does the same
kind of topic-matching for DPE categories → real ACS Areas of Operation, so
this follows established precedent, e.g. `ACS_TRACKER` already maps "Human
Factors" → `aeromedical`, which this table also uses for `PPL-M17`).

Real IDs from `portal/src/data/privatePilotCurriculum.js`, matched to the
real 11-category taxonomy (`dpe_categories`, seeded in
`supabase-portal-schema-v5.sql` + `v10.sql`) by topic:

| Module | Category mapping | Note |
|---|---|---|
| PPL-M01 Becoming a Pilot | eligibility | |
| PPL-M02 Aerodynamics | performance | approximate — no exact category exists |
| PPL-M03 Aircraft Systems | aircraft-systems | exact |
| PPL-M04 FARs Simplified | privileges, eligibility | approximate |
| PPL-M05 Airspace Mastery | airspace | exact |
| PPL-M06 Airport Operations | airspace | + radio-calls.html free resource |
| PPL-M07–09 Navigation trio | crosscountry | |
| PPL-M10–11 Weather Theory/Products | weather | exact |
| PPL-M12 Weather Decision Making | weather, adm | |
| PPL-M13 Weight & Balance | performance | + weight-balance.html free resource |
| PPL-M14 Aircraft Performance | performance | exact |
| PPL-M15 Cross-Country Planning | crosscountry | exact |
| PPL-M16 Aeronautical Decision Making | adm | exact |
| PPL-M17 Human Factors | aeromedical | matches ACS_TRACKER's existing I.H mapping |
| PPL-M18 Emergency Procedures | emergency | + spin-awareness.html free resource |
| PPL-M19 ACS Mastery | *(none — cumulative)* | `cumulative: true` |
| PPL-M20 Mock Oral Exam | *(none — cumulative)* | `cumulative: true` |

Two modules (Aerodynamics, FARs Simplified) don't map cleanly onto any single
category — the 11-category taxonomy was built for DPE oral-exam question
topics, not 1:1 against the Ground School curriculum's module breakdown.
Flagged `approximate: true` rather than silently presented as exact.

`getModuleContent(moduleId)` is the read accessor; nothing else in the
codebase depended on this data existing, so this is additive only.

## 5. Ground School companion / Guided Notes entitlement (`hasModuleAccess`)

Per the audited entitlement model (`profiles.checkride_prep_unlocked`,
`profiles.private_pilot_ground_school_pack_unlocked` as flat boolean
"unlock everything" flags vs. per-row entitlement for individual $25
purchases):

```js
function hasModuleAccess(moduleId) {
  if (!member) return false;
  if (member.groundSchoolPackUnlocked) return true;       // $400 pack: all 20
  return myScheduledEnrollments.some(function (e) {        // $25 buyer: just their module
    return e.lesson_id === moduleId && (e.payment_status === 'paid' || e.payment_status === 'ground_school_pack');
  });
}
```

This reuses already-loaded client data (`myScheduledEnrollments`, from
`get_my_ground_school_enrollments`) — no new RPC needed. **This is a
client-side convenience check only.** The real boundary for Guided Notes
specifically is the `guided_notes` RLS policy (below), which is not yet
opened past admin-only in this pass.

## 6. Guided Notes: what's real vs. what's deferred

Audited in full before touching anything:

- **The RLS flip is a single, already-documented change.**
  `supabase-portal-schema-v14.sql`'s header comment states exactly what to
  do: drop the `and exists(...role = 'admin')` clause from the one policy.
  No other schema change needed.
- **The save/autosave mechanism is already production-quality.** Debounced
  autosave + manual save, both hitting the same idempotent `upsert` on
  `(profile_id, course_id, module_id, section_id, prompt_id)`. Nothing to
  build here.
- **The content is not ready.** Only 3 of 20 modules
  (`PPL-M01`/`M02`/`M03`) have any authored prompts at all, and even those
  are a single free-text question per prompt — no objectives section, no
  fill-in-the-blank structure, no "Checkride Corner," no post-class review
  questions (all called for in spec section 8).

**Decision: do not flip the RLS policy in this pass.** Flipping it now would
put a half-built feature (3/20 modules, minimal structure) in front of real
paying Ground School students. The framework (schema, save mechanism,
entitlement check) is production-ready; the content isn't. Shipping the flip
without content would be worse than not shipping it.

**What's needed to finish this:**
1. Author the missing 17 modules' prompt sets, plus retrofit the existing 3
   with the fuller structure (objectives / key concepts / fill-in areas /
   scenario prompts / Checkride Corner / review questions) spec section 8
   calls for. This is content work, not engineering — it shouldn't be
   fabricated by this pass.
2. Once content exists: run the one-line RLS policy change, gate the nav
   item and `showSection`/`enforceGuidedNotesAccess` checks on
   `hasModuleAccess(moduleId)` instead of `role === 'admin'`.
3. Build the per-module companion page UI (spec section 5) that Guided
   Notes lives inside — not built this pass; see section 8 below.

## 7. AI DPE memory: what's real vs. what's deferred

Audited finding: **session persistence already existed and was never read
back.** `ai_dpe_sessions` (schema `v32.sql`) has stored every session's full
transcript, question count, status, and qualitative debrief
(`overallReadiness` / `summary` / `strengths[]` / `weaknesses[]` /
`perDomain[]` — no numeric scores anywhere in the pipeline) since it shipped.
Nothing in the client ever queried it.

**This pass adds `get_my_recent_ai_dpe_sessions()`** (`v64.sql`) — a
read-only RPC, same house convention as every other read RPC
(`language sql / security definer / set search_path = public / stable`,
filtered by `auth.uid()`), fetched into `myAiDpeSessions` in the main
`loadProgress()` call. This is what makes Training Plan priority #7 ("AI DPE
if not run recently") possible with real data instead of guessing.

**Built (added later in this same pass):** an "AI DPE History" card
(`site/portal.html` → `#aiDpeHistoryCard`, inside `section-ai-dpe-practice`)
showing the member's session list (date, question count, overall-readiness
badge reusing the existing `.portal-debrief__badge--*` classes) and a
qualitative trend row. `computeAiDpeTrend()` compares the two most recent
*completed* sessions' `perDomain` verdicts per domain
(`weak`/`ok`/`strong`, ranked) and labels each domain "improving,"
"slipping," or its current verdict — entirely deterministic, no numbers
invented where the model only ever produced qualitative verdicts. The card
stays hidden for a member with zero sessions, so a first-time member's
experience is unchanged. Verified via the same Playwright mock harness with
two synthetic completed sessions showing one domain improving and one
slipping — both rendered with correct direction and pill styling, and the
Training Plan's "AI DPE not done recently" check correctly switched to
recommending Rapid Fire once a real recent session existed in the mock data.

## 8. Training Report (downloadable/printable)

Built after the rest of this pass. A "Training Report" card in Account
opens a print/PDF-oriented overlay generated entirely from data already
loaded client-side for other widgets — readiness, category coverage
(strongest/weakest 3 ACS categories), Ground School attendance (via
`upcomingRegisteredClass()` + `myScheduledEnrollments`), and AI DPE
sessions/trend (reusing `computeAiDpeTrend()` from section 7) — no new RPC.

Deliberately excludes billing/invoices and email; only name, certificate
goal, and checkride date identify the member, per the spec's explicit
"do not expose sensitive account data" instruction.

**Implementation choice: downloadable/printable via `window.print()`, not a
shareable link.** The spec allowed either; a client-side, sign-in-required
PDF avoids needing a new signed-token/expiration table and its own RLS
surface for a first version — a meaningfully bigger security decision than
this pass wanted to make without more design time. `@media print` isolates
`.portal-report-panel` via the standard `visibility: hidden` on `body *` /
`visibility: visible` on the panel subtree, so only the report prints, not
the portal chrome around it. The panel is styled light-on-white regardless
of the portal's dark theme, since it's meant to be handed to an instructor
as paper/PDF, not read on screen.

Verified with a Playwright test asserting both the report's text content
(all sections populate correctly from mock data covering an unlocked
member with real Ground School attendance and AI DPE history) and the
print isolation itself (nav `visibility: hidden`, report panel `visibility:
visible` under emulated print media).

**If a shareable link is wanted later:** a `training_report_shares` table
(`profile_id`, a random token, `expires_at`) with a public-safe read-only
RPC gated on a valid unexpired token would be the natural next step — not
built here since it's a genuinely different security surface than a
purely client-side, sign-in-required PDF.

## 9. Explicitly deferred (not started this pass)

Documented here rather than left unstated, so the punch list is honest:

- **Per-module companion pages** (spec section 5) — 20 individual
  member-facing pages/panels with before/live/after-class checklists. The
  data this needs (module content map, entitlement check, next-class
  lookup) is now built; the UI itself is not.
- **Pre-class / post-class flow beyond the dashboard banner** — this pass
  adds the elevated "class starts soon" banner + join-class task inside the
  Training Plan card (spec section 11), but not a dedicated post-class
  review screen (spec section 10) with its own recommended-next-steps CTA.
- **Instructor dashboard** (spec section 15) — not started; explicitly
  optional in the spec.
- **New achievements** (Ground School milestones, Training Plan streaks) —
  spec section 18 confirms adding these requires only a JS change
  (`ACHIEVEMENT_DEFS` in `site/portal-stable.js` is a hardcoded catalog
  evaluated client-side, no migration needed), but none were added this
  pass to avoid badge inflation without a clear signal for what's meaningful.
- **Analytics events** (spec section 20) — none of the new
  `training_plan_*` / `module_companion_*` / `guided_notes_*` events were
  added yet. House convention requires adding each to `EVENT_ALLOWLIST` in
  `site/analytics-events.js`; deferred until the UI surfaces that would fire
  them (module companion pages, Guided Notes) actually exist.
- **Notification event catalog** (spec section 19) — no infrastructure for
  this exists yet (confirmed: no push/cron system found in this codebase).
  Not designed in detail this pass beyond noting that a persisted
  `training_plan_snapshots` table (section 3 above) would be the natural
  hook if this gets built later.

## 10. Production verification gap

This sandbox has no live Supabase connection. Everything above was verified
by: reading the actual current source (not assumptions), a full syntax check
on the modified JS/SQL, and a Playwright test that mocks the Supabase client
and exercises `computeTrainingPlan()` through the real `renderMyTraining()`
code path against two realistic data scenarios (weak-category + checkride-
soon; class-starting-in-3-hours). Both produced correct output end to end —
see the session's verification notes for exact assertions. What is **not**
verified: behavior against real member data, real RLS enforcement (the mock
bypasses RLS entirely), and the `get_my_recent_ai_dpe_sessions` RPC has never
executed against a live Postgres instance. `supabase-portal-schema-v64.sql`
must be run in the Supabase SQL editor before `myAiDpeSessions` will ever
contain real data — until then it silently stays an empty array (the RPC
call fails gracefully, same pattern as every other RPC in `loadProgress()`).

## 11. Module Companion pages: built (later pass, real Module 1 content)

Section 9's "per-module companion pages... UI itself is not [built]" gap is
now closed for the one module with real authored content. A real Module 1
("Becoming a Pilot") production package — objectives, guided-notes
fill-in prompts, key concepts, a scenario worksheet, Checkride Corner
questions, and a scored 15-question Knowledge Check quiz with an answer
key — was the first real content to exist for this system, so the
Guided Notes admin-only preview (section 6 above) became the real,
student-facing "Module Workbook" nav item/page, gated by `hasModuleAccess()`
(any module purchased, or the full pack) instead of `role === 'admin'`.

Two content types, two different trust boundaries, same precedent as
`dpe_categories`/`dpe_questions` (admin-only RLS, served only through an
entitlement-checked Edge Function):

- `module_companion_content` (`supabase-portal-schema-v88.sql`) — the
  read-only workbook material, one JSONB blob per module, served through
  the new `get-module-companion-content` Edge Function, which verifies
  entitlement server-side via `requireModuleAccess()`
  (`_shared/premiumAccess.ts`) before returning anything — never trusting
  the client's own `hasModuleAccess()` convenience check.
- `module_quiz_questions` / `module_quiz_attempts` — the one genuinely
  new content type this introduces: a real scored quiz (as opposed to
  `guided_notes`' free-text-only, no-correct-answer shape). Questions
  (with the answer key) are served through the same Edge Function —
  self-study material a paying student is meant to see the explanation
  for, the same trust model `dpe_questions.model_answer` already uses,
  not a proctored exam needing server-side grading. Attempts are scored
  client-side against that same payload and recorded to
  `module_quiz_attempts` (own-row RLS) for progress tracking.

`guided_notes` itself is unchanged in shape — just opened past the
admin-only preview policy, the single-line change its own v14 header
comment already called for. Its existing `GUIDED_NOTES_MODULES` module-id
convention (`site/portal-stable.js`) predated `GS_MODULE_CONTENT_MAP` and
used a different id format (e.g. `PPL-M01-Becoming-a-Pilot` instead of the
real `PPL-M01`) — harmless while admin-only, fixed to the real ids in the
same change, since `hasModuleAccess()` needs it to match `lesson_id`.

**Still deferred:** the other 19 modules' full workbook structure (only
Module 1 has real content; the rest still show the lighter single-prompt-
per-section fallback from section 8 above) and the before/live/after-class
checklist framing section 5 originally called for — this pass built the
data model, entitlement, and rendering to take that shape the moment more
modules' content exists, not a guess at 19 more modules' content.
