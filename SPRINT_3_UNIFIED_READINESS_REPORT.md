# Sprint 3 — Unified ACS Evidence + Actionable Readiness

## Audit Findings (Phase 1)

**Web, before this sprint:** `computeReadiness()` (`site/portal-stable.js:3173`) was a client-side-only formula — `0.30·questionCoverage + 0.20·scenarioCoverage + 0.25·avgCategoryCoverage + 0.15·streakRatio + 0.10·studyTimeRatio` — where every coverage term meant "% marked studied," never correctness. `weakestCategory()`/`categoryPct()` used the same coverage-only metric. `ACS_TRACKER` was a hardcoded, cosmetic 4-group/11-category display mapping used only by `renderAcsCoverage()`, not read by readiness/weakest-category/Training Plan at all. Three separate readiness-adjacent systems coexisted on web with no shared model: this coverage gauge, the pre-signup Readiness Assessment quiz, and the post-signup Readiness Plan routing card — none ever referenced `task_evidence`/`acs_tasks`/`readiness_snapshots`.

**Mobile, live since Sprint 0:** a real task-level pipeline — `acs_versions`/`acs_tasks` (61 real FAA-S-ACS-6C Private Pilot tasks), `content_acs_mappings` (content → task, only `dpe_question` content ever mapped before this sprint, via deterministic regex backfill of `dpe_questions.acs_reference`), `task_evidence` (one row per profile × task, cumulative attempt/correct counts + a small-sample-dampened `evidence_score`), `record_task_evidence()` (the sole writer, `service_role`-only, called only by `complete_mobile_practice_session()`), and `compute_readiness_snapshot()` (self-scoped via `auth.uid()`, versioned via `algorithm_version`, writing immutable `readiness_snapshots` rows). Mobile's `ReadinessCard.tsx` showed only the overall score, an evidence-level badge, and plain-English reason codes — no category breakdown existed on either platform.

**Ground School / AI DPE:** completely unmapped. No `module_quiz_questions.id`, Checkride Corner id, or Scenario Workshop prompt had ever appeared in `content_acs_mappings`. `dpe-chat` (AI DPE) only ever produced verdicts scoped to `dpe_categories`, never `acs_tasks`. Sprint 2's own `portal_review_items.acs_category` was a third, disconnected vocabulary. No bridge existed between the FAA's 61-task structure and Apex's 11-key `dpe_categories` product taxonomy.

**Two bugs found in the live `v1` engine by direct code reading** (not assumed): an INNER JOIN in `knowledge_score`/`risk_management_score` silently excluded any scoped task with zero `task_evidence` rows from the average instead of counting it as zero; and the readiness denominator scored all 61 applicable tasks, including ~42 hands-on flight-maneuver tasks (takeoffs, landings, stalls, instrument maneuvers, postflight) that Apex has no digital way to observe at all — conflating missing product coverage with poor student performance.

**Answering the audit's five questions:** the mobile pipeline is the most authoritative model and the correct shared foundation; web now reads the same `readiness_snapshots` via the same `mobile-readiness` Edge Function mobile already uses; `computeReadiness()`'s blended score is demoted to an offline/no-snapshot-yet fallback (kept, not deleted); `ACS_TRACKER` and the pre-signup Readiness Assessment/Readiness Plan routing card are architecturally unrelated and untouched; `dpe_categories` stays the student-facing display vocabulary, with `acs_tasks`/`task_evidence` as the underlying evidence engine.

## Unified Architecture

```
Training activity (Practice, module quiz, Checkride Corner/Scenario
Workshop rating, Review Queue outcome)
        │
        ▼
record_task_evidence_internal()  ← one evidence writer, all sources
        │
        ▼
task_evidence  (profile × acs_task: attempt/correct counts,
                review counts, self_confidence, evidence_score)
        │
        ▼
compute_readiness_snapshot() v2 — scoped to digitally-assessable tasks,
        joins task_evidence → acs_tasks.dpe_category for category rollup
        ▼
readiness_snapshots  (overall_score, evidence_level, reason_codes,
                       category_breakdown, algorithm_version = 'v2')
        │
        ├──► mobile ReadinessCard (unchanged)
        ├──► web dashboard gauge + Readiness Detail view (new)
        └──► computeTrainingPlan()  (weakest-evidence category feeds the
              existing priority chain, falling back to the old
              coverage-based signal when no snapshot exists)
```

The ACS-task → display-category bridge lives on `acs_tasks.dpe_category`, never on `content_acs_mappings` — that table can have many rows pointing at one task, while `task_evidence` is already aggregated to one row per (profile, task); joining the aggregate back through `content_acs_mappings` would double-count a task's evidence in every category any of its mapped content items happens to carry.

## ACS Mapping (Part A)

Two new columns on `acs_tasks` (v126), never on `content_acs_mappings`:

- **`dpe_category`** — one canonical Apex display category per task, hand-curated against the real 61-task list, reusing `ACS_TRACKER`'s own already-vetted Area-I grouping as the base.
- **`digital_assessment_supported`** — a separate signal (not inferred from `dpe_category`) marking exactly which tasks Apex can currently observe at all through oral-exam-style content.

**19 of 61 tasks mapped and assessable:** Area I (Preflight Preparation) tasks A–H (8 of 9 — eligibility, airworthiness, weather, cross-country, airspace, performance, aircraft-systems, aeromedical; the seaplane-only I.I is left unmapped); Area VI (Navigation) A–D, all 4 → cross-country; Area IX (Emergency Operations) A–G, all 7 → emergency. The other 42 tasks (Areas II, III, IV, V, VII, VIII, X, XI, XII) are hands-on flight-maneuver/procedural areas Apex has no digital observation mechanism for, and are intentionally left unmapped and unscored — not guessed at. `privileges` and `adm` end up with zero mapped tasks, an honest structural gap: the FAA bundles "privileges and limitations" into the same Task A as "qualifications," and ADM is a cross-cutting Special Emphasis Area with no discrete Task of its own.

`content_acs_mappings` gained its first non-`dpe_question` rows this sprint: 3 `module_quiz_question` and 2 `checkride_corner` rows for PPL-M01 (the only fully-authored Ground School module), each verified by reading the actual question text against a real ACS task element rather than guessed from an id. Process/administrative questions (exam structure, Part 61 vs. 141) were deliberately left unmapped rather than force-fit to inflate coverage — including PPL-M01's entire Scenario Workshop, whose one scenario is a training-pathway decision, not a testable ACS element.

## Evidence Model (Part B)

`task_evidence` gained `review_attempt_count`/`review_correct_count` (review outcomes, tracked separately from objective accuracy) and `self_confidence`/`confidence_updated_at` (latest self-rating). A new `task_evidence_sources` table is an idempotency ledger (same pattern as `xp_ledger`) keyed on `(profile_id, acs_task_id, source_type, source_id)`, so a retried write is a true no-op rather than a double-count.

`record_task_evidence_internal()` is the new full evidence writer; the original 4-argument `record_task_evidence()` becomes a thin wrapper preserving its exact signature and grants, so `complete_mobile_practice_session()` needed zero changes. It branches on whether `p_correct` is null:

- **Objective evidence** (Practice, module quiz correctness) increments `attempt_count`/`correct_count` exactly as before.
- **Confidence-only evidence** (Checkride Corner/Scenario Workshop ratings, and — after reading Sprint 2's own Review Session code directly — *every* Review outcome, since Review never re-grades an answer objectively for any source type) never touches `attempt_count`/`correct_count` at all. `confidence_alignment` is derived only when both a self-rating and real objective accuracy exist for the same task: `1 − |self_confidence − (correct_count/attempt_count)|` — a calibration measure, not a raw rating pass-through, matching what the column was always intended to mean per `v113`/`v114`'s own comments.
- Review's bonus to `evidence_score` is bounded: `+0.15 × least(1, 0.03 × max(0, review_correct_count − 1))` (the first successful review adds nothing — a task can't jump to "mastered" from one review — capped at +0.15).

`record_ground_school_evidence()` is the new authenticated, ownership-checked RPC Ground School content calls; `record_review_outcome()` was extended to also feed evidence for `dpe_question`-sourced review items, using the item's own server-computed post-increment `review_count` as a durable idempotency key.

AI DPE contributes **no task-level evidence at all** — a weak verdict in a domain proves the AI judged that domain weak, not that every ACS task the domain touches is weak. Instead, `compute_readiness_snapshot()` checks only the member's latest completed session (30-day hard cutoff, no decay curve) and adds a plain `recent_ai_dpe_weak` reason code to the matching category, reusing the exact 11-value exact-match domain→category table already built in Sprint 2.

## Evidence Sufficiency

Per category, two dimensions are computed — `attempt_volume` (sum of `attempt_count` across the category's assessable tasks) and `task_breadth_pct` (% of those tasks with ≥1 attempt) — and combined:

| | breadth < 40% | breadth 40–79% | breadth ≥ 80% |
|---|---|---|---|
| **volume 0** | None | — | — |
| **volume 1–9** | Limited | Limited | Developing |
| **volume 10–39** | Limited | Developing | Developing |
| **volume ≥ 40** | Developing | Developing | Strong |

This prevents "40 attempts on 1 of 8 tasks" from reading identically to "40 attempts spread across 7 of 8 tasks." A category's `score` is `null` whenever its level is `None` — never a fabricated 0%. This is the field genuinely responsible for the brief's "2 correct Weather answers ≠ equally validated" concern: a student with 2 attempts on 1 task reads as `Limited`, not `Strong`, regardless of how those 2 attempts scored.

## Readiness Calculation

**Plain English:** Apex Advantage's Readiness score answers "how well can I currently evaluate this student's oral-exam knowledge, Ground School understanding, and review performance?" — not "will they pass their checkride." It is built entirely from real recorded evidence: correct/incorrect answers, self-rated confidence checked against later performance, and successful spaced reviews. It only scores the ~19 of 61 real FAA tasks Apex can currently observe through this kind of content; the other 42 (hands-on flight maneuvers) are never counted for or against a student, because Apex has no way to watch a takeoff or a stall recovery today.

**Technical:** `compute_readiness_snapshot()` v2, self-scoped via `auth.uid()`, computes over `get_readiness_scoped_acs_tasks(profile)` (the applicable ∩ digitally-assessable set):

- `coverage_score` = % of scoped tasks with ≥1 attempt.
- `knowledge_score` = avg(`evidence_score`) across scoped tasks, LEFT JOINed to `task_evidence` (a missing row counts as 0 — the v1 bug fix).
- `risk_management_score` = same average restricted to `risk_management`-tagged mappings, falling back to `knowledge_score` when none exist (true today).
- `confidence_score` = avg(`confidence_alignment`) where non-null, defaulting to a neutral 50 with a `confidence_calibration_not_yet_available` reason code.
- `overall_score = round(0.35·coverage + 0.30·knowledge + 0.20·risk + 0.15·confidence)`.
- A 24-hour/±15-point single-session swing dampener, unchanged from v1, compared only against the most recent same-`algorithm_version` snapshot.

`category_breakdown` groups the same scoped tasks by `acs_tasks.dpe_category`, each entry carrying `{category, label, score, evidence_level, attempt_volume, task_breadth_pct, weak_task_count, last_demonstrated_at, ai_dpe_reason_code}`. `privileges`/`adm` never appear — no scoped task carries either value, a structural consequence of the mapping, not an explicit exclusion.

## Model Version

The top-level `evidence_level` column deliberately keeps v1's exact 3-value vocabulary (`low`/`moderate`/`high`) forever — verified directly against `ReadinessCard.tsx`'s `EVIDENCE_LABEL`, a TypeScript `Record` keyed on exactly those three strings; any other value would render `undefined` and crash. The richer 4-value sufficiency label (`none`/`limited`/`developing`/`strong`) lives only inside `category_breakdown`, a field mobile's screen doesn't read. All new snapshots are inserted with `algorithm_version = 'v2'`; historical `'v1'` rows are never rewritten, and the swing dampener and delta-explanation logic only ever compare two rows of the *same* version, so a v1→v2 transition is never presented as a week of student progress or regression.

## Migration / Backfill

A migration (v128) backfilled real historical evidence for the newly-mapped PPL-M01 content, calling `record_task_evidence_internal()` the same way a live student action would — always with a real `source_type`/`source_id`, so it is provably safe to re-run. It does **not** backfill any `portal_practice_attempts` row predating Sprint 2's per-question response tracking (aggregate score/total only, no question ids) — that evidence cannot be reliably recreated, and those students correctly show "Insufficient Evidence" rather than an inflated history. Applied against production, the backfill was a genuine no-op: no real students have used PPL-M01's quiz/Checkride Corner features yet.

## Student Experience — worked example

A student answers 4 Area-I-Task-A (`eligibility`) questions correctly 3 times, no other activity. Their snapshot: `overall_score` ≈ 11 (low coverage — 1 of ~16–19 scoped tasks touched), `evidence_level: 'low'` (4 total attempts), reason codes `['confidence_calibration_not_yet_available', 'low_sample_size', 'insufficient_content_coverage']` (10 of the 19 assessable tasks have no Apex content mapped to them yet — a real, honestly-reported product gap). Their Readiness Detail shows `Eligibility & Documents: 60%, Developing` (4 attempts, 100% breadth of its one mapped task) and every other assessable category as `Insufficient Evidence` with a routed action — never a fabricated score. This is precisely the "2 correct Weather answers should not look equally validated" scenario the brief opened with: the student's one well-attempted category reads as `Developing`, not `Strong`, and every untouched category is honestly labeled, not silently defaulted to 0% or 100%.

## Actionable Readiness (Part D)

A new "View Details" affordance on the dashboard gauge opens a Readiness Detail view (reusing the existing `#practiceOverlay` modal shell, the same one Review Session and Checkride Mode already use). It shows the overall score under a "Knowledge & Oral Readiness" eyebrow, a plain-language scope caption, a real week-over-week delta only when two same-`algorithm_version` snapshots exist within 7 days, and one expandable card per category (evidence-sufficiency label, plain-English evidence counts, last-demonstrated date, AI DPE reason code when present, and one routed action button). No scoring coefficients are ever exposed. Status is always a text label, never color alone; category toggles are real focusable `<button>`s with `aria-expanded` for keyboard access.

## Training Plan Priority (Part E/F)

Every category's action button routes through existing systems, never a new recommendation engine: due Review Queue items for that category first, then an incomplete mapped Ground School module (today, only `eligibility` → PPL-M01), then today's QOTD if it matches, else the DPE Library filtered to that category. `computeTrainingPlan()` keeps its exact Sprint 1/2 priority chain shape and stays fully synchronous; a new `snapshotWeakestCategory()` prefers the cached v2 snapshot's least-evidenced category (ranked by sufficiency first, score as tiebreak) and falls back to the old coverage-based `weakestCategory()` whenever no snapshot has loaded yet, the RPC failed, or nothing evidence-based is left to flag. Review Queue's existing supersede-the-generic-task logic is untouched and still fires ahead of this distinction.

## Web/Mobile Convergence (Part H)

`computeReadiness()`'s blended score is demoted to fallback-only (documented directly above its own definition) — kept, unmodified, for the rare no-snapshot-yet case, and still used by Achievements, Training Report, and the Readiness Plan routing card, none of which changed this sprint. Web now calls the same `mobile-readiness` Edge Function mobile already uses (same JWT auth model as `get-module-companion-content`), which was extended to also return `category_breakdown` — additive, and verified unused by mobile's `ReadinessCard.tsx` (its full 5-test suite still passes unchanged). `shared/mobile-dto/index.ts` gained an optional `category_breakdown` field and `ReadinessCategoryBreakdown`/`ReadinessEvidenceLevel` types documenting the real wire contract, following the same "agreed shape, not yet wired to a screen" precedent as the existing `MobileAcsTaskInfo` DTO — `tsc --noEmit --strict` is clean.

## Training Report (Part G)

Deferred, as explicitly permitted. `computeTrainingReportData()` still reads `computeReadiness()`/`categoryPct()` directly — swapping it onto the unified snapshot is mechanical (point it at the same snapshot the Readiness Detail view uses, add an "Evidence Sufficiency" line per category) but is real print-friendly design work on top of an already large sprint. Not built this sprint.

## Database

New migrations, applied to production in order: **v126** (`acs_tasks.dpe_category`/`digital_assessment_supported`, `get_readiness_scoped_acs_tasks()`, the 19-task mapping, first `content_acs_mappings` rows for Ground School content), **v127** (`task_evidence` new columns, `task_evidence_sources` ledger, `record_task_evidence_internal()`, `record_ground_school_evidence()`, `record_review_outcome()` extension), **v128** (idempotent historical backfill), **v129** (`compute_readiness_snapshot()` v2, `readiness_snapshots.category_breakdown`), **v130** (covering indexes + RLS policy performance fix on this sprint's own new objects).

## Security

Every new/changed RPC was live-tested against production: `record_ground_school_evidence` and `compute_readiness_snapshot` both reject anon at the grant level (`permission denied for function`, never reaching the function body) and reject cross-profile access from an authenticated session (`record_ground_school_evidence` raises `Not authorized to record evidence for this profile`; `compute_readiness_snapshot` is structurally immune — it takes zero arguments and resolves everything from `auth.uid()`). `record_task_evidence`/`record_task_evidence_internal` remain `service_role`-only, confirmed via `information_schema.routine_privileges` — no client ever calls them directly. `get_advisors('security')` shows no RLS gaps on any new table; every "callable by authenticated as SECURITY DEFINER" notice is the expected, reviewed flag for a self-scoped or ownership-checked RPC, the same pattern every pre-existing RPC of this kind already carries.

## Performance

The category-breakdown grouping query inside `compute_readiness_snapshot()` was `EXPLAIN ANALYZE`'d against production: ~3.4ms, using the existing `task_evidence` composite primary key (no new index needed for that join). Two real, in-scope findings from `get_advisors('performance')` — missing covering indexes on this sprint's two new foreign keys, and one new RLS policy calling `auth.uid()` directly instead of `(select auth.uid())` — were fixed in v130. Pre-existing gaps on `task_evidence`/`readiness_snapshots` (present since v113/v114) were left alone as out of scope. The dashboard gauge makes one cached `mobile-readiness` `latest` call; the Readiness Detail view reuses that same cached snapshot when already loaded, only calling `refresh` if none exists yet.

## Analytics

Added `readiness_detail_viewed`, `readiness_category_opened` (category, evidence_level), and `readiness_action_clicked` (category, action_type) to `EVENT_ALLOWLIST`, following the existing dedup-check precedent. `compute_readiness_snapshot()` itself never emits analytics — only the UI view/click points do, and never with question/response/AI DPE transcript text.

## Testing

Live production role-simulation (owner, cross-profile, anon) for `record_ground_school_evidence`, `record_review_outcome`, `record_task_evidence_internal`, and `compute_readiness_snapshot`, each followed by full cleanup back to baseline. `node --check` on every JS change. `tsc --noEmit --strict` on the updated shared DTO file. The full pre-existing `ReadinessCard.test.tsx` suite (5 tests) re-run and passing unchanged, confirming mobile is genuinely unaffected. `EXPLAIN ANALYZE` on the new grouping query.

## Manual QA

A headless-browser pass confirmed the new dashboard gauge elements (View Details button, caption, evidence badge) render with no horizontal overflow at 375px and 1280px. A hand-built static harness reproducing the Readiness Detail view's exact markup, populated with realistic mixed-evidence category data, was screenshotted at 375/390/414/1280px with zero overflow at any width and a clean visual pass (Apex navy/gold, text-first status labels, no color-only signaling).

**Known limitation, explicitly not fully covered:** the full authenticated click-through of the live Readiness Detail view (real snapshot data flowing through `mobile-readiness`, category action routing actually opening Review Session/Ground School/QOTD/DPE Library) requires a live Supabase session in a real browser against production, which this sandboxed environment cannot exercise. Live production role-simulation covered the RPC layer directly instead. A full regression pass across Today at Apex, Recent Training, QOTD, Practice, Review Queue, Digital Workbook, Ground School, AI DPE, onboarding, Training Consistency, and entitlement behavior was not re-run this sprint beyond the mobile Jest suite and the targeted syntax/type checks above, since none of those surfaces' own code changed — only `computeTrainingPlan()`'s weakest-category *input* changed, behind a fallback that preserves the exact old behavior whenever no snapshot is cached.

## Known Limitations

- `record_review_outcome()` is not protected against a raw network-level retry of one logical button click, which would increment `review_count` twice server-side before the evidence layer sees it — a client-supplied idempotency key would need a larger change to Sprint 2's review flow than this sprint's evidence-model work justified.
- 10 of the 19 digitally-assessable tasks (all of Area IX B–G, all of Area VI) currently have zero mapped content at all — flagged honestly via `insufficient_content_coverage`, but there is no Ground School or DPE-question content pointed at them yet.
- The 42 hands-on flight-maneuver tasks have no task-level UI and no evidence path at all this sprint — `digital_assessment_supported` is exactly the field a future flight-evidence/instructor integration would key its "not yet tracked" state on.
- Training Report still reads the deprecated `computeReadiness()`/`categoryPct()` directly (Part G, deferred).
- Full authenticated browser QA of the Readiness Detail view (see Manual QA above).

## Sprint 4 Recommendation (not implemented)

1. Point `computeTrainingReportData()` at the unified snapshot and add an "Evidence Sufficiency" section per category (Part G's deferred work).
2. Author real Ground School content for modules 2–20 and extend the `content_acs_mappings` pattern already built this sprint to them — the mapping mechanism is generic; only the actual content is missing.
3. Consider a lightweight client-supplied idempotency key for `record_review_outcome()` to close the retry gap noted above.
4. A future mobile sprint could wire `category_breakdown` (already returned, already typed) into a native per-category Readiness screen with zero further backend change.
5. Map more of the 42 hands-on ACS tasks once a flight-evidence or instructor-logged-training-time integration exists — `digital_assessment_supported` is the field to flip once real observation is possible.
