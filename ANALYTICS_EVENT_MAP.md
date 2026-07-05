# Analytics Event Map

Reference for Phase 5 (Analytics & Conversion Tracking, not yet built).
Documents what's actually logged today in `portal_events` vs. the gaps a
funnel/conversion dashboard would need filled first.

## Events that exist today (`site/portal.js`, table `portal_events`)

All logged via `logEventOnce(type, metadata)` → `portal_events.insert({
profile_id, event_type, metadata })`, deduped in-memory against
`loggedEventTypes` (loaded once from existing rows at page load — **not**
`portal_email_log`, see the note in `IMPLEMENTATION_PLAN.md` Phase 3 about
that inconsistency).

| `event_type` | Fires when | Deduped? |
|---|---|---|
| `first_login` | Every portal session load, once per account | Yes (once ever) |
| `first_question_completed` | First DPE question marked studied | Yes (once ever) |
| `readiness_25` / `_50` / `_75` / `_90` | Readiness score crosses each threshold | Yes (once ever, per threshold) |
| `checkride_mode_completed_email` | Checkride Mode practice run completed | Yes (once ever) |
| `checkride_passed` | Member submits "I Passed My Checkride" | Yes (once ever) |
| `mock_oral_requested_<timestamp>` | Mock Oral booking button clicked | **No** — timestamp in the key means every click logs a new row by design (this one's meant to count requests, not dedupe them) |

**Important caveat for a future dashboard:** every event above only fires
if the member has the portal open at the moment the condition becomes
true (see Phase 3 in the implementation plan) — there's no server-side
reconciliation. A dashboard built purely on `portal_events` will
undercount anything that would only have been noticed on a visit the
member never made. Fix the underlying trigger mechanism (move to a
scheduled server-side check) before trusting these numbers as a KPI.

## Events that do NOT exist yet — needed for Phase 5's stated funnel metrics

The original ask wants: accounts created, active users, premium unlocks,
ground school purchases, conversion rate, revenue. None of these are
explicit `portal_events` rows today — they're each derivable from other
tables, but not from one consistent event stream:

| Needed event | Derivable today from | Gap |
|---|---|---|
| `account_created` | `profiles.created_at` | Not logged as an event; fine to derive from the table directly, no new event needed |
| `premium_unlocked` | `portal_access_purchases` insert (webhook-driven) | **✅ Fixed (Phase 5)** — `stripe-webhook`'s `handleUnlockCheckridePrep` now inserts a `portal_events` row (`{tier, amount_cents}`) server-side, alongside the existing `portal_access_purchases`/`invoices` writes |
| `ground_school_purchased` | `ground_registrations` insert (webhook-driven) | **✅ Fixed (Phase 5)** — `handleGroundSchoolRegistration` now inserts a `portal_events` row the same way (`profile_id` may be `null` for a walk-in with no matching portal account — still counted for aggregate revenue/funnel purposes even when unattributed) |
| `active_user` (daily/weekly) | `portal_study_activity` rows | Usable as-is; "active" already means "did something," just needs an aggregation query, not a new event |
| Funnel step events (`viewed_signup`, `started_checkout`, `abandoned_checkout`) | Nothing today | Genuinely missing — Stripe Checkout abandonment isn't observable at all right now since nothing fires until `checkout.session.completed`. Consider Stripe's `checkout.session.expired` webhook event as a low-effort way to at least capture abandonment without new client instrumentation |

## Content engagement events — needed for "most viewed/completed/bookmarked question"

Already fully derivable from existing tables, no new events needed:

- **Viewed**: `portal_question_progress.last_viewed_at` (question),
  `portal_scenario_progress.last_viewed_at` (scenario) — corrected from an
  earlier draft of this doc, which claimed scenarios had no equivalent
  column; they do (`site/supabase-portal-schema.sql`), no migration
  needed.
- **Completed/studied**: `portal_question_progress.completed` /
  `portal_scenario_progress.completed` (both are plain `completed`
  booleans, not `reviewed` as an earlier draft of this doc guessed).
- **Bookmarked**: `portal_question_progress.favorited` /
  `portal_scenario_progress.favorited`.

## Retention metrics — Day 1/7/30, streak distribution

- **Day 1/7/30 retention**: derivable from `portal_study_activity` (has
  per-day activity rows per the audit) joined against `profiles.created_at`
  — needs a query, not new instrumentation.
- **Streak distribution**: `computeStreaks()` already exists client-side
  (`site/portal.js`) and is used for the achievement/streak display — the
  admin dashboard would need a server-side equivalent (or a materialized
  view) to aggregate this across all users rather than one member at a
  time, since the current implementation only ever computes one user's
  own streak.

## Recommendation for Phase 5's build order — ✅ executed this pass

1. ~~Add the two missing server-side events...~~ **Done** — see above.
2. ~~Build the admin dashboard's funnel/revenue section on top of
   `portal_access_purchases` + `invoices` directly...~~ **Done** — see
   `ANALYTICS_DASHBOARD.md` for the full design (funnel/revenue card now
   also folds in `ground_registrations`, since ground school payments
   aren't in `invoices` and omitting them would have made "total revenue"
   silently wrong).
3. Treat `portal_events`-derived engagement/retention metrics as
   directionally useful but under-counted until the Phase 3 email/
   milestone system moves server-side — the two problems share the same
   root cause and should likely be fixed together. **Still true** for the
   milestone-email events (`first_question_completed`, `readiness_*`,
   etc.); not true anymore for `premium_unlocked`/`ground_school_purchased`
   (webhook-driven, complete) or Day 1/7/30 retention (derived directly
   from `portal_study_activity`/`profiles.created_at`, not from
   `portal_events` at all).
