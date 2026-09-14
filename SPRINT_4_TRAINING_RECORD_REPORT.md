# Sprint 4 — Instructor-Ready Training Record + Ground School Evidence Expansion

## Audit Findings

**Training Report** (pre-Sprint-4): built entirely from client-side in-memory vars
(`computeReadiness()`/`categoryPct()`), zero RPC calls, zero reference to
`readiness_snapshots`/`category_breakdown`/`myReviewQueue`. No mobile-width override for
`.portal-report-panel`. Zero `training_report_*` analytics events existed.

**Ground School**: 16 of 20 modules have real authored `module_companion_content`; `content_acs_mappings`
had exactly 5 rows (all PPL-M01, Sprint 3). `wireModuleQuizSection()` only computes an objective
`isCorrect` — and only ever calls `record_ground_school_evidence()` — for `question_type ===
'multiple_choice'`; `short_answer`/`scenario` quiz questions are never submitted to the evidence RPC at
all. `record_ground_school_evidence()` itself is fully generic across content type/module — no
application code changes were needed to activate evidence for a newly-mapped item, only new
`content_acs_mappings` rows.

**Review Queue**: `record_review_outcome()` (v127) had no protection against a raw network retry of one
logical button click — a lost response followed by a client retry could double-increment counters and
write duplicate `task_evidence`.

**Readiness refresh**: reached from exactly one call site (dashboard load), never after Practice, module
quiz, Review Session, or AI DPE completion.

## Training Report

Fully rewritten (`site/portal-stable.js`) onto the unified v2 `readiness_snapshots` snapshot — the same
one the dashboard gauge and Readiness Detail view already use. Section order (fixed, never re-ranked):
Header → Knowledge & Oral Readiness → Recommended Next Training Action → Strongest Demonstrated Areas →
Areas Needing Reinforcement → Insufficient or Limited Evidence → Flight Proficiency Not Yet Tracked →
Evidence Summary → Ground School Progress → ACS Knowledge Evidence → My Review Queue → AI Oral Practice
→ Areas to Address. Empty sections are omitted entirely, never rendered blank.

## Instructor Usefulness

The report distinguishes four things a CFI actually needs to see separately: demonstrated strength
(Strongest Demonstrated Areas — real score *and* sufficient evidence), demonstrated weakness (Areas
Needing Reinforcement — real negative signal, independent of how much evidence exists), uncertainty
(Insufficient or Limited Evidence — explicitly framed as "not enough data," never a performance
judgment), and out-of-scope (Flight Proficiency Not Yet Tracked — a permanent, static disclosure that
Apex doesn't yet digitally assess flight maneuvers). No vanity metrics: every number in Evidence
Summary/Ground School Progress/ACS Knowledge Evidence is drawn from durable, verifiable state
(`readiness_snapshots`, `review_outcome_submissions`, `module_quiz_attempts`, `guided_notes` ratings) —
never "questions viewed" or "time on page." Print output was verified to page-break cleanly per
section and hide interactive controls (see Print/Mobile QA).

## Readiness Migration

`trainingReportPerformanceLabel(cat)` answers "how did the student do" using only the snapshot's own
`score`/`weak_task_count` plus due Review Queue items — `evidence_level` (how much evidence exists) is
never used to decide "Needs Reinforcement." `bucketTrainingReportCategories()` implements the three-way
split: **Strongest** requires `performanceLabel === 'strong'` AND `evidence_level` in
`{developing, strong}` (a 100%-from-one-attempt category, `evidence_level: 'limited'`, can never appear
here); **Reinforcement** is `performanceLabel === 'needs_reinforcement'` regardless of evidence
sufficiency; **Insufficient/Limited** catches everything else with `evidence_level` `none`/`limited`
(a 92%-score, limited-evidence category lands here, not in Strongest). Categories with solid-but-
unremarkable standing appear in none of the three lists by design.

`compute_readiness_snapshot()` (v131) now emits exact `assessable_task_count`/`evidenced_task_count`/
`strong_task_count` per `category_breakdown` entry (the same integers the pre-existing
`task_breadth_pct` subquery already computed internally, just also returned raw) — the report's "N of
19 assessable tasks have evidence" statement sums these across all `category_breakdown` entries
client-side, never reverse-engineered from the rounded percentage. `algorithm_version` stays `'v2'`
(additive field change, not a scoring-formula change).

**Fallback behavior, confirmed**: `renderTrainingReport()` always tries to resolve a current
(`algorithm_version === 'v2'`) snapshot first (cached `latestReadinessSnapshot`, then `'latest'`, then
`'refresh'`). If Checkride Prep isn't unlocked, or no v2 snapshot is obtainable even after a refresh
attempt, it renders `renderLegacyTrainingReport()` — the original, unmodified pre-Sprint-4 presentation
— in full. The two are never mixed: a v1 coverage score is never shown next to v2-style category
sections.

## Ground School Mapping Expansion

`portal/supabase-portal-schema-v133-ground-school-acs-mapping-expansion.sql` adds 449
`content_acs_mappings` rows across PPL-M03, M04, M07, M08, M09, M10, M11, M12, M13, M14, M15, M17 (on
top of Sprint 3's 5 PPL-M01 rows). Full per-row detail, every intentional exclusion, and the 7
intentionally-unmapped modules (with reasons) are in `GROUND_SCHOOL_ACS_MAPPING_GAP_REPORT.md`.

Per-module summary (also in the gap report):

| Module | Category / Task(s) | Rows added |
|---|---|---|
| PPL-M03 Aircraft Systems | aircraft-systems (I.G) | 31 |
| PPL-M04 FARs Simplified | eligibility (I.A), airworthiness (I.B), crosscountry (I.D), airspace (I.E), aeromedical (I.H) | 22 |
| PPL-M07 Sectional Charts | airspace (I.E), crosscountry (VI.A, VI.B) | 30 |
| PPL-M08 Pilotage & Dead Reckoning | crosscountry (VI.A) | 39 |
| PPL-M09 Navigation Systems | crosscountry (VI.B) | 39 |
| PPL-M10 Weather Theory | weather (I.C) | 42 |
| PPL-M11 Weather Products | weather (I.C) | 50 |
| PPL-M12 Weather Decision Making | weather (I.C), `knowledge, risk management` | 26 |
| PPL-M13 Weight & Balance | performance (I.F) | 43 |
| PPL-M14 Aircraft Performance | performance (I.F) | 43 |
| PPL-M15 Cross-Country Planning | crosscountry (I.D) | 41 |
| PPL-M17 Human Factors | aeromedical (I.H) | 32 |

A key correctness finding from reading `wireModuleQuizSection()` directly: it only ever submits
`question_type === 'multiple_choice'` questions to `record_ground_school_evidence()` — `short_answer`/
`scenario` quiz questions are never sent to the evidence RPC at all. Every `module_quiz_question` row
in v133 is therefore multiple-choice, verified by an anti-join against `module_quiz_questions`
post-migration (zero mismatches). `checkride_corner`/`scenario_workshop` run on the self-rating
pathway and have no such constraint.

Generic ADM-framework name recall (SHELL, Swiss Cheese, PAVE, 5P, DECIDE, CARE, Apex's own Silent Six),
general right-of-way/minimum-safe-altitude items with no clean task fit, and open-ended "defend a
decision you'd make differently" items are left unmapped throughout, even inside otherwise-mapped
modules. No ACS task was flipped to `digital_assessment_supported = true` — every row attaches to one
of the 19 tasks already in scope.

## ACS Coverage Gap

8 of the 9 real `dpe_category` values now have Ground School content evidence; `emergency` remains
uncovered (Apex's Emergency Operations tasks are inherently flight-maneuver tasks — no Ground School
module's content genuinely tests them as knowledge). No scope-expansion candidate emerged from reading
the unmapped modules' content (see Known Limitations / Sprint 5 Recommendation).

## Evidence Flow

Content → ACS task (`content_acs_mappings`) → evidence (`task_evidence`, via
`record_ground_school_evidence()`, unchanged this sprint) → readiness (`compute_readiness_snapshot()`,
v131's additive exact-count fields) → Today at Apex gauge / Readiness Detail / Training Report (all
three now read the same `readiness_snapshots` row via `applyReadinessSnapshot()`/`latestReadinessSnapshot`).

## Review Idempotency

(Implemented and live-tested earlier in this engagement — `portal/supabase-portal-schema-v132-review-
outcome-idempotency.sql`, `site/portal-stable.js` commits `572c034`/`ea884db`.) A client-generated UUID
v4 key is assigned lazily to `reviewSessionState.items[index].submissionKey` the first time that index
renders and never regenerated by a retry or in-place DOM update. `record_review_outcome(p_review_item_id,
p_outcome, p_idempotency_key)` claims the key via `insert ... on conflict (idempotency_key) do nothing`
before touching any counter; a duplicate claim replays the stored `jsonb` result (`was_replay: true`)
after re-checking `profile_id = auth.uid()`, rather than redoing the increment/evidence-write. Client
gates all side effects (tally, `review_item_completed` analytics, `triggerReadinessRefresh()`) behind
`item.processed`. Live-tested: owner success, exact-key replay (zero counter movement), new-key new
increment, cross-profile denial (both first-time and replay paths), anon denial — full cleanup.

## Readiness Refresh Policy

(Implemented earlier this engagement — `site/portal-stable.js` commit `ea884db`.) A coalescing
coordinator (`triggerReadinessRefresh()`/`runReadinessRefresh()`, `READINESS_REFRESH_COOLDOWN_MS =
10000`) — not a lossy throttle: a trigger arriving while a request is in flight or within the cooldown
sets `dirty = true` rather than being dropped, guaranteeing exactly one trailing refresh with the
latest state. Wired after Practice completion, after the module-quiz per-question evidence batch
settles (`Promise.allSettled`, not a bare unawaited `.forEach()`), after a successful (non-replayed)
Review Session outcome, and after AI DPE debrief rendering (verified via direct read of
`dpe-chat/index.ts` that the session row commits server-side strictly before the response is returned).

## Privacy

Manually confirmed no report section reads `guided_notes.response_text` from anything but the exact
structural `-rating` prompt convention (`prompt_id like '%-rating' and response_text in ('confident',
'needs_review', 'not_yet')`) — Guided Notes prose, Scenario Workshop narrative responses, and Checkride
Corner written answers are never read by the Training Report. Ground School Progress reports counts and
a most-recent-module label only, never any free text.

## Database

New in this sprint: `review_outcome_submissions` (v132, prior commit), three additive fields on
`compute_readiness_snapshot()`'s `category_breakdown` output (v131, prior commit), 449
`content_acs_mappings` rows (v133, this session). No new tables from this session's own work; no RLS
policy changes.

## Security

`review_outcome_submissions`: RLS select-own-row only, no client write policy (writes only via the
`SECURITY DEFINER` function), `search_path = public`, `revoke ... from public, anon`. Every new Training
Report data source is either the cached snapshot (already fetched through the existing, already-tested
`mobile-readiness` Edge Function) or a plain `.select()`/count query against tables already RLS-scoped
to the caller's own `profile_id` (`guided_notes`, `module_quiz_attempts`, `review_outcome_submissions`)
— no new report-facing RPC was introduced. `content_acs_mappings` writes only via the migration itself
(service-role); the table's existing RLS/grants are unchanged.

## Performance

`EXPLAIN`'d all three new Training Report aggregate queries against production: `guided_notes` ratings
query uses `guided_notes_profile_module_idx` (bitmap index scan, cost ~3.4); `module_quiz_attempts`
most-recent-module query uses `module_quiz_attempts_profile_module_idx` (cost ~3.4); `review_outcome_
submissions` count uses `idx_review_outcome_submissions_profile` (cost ~4.5). All three are cheap,
index-backed, single-profile-scoped queries — no sequential scans. The Training Report never issues a
per-category or per-task query; the exact-count fields are summed client-side from the single snapshot
payload already fetched.

## Analytics

Added `training_report_viewed` (fires once per overlay open), `training_report_printed` (Print button),
`training_report_priority_clicked` (once per routed "Areas to Address" row action) to
`site/analytics-events.js`'s `EVENT_ALLOWLIST`. No new event tracks note/reflection/question/transcript
content.

## Print/Mobile QA

Verified via a static Playwright harness against the real `site/styles.css` + `site/portal.css`: zero
horizontal overflow at 375/390/414/1280px (one real bug caught and fixed in the process — a
`.portal-report__action-btn` inheriting `.btn`'s `white-space: nowrap` plus an added `flex-shrink: 0`
prevented a long action-button label from wrapping, overflowing by 8px at 375px; fixed by removing the
forced `flex-shrink: 0` and setting `white-space: normal` on the button). Print emulation confirmed:
sections page-break-avoid individually, action buttons are hidden (`.portal-report__action-btn { display:
none }` in `@media print`, since they aren't actionable on paper), status is always paired with text
(never color-only), and the existing `.portal-report-toolbar { display: none }` print rule still holds.
Added a `@media (max-width: 640px)` override for `.portal-report-panel` mirroring the existing
`.portal-practice-panel` pattern.

## Regression

`node --check` clean on `site/portal-stable.js` and `site/analytics-events.js`. `npx tsc --noEmit
--strict shared/mobile-dto/index.ts` clean. `mobile-expo`'s `ReadinessCard.test.tsx` (5 tests) re-run
and passing — confirms the v131 DTO field additions are non-breaking for mobile. No other web surface
(Today at Apex, Readiness Detail, Practice, Review Queue, Digital Workbook, Ground School, AI DPE,
QOTD, onboarding, entitlements) was touched by this sprint's code changes; all Ground School evidence
changes are pure additive data (`content_acs_mappings` rows), verified duplicate-safe
(`on conflict ... do nothing`) and orphan-free.

## Known Limitations

- `emergency` category has zero Ground School content evidence — inherent to the category being
  flight-maneuver-only among Apex's digitally-assessable tasks, not a coverage gap to close later.
- The Training Report's "one relevant incomplete Ground School module" pick in Areas to Address is
  based on recorded activity (rating or quiz attempt), not a true lesson-completion flag — Apex has no
  separate "module completed" state today.
- `adm` (Aeronautical Decision-Making) has no standalone ACS task among the 19 scoped tasks, so no
  Ground School content — including all of PPL-M16 — can ever surface in the Training Report's
  category sections, even though ADM is taught extensively.

## Sprint 5 Recommendation (not implemented)

- Consider a lightweight per-module "completed" flag (distinct from quiz/rating activity) to make
  Areas to Address's Ground School pick and the Ground School Progress section more precise.
- No clear candidate emerged this sprint for a new digitally-assessable ACS task; a future sprint
  could revisit `adm` and `emergency` specifically if Apex ever adds a structured decision-making
  assessment or simulator-adjacent content that could support them.
- The Training Report's "Areas to Address" restatement currently duplicates a fixed structural order;
  if instructor feedback wants a different ordering (e.g., checkride proximity-weighted), that should
  go through `computeTrainingPlan()`'s own logic, not a second formula in the report.
