# Apex Advantage — Launch Readiness Implementation Plan

**Status:** Phase 1 executed and verified in this pass. Phases 2–7 planned and
sequenced below, not yet built — each is a substantial standalone effort in
its own right (a CMS, an analytics dashboard, five email automations,
attendance tooling), and building all of them in one uncommitted pass would
mean shipping untested, unverified code against a live payment system. This
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

## Phase 2 — Billing & Account Consistency (not started)

**Scope, grounded in the audit:**
- Account page currently shows nothing about founding/standard tier,
  purchase date, or referral code in one place — that data exists
  (`portal_access_purchases.tier`, `.created_at`, `portal_referral_codes.code`)
  but isn't surfaced together as a "Membership Status" card.
- No billing history view exists in the student portal today — `invoices`
  rows are created correctly (verified in the freemium-rework pass) but
  never rendered back to the student. Admin's Billing.jsx (React CRM) can
  see them; the member portal (`portal.html`) has no equivalent.
- Audit every page for "the portal costs $29" language that predates the
  free-signup model — the marketing pages (`checkride-prep.html`,
  `apex-advantage.html`) were already updated in the freemium rework; a
  full sweep of `portal.html`/`portal.js` copy itself hasn't been done.

**Estimated effort:** small-to-medium. Mostly a new Account section + one
new read-only Edge Function or direct RLS-backed query (existing
`portal_access_purchases` RLS is admin-only-select today, so the student's
own row needs either a new "view own purchases" policy or a scoped
Edge Function — recommend the RLS policy, it's simpler and this data isn't
sensitive to the owner themselves).

## Phase 3 — Retention System (partially exists, largely unverifiable from this repo)

**What's real:** readiness milestones (25/50/75/90%), first-question,
Checkride-Mode-complete, and weak-area emails all exist and fire — but
**client-side only**, triggered from `initPortalData()` on page load/UI
events. There is no server-side reconciliation: if a member crosses a
milestone without the portal tab open at the right moment, that email
simply never sends. `portal_email_log` is defined and intended as the
single dedup source for all lifecycle emails, but only the weak-area nudge
actually writes to it — the other four dedupe against `portal_events`
instead, so an admin querying `portal_email_log` today sees an incomplete
picture.

**What's referenced but not present:** the 7-day inactivity nudge is
mentioned in a code comment as living in "a separate scheduled Edge
Function in the apexadvantage repo" — that function is not in this
codebase and its existence/correctness cannot be verified from here.
**Action item:** confirm directly whether this function is actually
deployed and running before assuming it works.

**Not started:** checkride countdown automation (30/14/7/3/1-day emails) —
the countdown date and display already exist (`portal_checkride_date`,
`renderCheckrideCountdown()`), but no scheduled job sends anything based on
it today.

**Recommended approach:** move milestone/inactivity/countdown emails to a
single scheduled Edge Function (cron-triggered, e.g. daily) that queries
each condition server-side and writes/checks `portal_email_log` as the one
source of truth, rather than depending on the member's browser being open
at the right moment. This is a real architecture change, not a small patch
— sequence it as its own effort.

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
