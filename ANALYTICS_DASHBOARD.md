# Analytics & Conversion Dashboard (Phase 5)

Resolves `IMPLEMENTATION_PLAN.md` Phase 5, executed per
`ANALYTICS_EVENT_MAP.md`'s own recommended build order.

---

## What shipped

### `portal/supabase/functions/stripe-webhook/index.ts`

The two genuinely missing conversion events `ANALYTICS_EVENT_MAP.md`
called out, added server-side (not client-side — these are revenue events
and must never depend on a member reopening the portal):

- `handleUnlockCheckridePrep` now also inserts a `portal_events` row
  (`event_type: 'premium_unlocked'`, `metadata: {tier, amount_cents}`)
  alongside the existing `portal_access_purchases`/`invoices` writes.
- `handleGroundSchoolRegistration` now also inserts a `portal_events` row
  (`event_type: 'ground_school_purchased'`, `metadata: {session_id,
  amount_cents, is_waitlisted}`). `profile_id` can be `null` here (a
  walk-in who paid online with no matching portal account) — still
  logged for aggregate counting even when it can't be attributed to a
  specific member.

No new RLS was needed for this — `portal_events` already had both
`"Users manage their own events"` and `"Admins can view all events"`
policies from the original schema, and the webhook writes via
`service_role` regardless.

### `site/portal.js` — admin dashboard: Funnel & Revenue, Retention

Two new cards in the existing vanilla admin dashboard (same surface every
other admin section from Phases 1–4 lives in):

**Funnel & Revenue** — built directly on `portal_access_purchases` +
`ground_registrations` + the existing `invoices` query, per
`ANALYTICS_EVENT_MAP.md`'s own recommendation to use the reliable source
tables rather than `portal_events` aggregation (which undercounts
anything that only ever fired client-side — see Phase 3):
- Signup → Unlock conversion rate (unlocks / total signups)
- Premium unlocks, split founding vs. standard, with revenue
- Ground school paid registrations, with revenue
- **Total Platform Revenue** — the existing "Paid Invoices" metric card
  only ever summed the `invoices` table, which never contained ground
  school payments (those live in `ground_registrations`, a separate
  table with its own `amount_cents`/`payment_status`). That made "total
  revenue" silently incomplete. Fixed by adding ground school revenue on
  top of the existing invoices sum — **not** by also adding
  `portal_access_purchases`' own sum a second time, since every premium
  unlock already has a mirrored `invoices` row from
  `handleUnlockCheckridePrep` and doing both would double-count it.

**Retention** — Day 1/7/30 cohort retention and a streak-length
distribution (`0` / `1–2` / `3–6` / `7–13` / `14+` days), computed
entirely from `profiles.created_at` and `portal_study_activity` — no new
instrumentation needed, matching `ANALYTICS_EVENT_MAP.md`'s note that this
is "usable as-is; needs a query, not new instrumentation." Both are
cohort-based (classic Day-N definition: was the member active on exactly
`signup_date + N`), computed client-side in the admin dashboard by
iterating every profile against a profile→activity-dates map built from a
single `portal_study_activity` fetch (no additional queries beyond what
the dashboard already fetches for the existing 30-day-active-users metric).

### `ANALYTICS_EVENT_MAP.md` corrections

Two factual errors from the doc's original draft (from before this data
was actually queried against the live schema) are corrected: it claimed
`portal_scenario_progress` had no `last_viewed_at` column and would need
one added, and that the completion column might be named `reviewed` — the
live schema (`site/supabase-portal-schema.sql`) already has
`last_viewed_at` and `completed` on that table, identical in shape to
`portal_question_progress`. No migration was needed for the content
engagement metrics section.

---

## Tests run

- `portal/supabase/functions/stripe-webhook/index.ts` — syntax-checked
  with `esbuild` (this sandbox has no Deno runtime to execute it against a
  real webhook payload; the actual insert calls follow the exact same
  `supabase.from(...).insert({...})` pattern already used successfully
  elsewhere in the same file).
- Retention/streak formulas — verified with a standalone script against
  hand-computed fixture data (4 synthetic profiles with known signup
  dates and activity patterns) before touching the real dashboard code:
  Day 1/7/30 retention rates and streak-bucket counts all matched the
  expected values exactly, including the edge case of a cohort too young
  to be eligible for Day 30 yet (correctly excluded from the denominator,
  not counted as churned).
- Full dashboard rendering — verified via Playwright against a mocked
  Supabase client with a 5-profile fixture (1 admin, 4 students with
  varying signup ages, purchase tiers, ground-school payments, and study
  activity patterns): every rendered number (conversion rate, premium
  unlock tier split and revenue, ground school revenue, combined total
  revenue, all three retention rates, and the streak-bucket counts)
  matched the hand-computed expected values exactly, with zero console
  errors.

---

## Known limitations / deliberate approximations

- **Timezone approximation**: retention/streak cohort math uses UTC
  throughout for internal consistency, while `activity_date` values were
  originally written using each member's own browser-local date
  client-side. This is the same one-day-fuzziness tradeoff already
  documented in `RETENTION_SYSTEM.md` for the lifecycle-email job — fine
  for a coarse aggregate metric, not claimed to be per-member-exact.
- **Milestone-email engagement events** (`first_question_completed`,
  `readiness_25/50/75/90`, etc.) are still undercounted in `portal_events`
  for the reason `ANALYTICS_EVENT_MAP.md` already flagged — this dashboard
  deliberately doesn't build anything on top of those specific events for
  that reason; it reads `portal_study_activity`/`portal_access_purchases`/
  `ground_registrations` directly instead, which don't have that problem.
- **Funnel step events** (`viewed_signup`, `started_checkout`,
  `abandoned_checkout`) are still not implemented — genuinely no
  instrumentation exists for Stripe Checkout abandonment specifically.
  `ANALYTICS_EVENT_MAP.md`'s suggestion (Stripe's `checkout.session.expired`
  webhook event) is still the recommended low-effort path if this is
  wanted later; not built in this pass since it wasn't in the "build
  order" this phase executed against.
