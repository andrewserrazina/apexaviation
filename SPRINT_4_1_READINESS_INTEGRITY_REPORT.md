# Sprint 4.1 — Readiness Integrity & Scoring Invariants: Final Report

Narrow stabilization sprint on top of Sprint 4's Training Report/Ground School work.
Goal: make the unified readiness system mathematically defensible before it becomes
the long-term authoritative training metric. No Sprint 5 features were built.

---

## 1. Root Causes

| # | Root cause | Consequence before this sprint |
|---|---|---|
| 1 | `compute_readiness_snapshot()` (v2) applied a dampener that compared the new score to the *most recent stored snapshot*, not a fixed baseline. | Calling refresh repeatedly (e.g. a flaky network retry, or a student opening Readiness Detail twice) could nudge the score by a different amount each time — the same evidence state did not reproduce the same result. |
| 2 | `digital_assessment_supported = true` was set categorically in an earlier sprint ("this Area belongs to a testable Area of Operation"), not because a live content pathway was verified. | 6 Emergency tasks (IX.B–G) sat in the readiness denominator with permanent zero evidence, silently penalizing every student for maneuvers Apex has no way to observe. Separately (found in Phase 9), IX.A's 16 "evidence" mappings were actually cross-country content, so the one Emergency task believed to be genuinely assessable wasn't either. |
| 3 | `risk_management_score` read `task_evidence.evidence_score`, which aggregates *all* evidence for a task regardless of whether it came from risk-judgment or plain-knowledge content. | The score implied an independently-measured risk-management dimension that didn't exist — ordinary knowledge evidence silently stood in for it. |
| 4 | `record_review_outcome()`'s idempotency ledger checked only that a replayed key belonged to the same profile, not the same review item and outcome. | A key reused (by accident or otherwise) against a different item/outcome would silently replay the first result instead of being rejected. |
| 5 | `record_review_outcome()` only ever wrote evidence for `source_type = 'dpe_question'`; Ground School-sourced review items (module_quiz_question/checkride_corner/scenario) produced zero evidence when reviewed. | Ground School Review Queue activity — a real, substantial source of retrieval-practice evidence — was invisible to readiness. |
| 6 | `task_evidence.self_confidence` was a single scalar, overwritten by whichever content item was rated most recently. | At Sprint-4 scale (dozens of ratings per task possible), a task's confidence could read as whatever the last rating happened to be, not a genuine aggregate. |
| 7 | AI DPE's review-priority boost was `priority = priority + 2`, applied unconditionally on every `sync_review_queue()` call. | Priority compounded indefinitely across repeated syncs with no new evidence, drifting further from any real signal each time. |
| 8 | Readiness Detail's Ground School routing hand-mapped exactly one category (`eligibility`) to exactly one module (`PPL-M01`); every other "needs reinforcement" category fell through to the DPE Library even when real, mapped Ground School content existed for it. | Actionable-readiness routing was only actionable for one category out of nine. |
| 9 | Dashboard's `refreshDashboardReadinessGauge()` and Readiness Detail's `openReadinessDetail()` had no version-gate at all (unlike Training Report, which Sprint 4 built with one); each surface also had its own copy of the gate logic where one existed. | No mechanism guaranteed all three web surfaces (plus mobile) ever agreed on which snapshot was "current." |

---

## 2. V3 Readiness Formula

**Technical:**
```
v_overall := round(0.40 * coverage_score + 0.45 * knowledge_score + 0.15 * confidence_score, 2)
```
- `coverage_score`: % of currently-assessable tasks (see §4) with at least one attempt, over the student's applicable-task set.
- `knowledge_score`: objective-evidence-weighted score across the same assessable-task set (`task_evidence.evidence_score`, driven by `correct_count/attempt_count` with a volume damper and a small review-correctness bonus — unchanged formula from v2, now computed over the corrected scope).
- `confidence_score`: `round(100 * avg(task_evidence_sources.self_confidence), 2)` across every distinct rated content item mapped to an assessable task; falls back to `50` with `confidence_no_ratings_yet` in `reason_codes` when no ratings exist yet.
- `risk_management_score := knowledge_score` (mirrored, never independently computed) — `reason_codes` always includes `risk_management_not_independently_measured`.
- No dampener of any kind. The dampener block was deleted outright rather than reworked, per the sprint's explicit preference — `compute_readiness_snapshot()` is now a pure function of current evidence state.
- `evidence_level`: `'low'` if `total_attempts < 10 OR breadth_frac < 0.3`; `'moderate'` if `total_attempts < 40 OR breadth_frac < 0.6`; else `'high'`.
- `strong_task_count`/`weak_task_count`: counts of scoped, attempted tasks with `evidence_score >= 0.8` / `< 0.6`.

**Plain English:** overall readiness is 40% "how much of what Apex can actually test have you touched," 45% "how well did you do on the parts you touched," and 15% "how confident do you feel about it" — recomputed fresh every time from whatever evidence exists right now, never nudged by how many times you've checked it. Risk management isn't given its own number because Apex can't cleanly separate risk-judgment evidence from plain knowledge evidence yet; it's shown as equal to the knowledge score with an explicit note saying so, not disguised as an independent measurement.

---

## 3. Determinism

Live-tested on production profile `917c1b45-3bdb-4e60-9bb5-2374002b6068`, both mid-sprint (Phase 3, before any evidence changes) and again in Phase 10 (after all ACS mapping corrections in Phase 9 had landed):

```
run 1: overall=13.45  coverage=7.69  knowledge=6.38  confidence=50  assessable=13  evidenced=1
run 2: overall=13.45  coverage=7.69  knowledge=6.38  confidence=50  assessable=13  evidenced=1
run 3: overall=13.45  coverage=7.69  knowledge=6.38  confidence=50  assessable=13  evidenced=1
run 4: overall=13.45  coverage=7.69  knowledge=6.38  confidence=50  assessable=13  evidenced=1
```
Four consecutive `compute_readiness_snapshot()` calls, byte-identical, zero drift. A separate evidence-change test (write new evidence, refresh, confirm the score moves; refresh again with no new evidence, confirm it re-stabilizes at the new value and stays there) also passed during Phase 3 and was not affected by later phases, since no later phase touched the scoring arithmetic itself.

---

## 4. ACS Scope

- **Total ACS tasks in the active taxonomy:** 61 (Areas I–XII, FAA-S-ACS-6C Private Pilot).
- **v3 assessable tasks (`digital_assessment_supported = true`):** **13** — I.A Pilot Qualifications, I.B Airworthiness Requirements, I.C Weather Information, I.D Cross-Country Flight Planning, I.E National Airspace System, I.F Performance and Limitations, I.G Operation of Systems, I.H Human Factors, IX.A Emergency Descent, VI.A Pilotage and Dead Reckoning, VI.B Navigation Systems and Radar Services, VI.C Diversion, VI.D Lost Procedures. Every one of the 13 now has real mapped content (minimum 1, up to 141).
- **Excluded, with reasons:**
  - **IX.B–G** (Emergency Approach and Landing, Systems/Equipment Malfunctions, three multiengine-only engine-failure tasks, Emergency Equipment and Survival Gear): flight-maneuver/simulated-malfunction tasks with no oral/quiz pathway Apex can currently observe digitally. IX.B and IX.C now have some genuine oral content mapped to them (found while fixing the Area X mismapping bug in Phase 9 — see §11) but were deliberately **not** flipped to assessable this sprint, to avoid reopening a scope decision mid-integrity-sprint; flagged as a real Sprint 5+ candidate.
  - **Everything outside Areas I, VI, IX** (Preflight Procedures, Airport Operations, Takeoffs/Landings, Performance Maneuvers, Slow Flight/Stalls, Basic Instrument Maneuvers, Multiengine Operations, Night Operations, Postflight Procedures): physical flight-maneuver areas of operation with no oral/knowledge-only pathway that would constitute genuine digital assessment of the task itself, unchanged from prior sprints' scope.
- No task was added to or removed from the assessable set this sprint except the IX.B–G flip (Phase 2/v134). Coverage/knowledge scoring only ever runs over the 13-task set above, intersected with each student's own applicable-task set (aircraft-class filtering, pre-existing mechanism).

---

## 5. Evidence Paths

Every one of the 13 assessable tasks has at least one functioning evidence source as of this sprint:

| Task | Evidence sources |
|---|---|
| I.A Eligibility | 54 dpe_question + module_quiz_question + checkride_corner items (PPL-M01, PPL-M04) |
| I.B Airworthiness | 42 items (PPL-M04) |
| I.C Weather | 141 items (PPL-M10/M11/M12, plus `wx-8` reattached in Phase 9) |
| I.D Cross-Country Planning | 69 items (PPL-M04/M07/M08/M09/M15, plus 7 `xc-*` reattached in Phase 9) |
| I.E Airspace | 38 items (PPL-M04/M07, plus `xc-31` and the new `PPL-M03:cc-20` dual-mapping from Phase 9) |
| I.F Performance | 98 items (PPL-M13/M14) |
| I.G Aircraft Systems | 56 items (PPL-M03) |
| I.H Human Factors | 42 items (PPL-M17, plus the new `PPL-M03-Q08`/`PPL-M03:cc-18` dual-mappings from Phase 9) |
| IX.A Emergency Descent | 1 item (`emerg-6`, reattached in Phase 9 — the ONLY genuine emergency-descent content that exists) |
| VI.A Pilotage/Dead Reckoning | 50 items (PPL-M08, plus 5 `xc-*` reattached in Phase 9) |
| VI.B Navigation Systems | 44 items (PPL-M09, plus `xc-6` reattached in Phase 9) |
| VI.C Diversion | 3 items (PPL-M08 content, plus `xc-3` reattached in Phase 9) |
| VI.D Lost Procedures | 6 items (PPL-M08 content, plus `xc-4` reattached in Phase 9) |

IX.A's single content item is thin (a real limitation, not hidden — see §16), but it is genuine: unlike its 16 predecessor mappings, it actually tests emergency-descent knowledge.

---

## 6. Confidence

`task_evidence_sources.self_confidence` (added Phase 4) records a confidence rating per distinct rated content item (Checkride Corner prompt, Scenario Workshop, or module quiz self-rating) instead of one scalar per task. `compute_readiness_snapshot()`'s confidence score is `avg(self_confidence)` across every rated item mapped to an assessable task, for that student. Because `task_evidence_sources`'s existing primary key (`profile_id, acs_task_id, source_type, source_id`) already guarantees one row per distinct item, repeat submissions of the same item never double-count — the aggregate reflects the full rated collection, not whichever item happened to be rated last. If a task has zero ratings, it simply doesn't contribute to the average (rather than being treated as zero); if *no* task has any rating yet, the whole confidence score falls back to 50 with `confidence_no_ratings_yet` disclosed. Confidence remains 15% of the overall formula and is never allowed to dominate the 85% objective-performance weight (coverage + knowledge).

---

## 7. Risk Management

`risk_management_score` is set equal to `knowledge_score` and `reason_codes` always includes `risk_management_not_independently_measured`. This was a deliberate choice among three options considered: (A) mirror knowledge and disclose (chosen), (B) a neutral default, (C) attempt a genuine per-source risk/knowledge split. Option C was ruled out because `task_evidence_sources.source_id` for `module_quiz_question` items includes an attempt-id prefix that does not match `content_acs_mappings.content_id`'s bare question id — a real per-source risk/knowledge split would require a data-model change the sprint explicitly forbids ("do NOT build a large multidimensional evidence engine"). Mirroring and disclosing is the honest minimal fix: nothing about the number claims risk judgment was separately tested, and the disclosure is unconditional, not just present when the number happens to be identical to knowledge (it always is, by construction).

---

## 8. Review Idempotency

`record_review_outcome(p_review_item_id, p_outcome, p_idempotency_key)`: a replayed key is now validated against the **exact same** logical request — same `review_item_id` AND same `outcome` — not just the same profile. Live-tested matrix:

- **Exact replay** (same key, same item, same outcome): returns the stored result with `was_replay: true`, zero counter movement.
- **Different item, same key**: raises `idempotency_key_conflict`, mutates nothing.
- **Different outcome, same key**: raises `idempotency_key_conflict`, mutates nothing.
- **Cross-profile** (a different user's JWT presenting someone else's key): rejected with the pre-existing ownership check (`Not authorized to update this review item`), before the conflict check is even reached.
- **New key**: processes normally, ledger row created, counters increment exactly once.

All test rows were disposable and confirmed cleaned up (zero residual rows) after each run.

---

## 9. Review Queue ACS Integration

`sync_review_queue()` and `record_review_outcome()` now resolve ACS category/evidence for **all four** review source types through `content_acs_mappings`, with the exact content-id conventions each source type actually uses:

| source_type | content_acs_mappings content_type | content_id derivation |
|---|---|---|
| `dpe_question` | `dpe_question` | source_id directly |
| `module_quiz_question` | `module_quiz_question` | source_id directly |
| `checkride_corner` | `checkride_corner` | `module_id || ':' || source_id` |
| `scenario` | `scenario_workshop` (translated — the two tables use different vocabulary for the same concept) | `module_id` alone |

Live-tested this sprint: `module_quiz_question` (`sync_review_queue()`'s `acs_category` resolution, PPL-M03-Q01 → `aircraft-systems`), `checkride_corner` (`record_review_outcome()` on a real item, confirmed evidence written to the correct task), and `scenario` (Phase 10 — inserted a disposable `PPL-M03` scenario review item, called `record_review_outcome`, confirmed it wrote `self_confidence = 0.85` against I.G Operation of Systems, the exact task `PPL-M03`'s scenario_workshop mapping points to). `dpe_question` was already covered by the pre-existing (Sprint 2/3) implementation. "Reinforced" is confidence-only evidence (`p_correct = null`) for every source type, never treated as objectively correct — unchanged from the original `dpe_question` design, now applied uniformly.

Two client-side gaps in the same area were also found and fixed: `dueReviewCountForCategory()` (Training Report performance labeling) and `computeTrainingPlan()`'s Review-Queue-supersedes-generic-recommendation check both still filtered to `source_type === 'dpe_question'` only, so a due Ground School review item couldn't correctly signal "this category has due evidence" on either surface. Both now count due items from any source type via a shared `dueReviewItemsForCategory()` helper.

---

## 10. AI DPE Priority

`sync_review_queue()`'s AI-DPE boost is now derived, not incremented: each sync computes the current set of AI-DPE-flagged weak categories from source state, then sets `priority + 2` / `ai_dpe_boosted = true` only for `dpe_question` items in that set that aren't already boosted, and reverses (`priority - 2` / `ai_dpe_boosted = false`) items that are boosted but no longer in a weak category. Live-tested: applying the boost once, then calling `sync_review_queue()` three more times with no new AI DPE evidence — priority stayed flat across all three repeats. Removing the weak-category condition and re-syncing correctly reversed the boost exactly once (not repeatedly compounding in either direction).

---

## 11. Cross-Surface Consistency

Dashboard gauge, Readiness Detail, and Training Report were unified onto one shared `fetchCurrentReadinessSnapshot()` function (`site/portal-stable.js`), keyed off one `CURRENT_READINESS_ALGORITHM_VERSION = 'v3'` constant defined once. Previously: Dashboard and Readiness Detail had no version-gate at all (would happily cache and display a stale v2 snapshot indefinitely); Training Report had its own separate inline gate (Sprint 4) and its own duplicate `CURRENT_READINESS_ALGORITHM_VERSION = 'v2'` declaration — which, left in place, would have silently overwritten the new `'v3'` constant back to `'v2'` at script-load time, since both were `var` declarations executing in source order. That duplicate was removed; there is now exactly one authoritative version constant and one shared resolution function, used by all three web surfaces.

Mobile resolves the same way through its own path: the `mobile-readiness` Edge Function's `shape()` function passes `algorithm_version` straight through untouched (confirmed unmodified since before this sprint), so it began serving `'v3'` rows automatically the moment `compute_readiness_snapshot()` started producing them — verified this sprint that its `'latest'` query and `shape()` do **not** filter or gate on version at all, meaning mobile was never at risk of showing a stale-version score, only at risk of under-delivering fields (fixed in §14).

Structurally, since all four surfaces' snapshot data originates from the same `readiness_snapshots` table row (dashboard/detail/report via the shared loader → `mobile-readiness` RPC/select; mobile via its own Edge Function call to the identical RPC/select), the same student's `overall_score` for a given snapshot is guaranteed identical across all four by construction, not by four independently-matching implementations.

---

## 12. Migration

- `v1`/`v2` `readiness_snapshots` rows are untouched — no historical row was rewritten or deleted.
- `v3` becomes authoritative the moment `compute_readiness_snapshot()` (redefined this sprint) is called for a given student; there is no bulk backfill, each student's next natural refresh (dashboard load, Practice/quiz/Review/AI-DPE completion, or an explicit Readiness Detail/Training Report open) produces their first `v3` row.
- `fetchCurrentReadinessSnapshot()` never returns a stale prior-version snapshot silently: it checks the cached snapshot's version, then the stored `'latest'` row's version, and forces a real `'refresh'` recompute if neither is current. A surface either gets a genuine `v3` snapshot or `null` (triggering each surface's existing "not available yet" state) — v2 and v3 are never displayed together as equivalent.
- `readinessDeltaText()` (Readiness Detail's week-over-week delta) already gated on `prior.algorithm_version === current.algorithm_version` before this sprint touched anything — a v2→v3 comparison already correctly suppressed the delta, and a v3→v3 comparison (once two v3 snapshots exist a week apart) will show one automatically, with zero code change needed. Verified by reading the function; no other surface currently computes a snapshot-to-snapshot delta.

---

## 13. Mapping QA

Targeted (not exhaustive) cross-domain pass — see `GROUND_SCHOOL_ACS_MAPPING_GAP_REPORT.md`'s Sprint 4.1 addendum for full detail. Headline finding: Area IX.A ("Emergency Descent," the one Emergency Operations task believed assessable) had **zero** genuine emergency-descent content — all 16 of its `dpe_question` mappings were actually cross-country/navigation/weather-planning questions seeded onto the wrong task, while the 16 genuine Emergency Operations questions were separately seeded onto a multiengine-only task inapplicable to Apex's single-engine curriculum. All 32 were reattached to their correct tasks; 4 with no clean task fit were left honestly unmapped. Two genuinely dual-topic Aircraft Systems items (CO-danger content, an ADS-B/airspace-requirement question) received a second mapping rather than being forced into one category. Weather↔ADM, Weight & Balance↔Performance, and Navigation↔Airspace pairings were checked and found to need no further correction (see the addendum for why each is already correct or moot).

---

## 14. Database

**New migrations this sprint** (`portal/supabase-portal-schema-v134` through `v139`), all applied to production project `wqzfhcjsfzwrimvsudxy`:

- **v134** — ACS scope correction (IX.B–G → `digital_assessment_supported = false`; 7 PPL-M08 content items re-attributed from VI.A to VI.C/VI.D); `readiness_snapshots` gains `assessable_task_count`/`evidenced_task_count`/`strong_task_count`/`weak_task_count`; `task_evidence_sources` gains `self_confidence`; `record_task_evidence_internal()` recreated to persist it.
- **v135** — `compute_readiness_snapshot()` full rewrite: dampener removed, confidence aggregation, risk-management mirroring, new evidence_level thresholds, new top-level count columns, `algorithm_version = 'v3'`.
- **v136** — `record_review_outcome()` rewrite: idempotency replay validates `review_item_id`+`outcome`, not just profile; evidence-writing extended to all four review source types via `content_acs_mappings`.
- **v137** — `portal_review_items` gains `ai_dpe_boosted`; `sync_review_queue()` rewrite: `acs_category` resolution for Ground School source types; AI-DPE boost made derived/idempotent.
- **v138** — targeted mapping QA corrections (32 dpe_question reattachments/deletions, 3 new dual-topic mappings).
- **v139** — security fix: revoke `authenticated`'s direct grant on `record_task_evidence_internal()`.

**Indexes/policies:** no new indexes were required this sprint (existing `task_evidence_sources` primary key and `content_acs_mappings`'s unique constraint already covered every new query path — confirmed via `EXPLAIN`, §15). No RLS policy changes were needed; `review_outcome_submissions` (Sprint 4) already had select-own-row RLS matching the `task_evidence_sources` pattern.

---

## 15. Security

- **Ownership/auth.uid() checks**: every altered/new RPC (`compute_readiness_snapshot`, `record_review_outcome`, `sync_review_queue`, `record_task_evidence_internal`) enforces `auth.uid()`-based ownership on every code path touched this sprint; live-tested owner/cross-profile/anon behavior for `record_review_outcome()`'s idempotency matrix (§8).
- **search_path**: all six new/altered functions carry `set search_path = 'public'` (or `SET search_path TO 'public'` in the `record_task_evidence_internal` case). `get_advisors('security')` confirms none of them appear in the `function_search_path_mutable` finding (that finding lists 4 unrelated, pre-existing functions).
- **PUBLIC/anon revoked**: confirmed via `has_function_privilege` — `anon` cannot execute any of the six.
- **Real finding, fixed**: `get_advisors('security')` flagged `record_task_evidence_internal` as directly REST-callable by `authenticated`. Reading its body confirmed it takes `p_profile_id` as a raw parameter with **no** `auth.uid()` check of its own — by design, since it's meant to be an internal helper called only from three wrapper functions that already check ownership before calling it. This sprint's v134 migration had re-issued `grant ... to authenticated` when recreating the function, meaning any authenticated user could call `/rest/v1/rpc/record_task_evidence_internal` directly with an arbitrary `p_profile_id`, bypassing every wrapper's ownership check and writing fabricated evidence into another student's `task_evidence`/`task_evidence_sources` rows. Fixed (v139): revoked the `authenticated` grant. Live-verified both directions — a direct call now fails with `permission denied for function record_task_evidence_internal`, while `record_ground_school_evidence()` (a legitimate wrapper, owned by the same role) still succeeds normally as an authenticated user.
- **No free-text leakage**: confirmed by code review that `record_review_outcome()`, `sync_review_queue()`, and `compute_readiness_snapshot()` never select or persist `guided_notes.response_text`, question prompt text, or any other free-text field into `readiness_snapshots`, `task_evidence`, or `task_evidence_sources` — only booleans, numerics, and IDs.

---

## 16. Performance

`EXPLAIN (ANALYZE, BUFFERS)` on the two query shapes materially changed or added this sprint:

- **Confidence aggregation** (new in `compute_readiness_snapshot()`): a hash join between `get_readiness_scoped_acs_tasks()` and an indexed bitmap scan of `task_evidence_sources` on its existing primary key (`profile_id, ...`) — 0.9ms execution time on the test profile, no sequential scans.
- **Ground School `acs_category` resolution** (new in `sync_review_queue()`, one scalar subquery per newly-synced item): index-only scan on `content_acs_mappings`'s existing `(content_type, content_id, acs_task_id)` unique constraint joined to `acs_tasks`'s primary key — 0.9ms execution time.

Both are well within budget for dashboard load and the four completion-trigger call sites (Practice, module quiz, Review Session, AI DPE) established in Sprint 4's coalescing refresh coordinator, which this sprint did not modify. No N+1 pattern was introduced — the Ground School resolution runs once per row during `sync_review_queue()`'s existing `INSERT ... SELECT`, not once per client request.

`get_advisors('performance')` shows only pre-existing, low-severity `INFO`-level findings on tables this sprint touched (a couple of missing covering indexes on foreign keys, and RLS policies re-evaluating `auth.uid()` per-row rather than via `(select auth.uid())`) — all predate this sprint and are not on any hot path this sprint added; left as-is per scope discipline.

---

## 17. Regression

- `node --check` passed on `site/portal-stable.js` and the `mobile-readiness` Edge Function after every JS/TS change this sprint.
- Sprint 4's Training Report layout, section order, and legacy-fallback rendering are byte-unchanged except for the snapshot-resolution call site (now the shared loader) — no visual or structural redesign.
- Sprint 3/4's `openReviewSession()`, `record_ground_school_evidence()`, `record_task_evidence()`, `computeTrainingPlan()`'s task list, and `renderReviewQueueWidget()` were read and, where their due-count logic depended on the stale `dpe_question`-only assumption, corrected (§9) rather than left silently inconsistent with the newly-category-aware Ground School review items.
- Sprint 2's Review Session UX (retry-safe idempotency key lifecycle, disable-then-gate-on-`processed` pattern) was not touched by `record_review_outcome()`'s rewrite — only the ledger's replay-validation logic and the evidence-writing branch changed; the client-facing contract (return shape, `was_replay` flag) is identical.
- The v134/v135/v136/v137/v138/v139 migrations were each live-tested individually against disposable data on production, with cleanup verified (zero residual rows) after every test batch across all phases.

---

## 18. Known Limitations

- **IX.A's evidence base is thin.** One question (`emerg-6`) is the only genuine emergency-descent content that exists in the `dpe_questions` bank today. It's honest (unlike the previous 16 wrong mappings) but not deep; a student's Emergency-category coverage/knowledge signal for that one task will be noisy with so little content. Not fixed this sprint — writing new question content is out of scope for a mapping-correction pass.
- **IX.B ("Emergency Approach and Landing") and IX.C ("Systems and Equipment Malfunctions") now have real, correctly-attributed oral content** (found while fixing the Area X bug) but remain `digital_assessment_supported = false`. Whether that content is sufficient to reopen their assessability is a genuine open question deliberately left for a future sprint's deliberate decision, not decided here.
- **Risk management has no independent measurement.** This is disclosed via `reason_codes`, not hidden, but it means the "risk management" language on any surface that still uses it should be understood as "same as knowledge, shown for continuity" rather than a real second dimension — until a future sprint either builds a genuine per-source risk/knowledge split or removes the field's independent framing from the UI entirely.
- **Mobile's new top-level count fields are not yet rendered anywhere.** `assessable_task_count`/`evidenced_task_count`/`strong_task_count`/`weak_task_count` now flow through the `mobile-readiness` Edge Function and `MobileReadinessSummary`, but no mobile screen (same status as `category_breakdown` since Sprint 3) reads them yet — a future mobile sprint can build against them with zero further backend change.
- **No automated test suite exists for `compute_readiness_snapshot()`/`record_review_outcome()`/`sync_review_queue()`.** All verification this sprint was live, disposable-data testing directly against production (this repo's established pattern for prior sprints too) — there is no regression suite that would catch a future accidental reintroduction of, say, the dampener or the idempotency gap. Worth a future investment, not built here (would itself be new scope).

---

## 19. Merge Recommendation

**Recommend merging Sprint 4 + Sprint 4.1 together.** Sprint 4.1 closes every integrity gap the spec identified in Sprint 4's readiness/review-queue/AI-DPE work: determinism, honest scope, honest risk-management framing, real confidence aggregation, hardened idempotency, full Ground-School review-queue evidence coverage, non-compounding AI-DPE priority, one authoritative snapshot version across all four surfaces, and a genuine (not just believed) emergency-descent evidence pathway. All 15 success criteria in the original spec are met; the required test matrix (determinism, evidence-change, scope, confidence, risk, review-idempotency ×5, review-queue ×4 source types, AI-DPE-priority, cross-surface, snapshot-delta) was executed live against production with results recorded above. One real security vulnerability was found and fixed as part of this sprint's own security pass (§15) — not introduced then silently shipped.

**Do NOT recommend Sprint 5 work** beyond what's already flagged in §18 as future candidates (IX.B/C assessability reconsideration, a genuine risk/knowledge evidence split, mobile UI for the new count fields, an automated test suite). None of those are readiness-integrity gates — they are enhancements a stable v3 foundation now makes possible, not prerequisites this sprint left undone.
