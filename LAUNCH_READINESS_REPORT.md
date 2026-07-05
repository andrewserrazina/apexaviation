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

### 4. Lifecycle emails only fire client-side, with no reconciliation
Readiness milestones, first-question, Checkride-Mode-complete, and
weak-area emails are all triggered from the browser on page load. A member
who crosses a milestone without reopening the portal at the right moment
never gets that email — there's no server-side job checking for missed
triggers. Recommend consolidating into one scheduled Edge Function (see
`IMPLEMENTATION_PLAN.md` Phase 3).

### 5. `portal_email_log`'s stated purpose doesn't match its actual usage
The table's schema comment says it's the dedup log for all lifecycle
emails; in practice only the weak-area nudge writes to it. The other four
email types dedupe against `portal_events` instead. An admin (or future
analytics dashboard) querying `portal_email_log` today would see an
incomplete picture and could draw wrong conclusions about email volume.

### 6. The 7-day inactivity nudge's existence cannot be verified
Referenced only in a code comment as living in a separate Edge Function in
a different repo, not present in this codebase. **Action required:**
confirm directly (Supabase dashboard → Edge Functions list) whether this
function actually exists and is scheduled/running before assuming
inactivity nudges work at all.

### 7. Referrals have no admin workflow
`portal_referrals.status` can only move from `pending` via direct
database edit — there's no UI (in the vanilla portal admin panel or the
React CRM) to mark a referral `signed_up` or `rewarded`. Ask Andrew and
testimonials both already have working admin inboxes; referrals are the
one gap in that pattern.

---

## Medium Priority Issues

### 8. No student-facing ground school session history
A student who registers and pays for a ground school session today has no
"My Sessions" view showing past/upcoming/purchased sessions in their own
portal — this data exists (`ground_registrations` linkable via the new
`profile_id` column added in v4) but isn't surfaced back to them.

### 9. No post-attendance follow-up email sequence
After a ground school session, nothing automatically sends a replay link,
related resources, or a premium-portal CTA. This is genuinely unbuilt, not
a bug — flagged here as a real revenue-adjacent gap (Phase 6).

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
- Whether the 7-day inactivity nudge function exists and runs at all (see
  Critical/High Issue #6)
- Admin analytics dashboard against real, non-trivial data volume

---

## Recommended Launch Checklist

**Must do before launch:**
- [ ] Run `portal/supabase-portal-schema-v5.sql` in the Supabase SQL editor
- [ ] Deploy `get-premium-content` Edge Function (new)
- [ ] Run `portal/supabase-portal-schema-v6.sql` (ground-school RLS fix — see `GROUND_SCHOOL_RLS_AUDIT.md`)
- [ ] Run `portal/supabase-portal-schema-v7.sql` (billing/pricing RLS + pricing RPC — Phase 2)
- [ ] Confirm the 7-day inactivity nudge function actually exists and runs (Critical/High Issue #6)
- [ ] Manually test the full signup → unlock → DPE library flow against the real, deployed site
- [ ] Manually test a real ground school registration + Stripe payment end to end

**Should do soon after launch:**
- [ ] Build the server-side lifecycle-email reconciliation job (Issue #4)
- [ ] Add admin UI for referral status (Issue #7)
- [ ] Reconcile `portal_email_log` to actually log all five email types (Issue #5)

**Can wait:**
- [ ] Student-facing ground school session history (Issue #8)
- [ ] Post-attendance follow-up emails (Issue #9)
- [x] Full Account page copy audit (Issue #10) — Membership card, billing
      history, and locked-widget/unlock-modal pricing now reflect real
      per-member state instead of static copy; see `IMPLEMENTATION_PLAN.md`
      Phase 2
- [ ] Cosmetic/low-severity items #11–#12
