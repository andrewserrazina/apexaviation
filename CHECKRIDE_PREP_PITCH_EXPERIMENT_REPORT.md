# Checkride Prep Personalized Pitch A/B Test — Report

**Status: code complete, tested locally, NOT committed, NOT deployed.** No migration has been applied to production and no Edge Function was touched (none needed to be). Everything below is sitting in the working tree.

## Executive Summary

Before this experiment, every member with a linked Readiness Assessment result (score, weak areas) who opened the Checkride Prep unlock modal saw the personalized "Train Your Weak Areas" pitch **100% of the time** — there was no generic-vs-personalized comparison possible for that population, because the personalized path was the only path they ever saw. This closes that gap: eligible members are now split 50/50 into `control` (today's unchanged generic pitch) and `personalized` (the same weak-area pitch, refined with a second high-readiness framing), with deterministic, sticky assignment and full funnel instrumentation to answer the two questions the sprint asked:

- **Primary:** does the personalized pitch increase modal-open → checkout-started conversion?
- **Secondary:** does it increase completed purchases?

No product, pricing, or entitlement logic changed. No new analytics event names were created — the existing funnel events already used for this flow now optionally carry `experiment`/`variant` properties.

## Existing Implementation (verified before changing anything)

- `openUnlockModal(readinessContext)` (`site/portal-stable.js`) is the single function every unlock-modal trigger point (dashboard widgets, sidebar, Training Plan card, `?upgrade=checkride-prep` deep link) calls, with or without an explicit `readinessContext` argument.
- `effectiveContext` resolves to either the explicit argument or the cached `memberReadinessContext` (loaded once per session by `loadMemberReadinessContext()` from that member's own most recent `readiness_assessment_leads` row) — but **only when the member does not already own Checkride Prep** (`member && !member.checkridePrepUnlocked`). Every call site that passes an explicit `readinessContext` (`computeReadinessRoute()`'s Training Plan card CTAs) only ever does so from inside its own `!unlocked` branch. **Confirmed: a member who already owns Checkride Prep can never reach the personalized branch, through any call site.**
- `weakLabels = effectiveContext.weakestLabels.filter(Boolean)` — real category labels from that member's own two lowest-scoring categories on their assessment (`readiness-assessment.html`'s `weakest: scored.slice(-2).reverse()` — always the two *relatively* lowest, even for a 95%+ scorer, never an absolute "these are broken" signal).
- Before this change: `if (effectiveContext && weakLabels.length)` was the sole gate deciding personalized vs. generic copy. This is exactly the eligibility rule this experiment preserves (see below).
- `checkride_prep_offer_viewed` already fires unconditionally on every `openUnlockModal()` call (Revenue Funnel sprint, Section 4); `readiness_checkride_prep_offer_viewed` fires only on the personalized path; `checkout_started`/`checkout_session_create_failed` already fire from the CTA click handler; `purchase_completed` fires from a top-of-file IIFE reading `?unlocked=1` after the Stripe redirect back. `EVENT_ALLOWLIST` in `site/analytics-events.js` documents all of these. No existing experiment/feature-flag/bucketing utility exists anywhere in this repo (checked `site/`, `portal/`, and `mobile-expo/`).
- `get_checkride_prep_funnel_stats()` and `get_revenue_funnel_by_campaign()` (v83/v85/v146) were reviewed as reference for RPC conventions (admin-gated via `is_admin(auth.uid())`, `resolve_analytics_identity()`-based anon/authenticated stitching, `SECURITY DEFINER`, `search_path = public`) — neither one is a fit for per-variant reporting, so a new small RPC was added rather than overloading either.

## Experiment Population — "Usable Readiness Context," Exactly

A member is **in** this experiment if and only if, at the moment `openUnlockModal()` runs:

1. They do **not** already own Checkride Prep (enforced upstream, as verified above — not a new check).
2. `effectiveContext` resolves to a real, linked `readiness_assessment_leads` row for that profile.
3. That row's `weakest_category_1`/`weakest_category_2` produced at least one non-empty label (`weakLabels.length > 0`).

This is **word-for-word the same condition** that already gated personalized-vs-generic before this experiment existed — nothing about who is "eligible for personalization" changed. A member with no usable readiness context is not part of the experiment at all (not silently placed in `control`) — they never receive `experiment`/`variant` properties on any event, and they always see the unchanged generic pitch, exactly as before.

## Assignment — Deterministic, Stable, No New Storage

```js
function experimentVariant(experimentKey, subjectId) {
  if (!subjectId) return null;
  var str = experimentKey + ':' + subjectId;
  var hash = 0x811c9dc5;               // FNV-1a, 32-bit
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return (hash % 100) < 50 ? 'control' : 'personalized';
}
```

- **Key:** `member.id` (the authenticated `profiles.id` UUID) — Checkride Prep checkout is exclusively an authenticated flow (every purpose the CTA drives requires a Supabase access token), so profile-based bucketing was the natural, unambiguous choice; no anonymous-id fallback was needed or added.
- **Pure function, no storage.** Because the variant is entirely a deterministic hash of `(experiment key, profile id)`, the *same member always gets the same bucket* — on every modal open, every page refresh, every session, and even weeks later at purchase time — with no new database table, no server round trip, and nothing written client-side that could be lost, cleared, or tampered with. This directly satisfies "must not switch variants... because of random `Math.random()` execution": `Math.random()` is never called anywhere in this design.
- Verified via test: ~5,000 synthetic ids split 48.7%/51.3% (within tolerance of 50/50); the same id always returns the same result across 50 repeated calls; a different experiment key salts the hash differently (so a future second experiment on the same members isn't perfectly correlated with this one).
- No existing experiment framework was found to reuse (checked), so this is intentionally the smallest possible mechanism, not a general-purpose framework — reusable as a pattern for a future test, but not built as reusable infrastructure beyond that.

## Control Variant

Unchanged. The `else` branch of `openUnlockModal()` (reached by both the `control`-bucketed eligible population *and* every ineligible member) renders exactly what production shows today: `ctxEl.hidden = true`, heading `"Unlock the Checkride Prep System"`, CTA `"Unlock Now"`. Nothing in this branch was edited.

## Treatment Variant

Two framings, chosen by `effectiveContext.score`:

**Below 80% (gaps-focused):**
- Heading: *"Turn Your Readiness Gaps Into a Study Plan"*
- Summary: *"Your Readiness Assessment flagged \<weak areas\> as your lowest-scoring areas. Checkride Prep gives you unlimited DPE-style questions and scenario practice targeted at exactly those areas, plus continued readiness tracking as you improve."*
- CTA: *"Train My Weak Areas"* (unchanged from before)

**80% and above (consistency-focused — "Nearly Ready"/"Strong Readiness" bands):**
- Heading: *"Keep Your Strong Readiness Score Consistent"*
- Summary: *"You're scoring well overall — \<score\>% (\<band\>) — with \<weak areas\> relatively lower than the rest of your assessment. Checkride Prep keeps every area sharp with continued DPE-style questions, scenario practice, and readiness tracking through checkride day."*
- CTA: *"Keep My Score Sharp"*

**Guardrails, verified by test:**
- Never says "unprepared," "not ready," "fail," or anything implying failure.
- Never guarantees checkride success.
- Weak-area labels are always the exact labels passed in (`weakestLabels`) — never invented, never a category not present in that member's own real assessment result.
- No price, discount, scarcity, or entitlement text was added or changed — the modal's price row, price note, feature list, and CTA button (below the heading/summary) are all untouched.
- Only one treatment arm exists — no multi-arm test.

## Experiment Metadata on Existing Events (no new event names)

| Event | When tagged | Notes |
|---|---|---|
| `checkride_prep_offer_viewed` | Every eligible modal open (both variants) | `personalized` boolean now reflects what was *actually rendered* (`variant === 'personalized'`), not just eligibility — a `control`-bucketed eligible member reports `personalized: false`, same as an ineligible member. Nothing reads this field in SQL today (confirmed), so this is a safe refinement. |
| `readiness_checkride_prep_offer_viewed` | Only the `personalized` branch (unchanged trigger condition — this event's existing meaning, "personalized pitch was shown," is preserved exactly) | Existing consumer `get_readiness_funnel_stats()`'s `prep_offer_personalized` metric will now report roughly half its prior volume for this population, **by design** — it now measures "personalized pitch was actually shown," not "was eligible for it." Flagged as a known, intentional side effect below. |
| `checkout_started` / `checkout_session_create_failed` | Whenever the currently-open modal has a non-null variant (read from `activeUnlockModalVariant`, set by the same `openUnlockModal()` call that rendered the modal) | |
| `purchase_completed` (Checkride Prep, `unlock-checkride-prep` purpose only) | Best-effort, recomputed independently on the `?unlocked=1` return trip | See below — this is the one path that needed extra design work. |

All four use the same shape:
```json
{ "experiment": "checkride_prep_personalized_pitch_v1", "variant": "control" | "personalized" }
```

### Why `purchase_completed` needed a different mechanism

`purchase_completed` fires from a **separate top-of-file IIFE** in `site/portal-stable.js`, on a **fresh page load** after Stripe redirects back to `portal.html?unlocked=1&session_id=...` — a completely different JS execution context than the one that opened the modal. Two options were considered:

1. Thread the variant through Stripe Checkout metadata / `success_url`, the way `tier`/`amount_cents` already are. **Rejected** — this would require modifying and redeploying `create-checkout-session`, which is real backend surface for a client-analytics-only concern, and this task is explicitly scoped to *not* become a general changes sprint.
2. **Recompute the variant independently, client-side, at purchase time**, using the exact same pure `experimentVariant()` function plus a fresh lookup of that profile's `readiness_assessment_leads` row (the same "usable readiness context" check, applied identically). **Chosen** — because assignment is a pure function of `(experiment key, profile id)`, this always reproduces the exact same result the modal computed, with no threading, no new columns, and no backend redeploy. It costs one extra `auth.getUser()` + one extra `readiness_assessment_leads` select, only on the rare `?unlocked=1` purchase-return page load, and is fully best-effort (wrapped so a lookup failure can never block the real purchase tracking or the Meta pixel).

The existing dedupe-key (`apex_funnel_purchase_<sessionId>`) is claimed **synchronously**, before this async lookup starts, so a slow or failed lookup can never cause a double-fire.

## Database Changes

One new migration, **additive only, no schema changes**: `portal/supabase-portal-schema-v147-checkride-prep-pitch-experiment.sql`. It adds exactly one function:

```sql
get_checkride_prep_pitch_experiment_stats(p_start timestamptz, p_end timestamptz)
  returns table (variant, offer_views, checkout_started, purchases, revenue,
                 offer_to_checkout_rate_pct, offer_to_purchase_rate_pct)
```

- `is_admin(auth.uid())`-gated, `SECURITY DEFINER`, `search_path = public`, `stable` — same shape as every other admin funnel RPC in this codebase.
- Reads only `analytics_events` rows where `properties->>'experiment' = 'checkride_prep_personalized_pitch_v1'`, grouped by the `variant` property each row already carries. Uses `resolve_analytics_identity()` for anon/authenticated stitching, matching every other funnel RPC.
- `revenue` sums `properties->>'price'` from `purchase_completed` rows for this experiment only — this is consistent with how `get_checkride_prep_funnel_stats()` already computes revenue (from event properties, not `portal_access_purchases`), since this RPC's only job is experiment-arm comparison, not authoritative revenue reconciliation.

## Tests Performed

**SQL (local Postgres, `test/sql/v146_revenue_funnel_harness.sql` + the new migration applied on top):**
- Inserted synthetic control-arm (10 offer views / 3 checkouts / 1 purchase @ $29) and personalized-arm (10 / 6 / 3 @ $29 each) events plus one unrelated, untagged event.
- `get_checkride_prep_pitch_experiment_stats(null, null)` returned exactly:

  | variant | offer_views | checkout_started | purchases | revenue | offer→checkout % | offer→purchase % |
  |---|---|---|---|---|---|---|
  | control | 10 | 3 | 1 | 29 | 30.00 | 10.00 |
  | personalized | 10 | 6 | 3 | 87 | 60.00 | 30.00 |

  — the unrelated event correctly did not appear anywhere.
- Confirmed a non-admin caller (`app.current_is_admin = 'false'`) is rejected with `Admin access required`.

**JavaScript (`portal/test/checkridePrepPitchExperiment.test.js`, 22 tests, all passing)** — real behavioral execution of the extracted `experimentVariant()`/`checkridePrepPersonalizedCopy()` functions (not just text assertions), plus static-source assertions on the wiring, matching this repo's established testing convention for `site/portal-stable.js`:
- Determinism (50 repeated calls, one id → one variant), null-subject handling, two hardcoded golden values (catches an accidental change to the hash algorithm), ~50/50 distribution across 5,000 ids, and cross-experiment salting.
- Treatment copy: gaps-framing below 80%, consistency-framing at/above 80% (including the exact `80` boundary), no fabricated categories, and a guardrail scan for failure/guarantee language in both framings.
- `openUnlockModal()` wiring: `pitchVariant` only computed when eligible; the control/ineligible branch is byte-identical to the pre-experiment generic copy; `checkride_prep_offer_viewed`/`readiness_checkride_prep_offer_viewed` correctly merge experiment metadata; `activeUnlockModalVariant` is set for the click handler.
- CTA click handler: `checkout_started` and both `checkout_session_create_failed` call sites merge the experiment tag.
- Purchase-return IIFE: dedupe is claimed before the async experiment lookup; the lookup only tags a profile with real usable readiness context.
- Cross-file: no new event name resembling `*experiment*`/`*variant*` was added to `EVENT_ALLOWLIST`.

**Full regression run:** `cd portal && npx vitest run` → **178/178 passing** (156 pre-existing tests untouched in behavior, one pre-existing test in `checkoutObservability.test.js` updated to match the new internal branch condition — see Files Changed — plus the 22 new tests above). `node --check` clean on both modified `.js` files.

## Files Changed

| File | Change |
|---|---|
| `site/portal-stable.js` | Added `CHECKRIDE_PREP_PITCH_EXPERIMENT`, `experimentVariant()`, `resolveCheckridePrepPitchExperimentTag()` (top of file); `activeUnlockModalVariant`, `checkridePrepPersonalizedCopy()` (near `openUnlockModal()`); rewired `openUnlockModal()`'s personalized/generic branch through the experiment; tagged `checkout_started`/`checkout_session_create_failed` in the CTA click handler; tagged `purchase_completed` in the `?unlocked=1` IIFE. |
| `site/analytics-events.js` | Documentation-only comment next to `EVENT_ALLOWLIST` describing the new optional `experiment`/`variant` properties. No array entries changed. |
| `portal/supabase-portal-schema-v147-checkride-prep-pitch-experiment.sql` | New, additive-only migration: one new admin-gated reporting RPC. |
| `portal/test/checkridePrepPitchExperiment.test.js` | New, 22 tests. |
| `portal/test/checkoutObservability.test.js` | One assertion updated to match `openUnlockModal()`'s new internal branch condition (`pitchVariant === 'personalized'` instead of the raw eligibility check) — the behavior it verifies (canonical event fires before the personalized/generic split) is unchanged. |
| `CHECKRIDE_PREP_PITCH_EXPERIMENT_REPORT.md` | This report. |

No changes to any Edge Function, no changes to Stripe/checkout logic, no changes to pricing or entitlement, no changes to `portal.html`'s markup (all copy is set via existing `textContent` assignments into existing DOM nodes).

## Known Limitations / Remaining Risks

1. **`prep_offer_personalized` in `get_readiness_funnel_stats()` will show roughly half its prior volume** for this population going forward — this is the *intended effect* of running the experiment (only the personalized arm now renders that pitch), not a bug, but anyone glancing at that existing dashboard number without this context could misread it as a regression. Worth a one-line note wherever that dashboard is reviewed.
2. **`purchase_completed`'s experiment tag is best-effort**, not guaranteed — it depends on a client-side `auth.getUser()` + `readiness_assessment_leads` lookup succeeding after the Stripe redirect. A purchase can still be correctly tracked (revenue, product) even if this specific tag fails to attach; only the per-variant purchase attribution for that one purchase would be missing from `get_checkride_prep_pitch_experiment_stats()`. This should be rare (the same lookup pattern `loadMemberReadinessContext()` already uses in production, just re-run once more) but is not zero-risk.
3. **Sample size / statistical significance is out of scope for this change** — `get_checkride_prep_pitch_experiment_stats()` reports raw counts and rates, not a significance test. Given current traffic volumes (the sprint report's own audit found single-digit-to-low-double-digit weekly personalized-offer views), this experiment will likely need to run for a meaningful stretch before either question can be answered with confidence — that's an operational/timing decision for whoever reviews the results, not something this change can predetermine.
4. **The Training Plan card's own weak-area copy (`computeReadinessRoute()`, a separate surface from the unlock modal) is unchanged and out of scope** — its CTA still calls `openUnlockModal(ctx)`, so a click into it *does* go through the experiment, but the card's own on-page headline/subhead text (e.g., "You're close. Pressure-test what you know.") is untouched, per the task's explicit scoping to "the Checkride Prep unlock modal."

## Production Verification Plan (if/when this is approved to ship)

1. Apply `portal/supabase-portal-schema-v147-checkride-prep-pitch-experiment.sql` via `mcp__Supabase__apply_migration`.
2. No Edge Function redeploy is needed — `site/portal-stable.js` and `site/analytics-events.js` are static files served directly; deploying them is whatever this repo's normal static-site publish step is (outside this task's scope to invoke).
3. Post-deploy, as an admin: call `get_checkride_prep_pitch_experiment_stats(null, null)` and confirm it returns `control`/`personalized` rows once real traffic starts landing (initially both may show 0 rows until the first eligible member opens the modal).
4. Manually open the unlock modal as two different disposable test accounts, each with a seeded `readiness_assessment_leads` row (one scoring <80%, one ≥80%), and confirm: (a) the two accounts consistently land in the same bucket across repeated modal opens/refreshes, (b) the copy matches the assigned variant and score band, (c) `analytics_events` rows for `checkride_prep_offer_viewed`/`checkout_started` carry the expected `experiment`/`variant` properties.
5. Confirm an account with **no** readiness assessment on file still sees the unchanged generic modal and never receives `experiment`/`variant` properties on any event.

**This report and its code changes are being handed back for review — nothing has been committed or deployed.**
