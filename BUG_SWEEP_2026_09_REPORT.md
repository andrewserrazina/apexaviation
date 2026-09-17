# Bug Sweep — Active Production Surface (September 2026)

## Scope

Requested scope: "Active production surface" — portal/ backend + frontend
(payments, entitlements, auth, RLS policies, admin) and the email system.
Excludes `mobile-expo/` (separate, unmerged native app work) and `site/`
marketing pages beyond what's needed for context.

Four areas were reviewed in full (not diffs — the actual current file
content, read end to end):

1. Supabase security + performance advisors (live, against production).
2. `portal/src` React admin/portal frontend — auth context, protected
   routes, entitlement flags, role-gated pages.
3. `site/portal-stable.js` + `site/portal-login.html` — the vanilla-JS
   member portal's auth guard, section gating, and redirect logic.
4. The four payment/entitlement Supabase Edge Functions (`stripe-webhook`,
   `create-checkout-session`, `create-free-account`, plus adjacent
   functions in the same trust boundary) and the SQL RPCs they call.

Branch: `claude/bug-sweep-fixes-2` (off `main`, post the email-redesign
release in PR #254). Three commits fix the six issues below; nothing has
been merged or deployed.

## Fixed in this branch

### 1. `email-preferences.html` sign-in/error redirect loop
A signed-in member whose profile fetch failed was shown the *signed-out*
state, whose only action is a link to sign in — but `portal-login.html`
auto-redirects an already-signed-in visitor straight back to this page,
so a transient fetch failure became sign-in → redirect → same failure,
with no way out. Added a distinct error state with a retry button.

### 2. Gated-section deep link stranded members behind the unlock modal
`showSection()` in `site/portal-stable.js`: a locked member landing
directly on a `GATED_SECTIONS` hash (a bookmark, a shared link — anything
not routed through an in-app nav click) had that section marked `.active`
before member data loaded; once the gate check ran and correctly denied
access, it opened the unlock modal but never reassigned which section was
active, leaving the empty gated section visible once the modal closed.
Now falls through to `dashboard`, matching the existing guided-notes/
ask-andrew guards in the same function.

### 3. `AuthContext.jsx` loading/staleness races (React admin app)
Two related issues in the same file:
- `onAuthStateChange`'s `SIGNED_IN` branch updated `user` immediately but
  left `loading` at `false` while `fetchProfile()` was still in flight.
  A consumer reading `profile` in that window saw stale/null data under a
  "not loading" flag — concretely, `PortalSelector.jsx` defaults an
  admin's role to `'student'` when `profile` is `null` and immediately
  redirects them to the external student site, before their real role
  ever loads.
- `fetchProfile()` had no ordering guard — whichever of two in-flight
  requests resolved last won, regardless of which corresponded to the
  current user. A sign-out/sign-in on a shared device, or the admin
  `signUp()`/`setSession()` session-swap in `Students.jsx`, could apply a
  stale profile over a newer one.

Both fixed: `loading` is set `true` before the fetch starts, and a
"most recently requested user id" ref discards any response that's been
superseded. Two new tests cover both races.

### Minor / hygiene fixes bundled in
- `_shared/emailTemplate.ts`'s header comment only documented
  `stripe-webhook` as a byte-identical forced duplicate;
  `create-checkout-session` carries the same duplicate and was missing
  from the note.
- `send-lifecycle-emails`'s `emailTemplateReactivationInactive()` and
  `emailTemplateInactivity()` now compose from the shared
  `emailHeadline`/`emailParagraph`/`emailButton` components (added in the
  email redesign but never given a real call site) instead of
  hand-written inline HTML.

All 82 tests pass (`portal/` vitest suite, `npx vitest run`), plus
`node --check` / `oxlint` on the touched JS.

## Found, NOT fixed — needs a decision before touching payment code

The deep review of the payment Edge Functions surfaced four real gaps,
all in `stripe-webhook/index.ts`'s entitlement-granting handlers. Unlike
the three fixes above, these touch live financial/webhook logic already
deployed to production, and two of them need a new migration
(unique constraint + refund path), not just a code edit — so I stopped
short of changing them without checking scope/priority first:

1. **Ground school double-charge has no refund path.** The "already
   registered" idempotency check in `confirm_legacy_ground_registration`/
   `confirm_scheduled_ground_class_enrollment` silently returns success on
   a duplicate, but `stripe-webhook` only refunds when that RPC call
   *errors*. A double-click/double-tab race produces two real Stripe
   charges for one seat, with the second never refunded — unlike the
   identical race for Study Packs, which a DB unique constraint catches
   and auto-refunds today.
2. **No double-charge protection on the boolean-flag entitlements**
   (`checkride_prep_unlocked`, ground-school-pack unlock/upgrade). Two
   concurrent checkouts both succeed, both set the flag `true`
   (idempotent on the flag itself), both insert purchase/invoice rows —
   member charged twice, no refund, no alert. Same race class as #1 and
   as the already-protected Study Pack path, just missing the guard.
3. **Membership signup can create two simultaneous Stripe subscriptions.**
   The existing-subscription check in `create-checkout-session` isn't
   atomic with subscription creation; a double-submit before either
   subscription exists creates two live, separately-billing Stripe
   subscriptions with nothing that later reconciles or cancels the extra
   one.
4. **Subscription webhook events applied with no ordering guard.**
   `handleSubscriptionUpdated`/`handleSubscriptionDeleted` update
   `member_subscriptions.status` unconditionally on event type, with no
   check against event recency. Stripe doesn't guarantee delivery order —
   a late-arriving `updated` event (still reflecting pre-cancellation
   `active` state) can silently restore access after a
   `deleted`/cancellation event already revoked it.

Everything else in the payment path checked out: webhook signature
verification is real HMAC (not a presence check), the same-event-twice
case is correctly blocked by the `stripe_webhook_events` idempotency
ledger before any handler runs, all prices are resolved server-side
(never client-supplied), ownership checks are all derived from the
authenticated token (never client-supplied profile ids), no path grants
access without the DB write actually succeeding, and the Mock Oral slot
claim is a real atomic row-lock. The three-way byte-identity of
`_shared/emailTemplate.ts` across its two forced-inline duplicates was
also re-verified and holds.

## Supabase advisor sweep (read-only, already run against production)

~138 `SECURITY DEFINER`-grantable-to-anon/authenticated lint warnings —
spot-verified via direct `pg_get_functiondef()` reads that the flagged
`admin_*` and ownership-sensitive functions already have correct internal
checks (`is_admin(auth.uid())`, `profile_id = auth.uid()`), so this
category is overwhelmingly linter noise, not live bugs. One real (low
severity) gap found: `get_checkout_session_amount()` has no ownership
check on the session it looks up — worth closing but not urgent (it only
returns an amount, not access).

## Recommendation

The three fixed issues are low-risk, are tested, and are ready to review/
merge independently of the payment findings. The four payment findings
should be scoped as their own follow-up: #1 and #2 need a migration
(unique constraint, mirroring `study_pack_entitlements_active_unique`)
plus a refund-on-conflict code path; #3 needs either a DB-level unique
active-subscription constraint or a claim-row pattern; #4 needs an
event-recency check (Stripe sends `created` on every event) before
applying a subscription status update. None of these are safe to rush
through without live role-simulation testing against Stripe test mode,
given they touch real charges.
