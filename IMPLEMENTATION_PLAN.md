# Apex Advantage — Launch Readiness Implementation Plan

**Status:** Phase 1 (Premium Content Security), the ground-school RLS
hardening called out as Phase 1's top open risk (see
`GROUND_SCHOOL_RLS_AUDIT.md`), Phase 2 (Billing & Account Consistency), and
Phase 3 (Retention System) are executed and verified. Phases 4–7 planned
and sequenced below, not yet built — each is a substantial standalone
effort in its own right (a CMS, an analytics dashboard, attendance
tooling), and building all of them in one uncommitted pass would mean
shipping untested, unverified code against a live payment system. This
document is the roadmap for the follow-up passes.

## How this plan was built

Before writing anything, a full audit was run across: authentication, Stripe
payments, premium content gating, Supabase RLS, email automations,
analytics, account management, and admin dashboards. The audit's raw
findings live in git history / session notes; the actionable output is
folded into this plan and into `LAUNCH_READINESS_REPORT.md`. Two findings
from that audit turned out to be more urgent than anything in the original
phase list, and are called out explicitly below.

## Two findings that reordered priority

1. **The premium content was not just "UI-gated" — it was fully public.**
   `site/portal.js` is a static file served to anyone, logged in or not. The
   entire $29–$49 Checkride Prep System (72 DPE questions, 10 scenarios, 7
   quick-reference sheets, 2 lessons) was plain-text JS in that file. Anyone
   could `curl` it and read the whole paid product for free, no account
   needed. This is now fixed (see Phase 1 below) — it was more severe than
   the "UI-only gating" the original ask assumed, so it got done first.

2. **Three RLS policies allow self-moderation.** `portal_referrals`,
   `portal_testimonials`, and `portal_question_discussions` each use a
   single `for all` policy scoped to `auth.uid() = owner`, which doesn't
   restrict *which columns* the owner can change. A user could `UPDATE`
   their own testimonial's `status` to `'approved'`, or their own Ask
   Andrew question's `answer`/`status` to fabricate a "Andrew answered
   this" FAQ entry — both would immediately become publicly visible via
   the existing "view approved/answered" policies. Fixed in the same pass
   (see Phase 1).

---

## Phase 1 — Premium Content Security ✅ Executed this pass

**What shipped:**

- `portal/supabase-portal-schema-v5.sql` — four new tables
  (`dpe_categories`, `dpe_questions`, `quick_reference_sheets`,
  `portal_lessons`), RLS enabled with admin-only direct SELECT, seeded with
  the exact content extracted from `site/portal.js` (72 questions, 9
  categories, 7 reference sheets, 2 lessons — verified byte-identical to
  what was live). Also includes the three self-moderation-lock triggers.
- `portal/supabase/functions/_shared/premiumAccess.ts` — `hasPremiumAccess()`
  and `requirePremiumAccess()`, the centralized verification helpers
  requested. Both check the caller's real Supabase session (via
  `auth.getUser(token)`) against `profiles.checkride_prep_unlocked` — never
  a client-supplied flag.
- `portal/supabase/functions/get-premium-content/index.ts` — the new Edge
  Function that serves all four content sets. Calls
  `requirePremiumAccess()` first; returns **403 with no content body** if
  the caller hasn't paid. This is the actual enforcement boundary now —
  everything else (nav gating, the unlock modal) is UX on top of it, not
  the security boundary itself.
- `site/portal.js` — the five content constants (`DPE_DATA`,
  `CATEGORY_META`, `QUICK_REF`, `FRAMEWORK_LESSON`, `CHECKRIDE_DAY_LESSON`)
  are now empty placeholders populated at runtime by
  `loadPremiumContent()`, which calls the new Edge Function only for
  unlocked members. Every rendering function that consumes this data was
  checked for empty-array crash risk; one real bug was found and fixed
  (`renderLessons()` assumed `CATEGORY_META[cat]` always exists — it now
  guards and returns early for locked users), plus `checkAchievements()`
  and the Question-of-the-Day computation were hardened the same way.
  **No UI was redesigned** — every section, button, and layout is
  unchanged; only where the data comes from changed.
- Verified via Playwright with a mocked Supabase client: a locked user's
  full dashboard render pipeline runs with zero errors and never calls the
  content endpoint; an unlocked user's fetch populates real content and
  renders it correctly (DPE library, scenario cards) exactly as before.

**Not fixed in this pass (flagged, not silently skipped):**

- `ground_sessions` / `ground_registrations` have no `CREATE TABLE` in any
  committed SQL file — they were created directly in the Supabase
  dashboard. Their current RLS state is unknown from this codebase, and
  they're reachable from two public, unauthenticated routes
  (`/ground-schedule` registration, `/attend/:type/:token` check-in) while
  now also holding payment data. I did not guess at RLS policies for
  tables I can't inspect live — see `LAUNCH_READINESS_REPORT.md` for the
  exact dashboard check needed before this can be marked safe.

---

## Phase 2 — Billing & Account Consistency ✅ Executed this pass

**What shipped:**

- `portal/supabase-portal-schema-v7.sql` — new SELECT policy "Members can
  view their own portal access purchases" on `portal_access_purchases`
  (was admin-only-select before this); new `get_checkride_prep_pricing()`
  `SECURITY DEFINER` RPC that returns the live founding/standard
  tier+price+seats-remaining, mirroring the exact rule
  `create-checkout-session` already enforces server-side, without giving
  every member a row-level SELECT policy over other members' purchase
  records just to count them. Verified against a real local Postgres 16
  instance: a member sees only their own purchase row, a different member
  and anon see none, admin sees all, and the pricing RPC correctly reports
  `founding`/24-remaining at 1 purchase and flips to `standard`/0-remaining
  at exactly 25.
- `site/portal.html` / `site/portal.js` — the Account page's Membership
  card no longer hardcodes `"Apex Advantage — Founding Member"` and
  `"$25 / session"` regardless of what the member actually bought; it now
  shows real state (`Not yet unlocked` / `Unlocked (Founding Pricing) —
  $29.00` / `Unlocked — $49.00`) plus the actual unlock date pulled from
  `portal_access_purchases`. A new **Billing History** card renders every
  row from `invoices` (already had correct student-own-row RLS from the
  original schema — no policy change needed there), formatted with amount
  and a paid/unpaid status badge.
- The "$29 · Tap to unlock" labels on the five locked dashboard widgets
  and the unlock modal's price were static HTML that kept advertising $29
  forever, even after the 25 founding seats were gone and new members were
  actually being charged $49 at checkout — a real billing inconsistency.
  Both now call `get_checkride_prep_pricing()` once on page load and
  render the actual current tier/price/seats-remaining, so what a member
  sees before clicking "Unlock Now" always matches what Stripe actually
  charges them.
- Copy sweep: the marketing pages' `$29`/`$49`/"Founding Member" language
  (`checkride-prep.html`, `apex-advantage.html`, etc.) is accurate
  advertising of the pricing tiers themselves and was already updated in
  the freemium rework — left as-is. The bug was specifically inside the
  member portal showing a *fixed* price regardless of the *viewing
  member's own* real eligibility/purchase state, which is what this pass
  fixed.
- Verified via Playwright against a mocked Supabase client: a locked
  member's Account page shows "Not yet unlocked" / empty billing history /
  the live founding-tier price and seats-remaining; an unlocked founding
  member's page shows the correct tier label, unlock date, and both
  billing-history rows (a Checkride Prep purchase and a manually-entered
  flight-lesson invoice) with correctly formatted amounts and status
  badges — zero console errors in either case.

## Phase 3 — Retention System ✅ Executed this pass

**What shipped:** see `RETENTION_SYSTEM.md` for the full design, before/
after, and test results. Summary:

- `portal/supabase/functions/send-lifecycle-emails/index.ts` (new) — a
  single scheduled Edge Function that recomputes readiness milestones,
  first-question, Checkride-Mode-complete, and weak-area conditions
  server-side (line-for-line port of `computeReadiness()`/`categoryPct()`/
  `computeStreaks()` from `site/portal.js`, verified against fixture data
  by hand), plus the two email types that had no implementation anywhere:
  a 7-day inactivity nudge and the 30/14/7/3/1-day checkride countdown.
  Dedup for the four pre-existing types is shared with the client via
  `portal_events` (so neither side double-sends); every type now also
  writes to `portal_email_log`, closing the Issue #5 gap where only the
  weak-area nudge actually logged there.
- `portal/supabase-portal-schema-v8.sql` — adds `profiles.
  portal_last_active_at` (the signal the inactivity nudge needs, since
  nothing existing tracks "last visited" as distinct from "last studied").
  Also fixes two **pre-existing** bugs found while building this, neither
  introduced by this pass: (1) `profiles` had no policy letting a member
  update their own row at all, meaning the Account page's "Save Changes"
  form has been silently doing nothing for every non-admin member since it
  was built; (2) the existing admin-check policies on `profiles` itself
  recurse infinitely (`ERROR: infinite recursion detected in policy for
  relation "profiles"`) — reproduced on the unmodified original schema,
  meaning any admin session plain-selecting `profiles` through the regular
  client (not service-role) hits a hard error today. Both fixed and
  verified against a real Postgres instance.
- `site/portal.js` — pings `portal_last_active_at` once per session, logs
  to `portal_email_log` for the four milestone types (parity with the new
  server job), and corrects a stale comment that referred to a
  "separate apexadvantage repo" Edge Function that no longer exists as a
  separate thing post-merge and was never actually present in this
  codebase.

**Action required before this is live (cannot be done from this
sandbox):** run the v8 migration, check the Supabase Edge Functions list
for a possibly-still-deployed legacy inactivity-nudge function before
deploying the new one (to avoid double-sends), deploy
`send-lifecycle-emails`, and schedule it (dashboard cron or `pg_cron`/
`pg_net` — exact steps in `RETENTION_SYSTEM.md`). None of this could be
verified end-to-end against the live project from this sandbox.

## Phase 4 — Content Operations (foundation laid, UI not built)

Phase 1's migration already moves DPE questions/scenarios/quick-reference/
lessons into real tables — that was the prerequisite for a CMS to even be
possible (you can't build an admin editor over hardcoded JS). What's left:
an admin UI (likely a new section in `portal.html`'s existing admin panel,
or the React CRM) for create/edit/publish on `dpe_questions` and
`dpe_categories`, matching the pattern already used for Ask Andrew/
testimonial moderation. Ask Andrew and testimonial admin workflows **already
exist and work** (`renderAdminAskInbox`, `renderAdminTestimonialInbox`) —
the gap there is narrower than the original ask assumed: referrals have
**no admin action UI at all** today (pure data write, no way to mark
`signed_up`/`rewarded` short of a direct DB edit), which is the one real
gap to close in this phase.

## Phase 5 — Analytics & Conversion Tracking (not started)

See `ANALYTICS_EVENT_MAP.md` for the concrete event taxonomy this phase
should build against — `portal_events` already logs a reasonable set of
raw events; this phase is mainly building the aggregation/dashboard layer
on top, plus adding the funnel-specific events (`account_created`,
`premium_unlocked`, `ground_school_purchased`) that don't exist yet.

## Phase 6 — Ground School Optimization (mostly already built)

Contrary to the original ask's framing, attendance tracking, CSV export,
manual registrant add, waitlist promotion, and bulk email **already exist**
in `GroundSchedule.jsx` (the React CRM). What's actually missing: a
student-facing "My Sessions" view (past/upcoming/purchased) in the member
portal — today a student who paid via the new Stripe flow has no way to
see their own registration history — and the post-attendance follow-up
email sequence (replay/resources/portal CTA), which doesn't exist in any
form yet.

## Phase 7 — Launch Readiness Audit (this document + report, live-flow testing not done)

This session verified, via mocked Supabase/Stripe clients (this sandbox
cannot reach the live project): free signup, premium unlock modal flow,
ground school registration flow, and the full premium-content
locked/unlocked render pipeline. **Not verified**, because they require a
live Supabase project and real Stripe test-mode transactions this sandbox
can't reach: actual password reset email delivery, actual webhook
delivery/signature verification against live Stripe, actual referral
signup attribution, actual testimonial/success-wall end-to-end flow, and
the inactivity email system (whose existence itself is unverified — see
Phase 3). These need to be run by hand against the real project; see the
checklist in `LAUNCH_READINESS_REPORT.md`.
