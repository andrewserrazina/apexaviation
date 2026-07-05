# Launch Readiness Report — Apex Advantage

**Scope of this pass:** full codebase audit (auth, Stripe, gating, RLS,
email, analytics, account management, admin dashboards) + execution of
Phase 1 (premium content server-side enforcement). This report reflects
what was found, what was fixed, and what still needs a human with live
Supabase/Stripe dashboard access to verify — this sandbox has no
production access, so nothing below marked "not verified" was skipped by
choice; it's genuinely unreachable from here.

---

## Critical Issues

### 1. Premium content was fully public — **FIXED this pass**
`site/portal.js` was a public static file containing the entire paid
Checkride Prep System (72 questions, scenarios, quick-reference, lessons)
as plain-text JS. Anyone could read it without an account, let alone
payment. Fixed via `portal/supabase-portal-schema-v5.sql` (content moved
to DB tables, RLS-locked) + `get-premium-content` Edge Function (403s
unpaid callers, never returns partial data). See
`IMPLEMENTATION_PLAN.md` Phase 1 and `DATABASE_CHANGES.md` for full detail.

### 2. `ground_sessions`/`ground_registrations` RLS state is unknown — **FIXED in a follow-up pass**
These tables have no `CREATE TABLE` anywhere in the repo (created directly
in the Supabase dashboard) and are reachable from two public,
unauthenticated routes while holding PII and, since the freemium rework,
payment data (`stripe_session_id`, `amount_cents`, `payment_status`). Live
state was pulled directly from the Supabase dashboard (not guessed at) and
every policy on `ground_registrations` turned out to use `using(true)`/
`with_check(true)` — no real protection at all. Fixed via
`portal/supabase-portal-schema-v6.sql` plus three new token/registration
RPCs, verified against a real local Postgres instance. Full before/after,
policies, and test results in `GROUND_SCHOOL_RLS_AUDIT.md`.

### 3. Three RLS policies allowed self-moderation — **FIXED this pass**
`portal_referrals`, `portal_testimonials`, `portal_question_discussions`
each let a user flip their own row's admin-controlled status column
(self-approve a testimonial, fabricate an "Andrew answered this" FAQ
entry). Fixed via trigger functions in the v5 migration — see
`DATABASE_CHANGES.md`.

---

## High Priority Issues

### 4. Lifecycle emails only fire client-side, with no reconciliation — **FIXED this pass**
Readiness milestones, first-question, Checkride-Mode-complete, and
weak-area emails were all triggered from the browser on page load only. A
member who crossed a milestone without reopening the portal at the right
moment never got that email — there was no server-side job checking for
missed triggers. Fixed via the new `send-lifecycle-emails` Edge Function,
which recomputes every condition server-side on a schedule. See
`RETENTION_SYSTEM.md` and `IMPLEMENTATION_PLAN.md` Phase 3. **Still
requires a manual deploy + cron schedule in the Supabase dashboard before
it actually runs** — see Recommended Launch Checklist below.

### 5. `portal_email_log`'s stated purpose doesn't match its actual usage — **FIXED this pass**
The table's schema comment says it's the dedup log for all lifecycle
emails; only the weak-area nudge actually wrote to it. Fixed: both
`site/portal.js` and the new `send-lifecycle-emails` function now log
every one of the six existing email types (plus the two new ones) to
`portal_email_log`, regardless of which side actually sent it. See
`RETENTION_SYSTEM.md`.

### 6. The 7-day inactivity nudge's existence cannot be verified — **still requires a manual check**
Referenced only in a stale code comment as living in a separate Edge
Function in a different repo — that repo was merged into this monorepo
(see root `README.md`) and no such function exists anywhere in this
codebase. A new inactivity nudge now ships as part of `send-lifecycle-
emails` (Phase 3, see `RETENTION_SYSTEM.md`), but **it is still unknown
whether an old, undocumented version of this function is already deployed
directly in the Supabase project** (the same pattern `ground_sessions`/
`ground_registrations` turned out to follow). **Action required before
deploying the new function:** check the Supabase dashboard's Edge
Functions list for anything resembling an inactivity nudge and disable it
first, or members could get double-nudged by two independent jobs.

### 7. Referrals have no admin workflow — **FIXED this pass**
`portal_referrals.status` could only move from `pending` via direct
database edit — there was no UI to mark a referral `signed_up` or
`rewarded`, and (found while fixing this) **no RLS policy that would have
let anyone, admin included, do it through the normal client even with a
UI** — only the referrer's own-row policy existed, and the existing lock
trigger correctly stops the referrer from self-approving it. Fixed via a
new admin policy plus status-action buttons in the existing admin
dashboard. See `CONTENT_OPERATIONS.md`.

---

## Medium Priority Issues

### 8. No student-facing ground school session history — **FIXED this pass**
A student who registers and pays for a ground school session had no "My
Sessions" view showing their sessions in their own portal — this data
existed (`ground_registrations` linkable via the `profile_id` column
added in v4, readable via the RLS policy added in v6) but wasn't surfaced
back to them. Fixed via a new card in Account Management. See
`GROUND_SCHOOL_OPTIMIZATION.md`.

### 9. No post-attendance follow-up email sequence — **FIXED this pass**
After a ground school session, nothing automatically sent a follow-up.
Fixed via a new routine in the existing `send-lifecycle-emails` scheduled
function — deliberately without a "replay" link, since ground school has
no recording/replay system anywhere in this codebase (a real link would
be shipping a broken promise); it links to upcoming sessions and the
portal instead. See `GROUND_SCHOOL_OPTIMIZATION.md`.

### 10. Account page pricing/status copy hasn't had a full audit pass — **FIXED this pass (Phase 2)**
The main marketing funnel pages (`checkride-prep.html`, `apex-advantage.html`)
were updated for the free-signup model in the prior session pass. The
Account Management section itself had two real bugs beyond stale copy: the
Membership card hardcoded `"Apex Advantage — Founding Member"` for every
member regardless of what they'd actually bought, and the "$29 · Tap to
unlock" labels/unlock modal price were static HTML that never reflected
whether the 25 founding seats were still available — a member could see
"$29" and get charged $49 at checkout. Both now reflect real, live
per-member/per-tier state — see `IMPLEMENTATION_PLAN.md` Phase 2.

---

## Low Priority Issues

### 11. `LESSON_LIST` progress-tracking checkboxes show "undefined" for locked/free users
Cosmetic only — `renderProgress()` builds labels from `CATEGORY_META`,
which is empty for a member who hasn't unlocked Checkride Prep. The
Progress Tracking section is nav-gated for these users so this is never
actually visible, but the underlying DOM does get populated with
`undefined` text. Low priority because it's invisible in practice; worth a
quick guard if this section's gating logic ever changes.

### 12. `makeReferralCode()` has no collision retry
Client-generates a code and relies purely on the DB's `unique` constraint
to reject collisions — no retry-on-conflict loop. Low-probability given
the randomization scheme, but worth a retry loop for correctness.

---

## What was actually verified this pass (and how)

This sandbox cannot reach the live Supabase project or Stripe API — every
verification below used Playwright driving the real HTML/JS against a
hand-built mock of `window.apexSupabase`, not the production backend.

- ✅ Free signup → "check your email" flow
- ✅ Locked member: dashboard renders with zero JS errors, blurred
  widgets show correctly, gated nav items open the unlock modal instead of
  navigating, `get-premium-content` is correctly never called
- ✅ Unlocked member: `get-premium-content` fetch populates real content,
  DPE library and Scenario Training render actual fetched question/scenario
  text correctly
- ✅ Ground school registration flow (session list, capacity/waitlist
  detection, Stripe redirect attempt with correct metadata)
- ✅ Unlock-Checkride-Prep flow (modal → Stripe redirect attempt with
  correct purpose/tier metadata)

## What has NOT been verified (requires live access)

- Actual Stripe webhook delivery/signature verification against a real
  Stripe account
- Actual password-reset email delivery via Resend
- Actual referral signup attribution end-to-end
- Actual testimonial approval → Success Wall display end-to-end
- Whether a legacy inactivity-nudge function is already deployed in the
  Supabase project (see Issue #6 — check before deploying the new one)
- An actual scheduled run of `send-lifecycle-emails` against real member
  data (Phase 3 — see `RETENTION_SYSTEM.md`)
- Admin analytics dashboard against real, non-trivial data volume

---

## Recommended Launch Checklist

**Must do before launch:**
- [ ] Run `portal/supabase-portal-schema-v5.sql` in the Supabase SQL editor
- [ ] Deploy `get-premium-content` Edge Function (new)
- [ ] Run `portal/supabase-portal-schema-v6.sql` (ground-school RLS fix — see `GROUND_SCHOOL_RLS_AUDIT.md`)
- [ ] Run `portal/supabase-portal-schema-v7.sql` (billing/pricing RLS + pricing RPC — Phase 2)
- [ ] Run `portal/supabase-portal-schema-v8.sql` (retention system + profiles RLS fixes — Phase 3, see `RETENTION_SYSTEM.md`)
- [ ] Run `portal/supabase-portal-schema-v9.sql` (DPE content CMS + referral admin RLS — Phase 4, see `CONTENT_OPERATIONS.md`)
- [ ] Check the Supabase Edge Functions list for a legacy inactivity-nudge function before deploying the new one (Issue #6)
- [ ] Deploy `send-lifecycle-emails` and schedule it (dashboard cron or `pg_cron`/`pg_net` — see `RETENTION_SYSTEM.md`)
- [ ] Manually test the full signup → unlock → DPE library flow against the real, deployed site
- [ ] Manually test a real ground school registration + Stripe payment end to end

**Should do soon after launch:**
- [x] Build the server-side lifecycle-email reconciliation job (Issue #4) — see `RETENTION_SYSTEM.md`
- [x] Add admin UI for referral status (Issue #7) — see `CONTENT_OPERATIONS.md`
- [x] Reconcile `portal_email_log` to actually log all five (now seven) email types (Issue #5)

**Can wait:**
- [x] Student-facing ground school session history (Issue #8) — see `GROUND_SCHOOL_OPTIMIZATION.md`
- [x] Post-attendance follow-up emails (Issue #9) — see `GROUND_SCHOOL_OPTIMIZATION.md`
- [x] Full Account page copy audit (Issue #10) — Membership card, billing
      history, and locked-widget/unlock-modal pricing now reflect real
      per-member state instead of static copy; see `IMPLEMENTATION_PLAN.md`
      Phase 2
- [ ] Cosmetic/low-severity items #11–#12
