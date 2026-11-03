# Bug Sweep — Full Codebase (November 2026)

## Scope

Requested scope: "a full bug sweep" — no area excluded this time. Four
areas reviewed in parallel, each read end to end (not diffs):

1. `portal/supabase/functions/*` (~25 Edge Functions not already deeply
   covered by BUG_SWEEP_2026_09_REPORT.md or this session's prep-pack
   sprint) + the SQL/RLS they depend on + live Supabase advisors.
2. `portal/src/**` — the member/admin React portal.
3. `site/` — the functional/logic-bearing pages (forms, auth, checkout;
   not the ~200 purely-informational content/city pages, which don't
   carry this kind of bug and were separately swept for stale content in
   PR #262).
4. `mobile-expo/` — the Expo/React Native native app, not covered by any
   prior sweep.

Branch: `claude/bug-sweep-fixes-3` (off `main`, post PR #266). Six
commits fix the seven issues below; nothing has been merged or deployed.

## Fixed in this branch

### 1. `mobile-expo/hooks/useBootstrap.ts` — concurrent-refresh race (same bug class as the Sept AuthContext fix)
The `inFlight` dedup guard was plain React state, read-but-not-yet-
committed by a second caller in the same tick. Several screens share one
`useBootstrap()` instance via `BootstrapContext`, so two near-simultaneous
triggers (e.g. a save-callback refresh racing a pull-to-refresh) could
both see `inFlight === false` and both fetch — whichever response
*resolved* last won, regardless of which request started last. Concretely,
a purchase-triggered refresh resolving after a slower, earlier refresh
could flip `entitled` back to stale `false`, re-gating practice/oral
screens until the next successful refresh. Fixed with a ref-based guard
(synchronous, not state) plus a monotonic request-id that discards any
response superseded by a newer request. One new regression test
(back-to-back same-tick `refresh()` calls → exactly one fetch, final data
matches the later-started request).

### 2. `portal/src/App.jsx` — `/ground-schedule` had no route guard
Every sibling route is wrapped in `<ProtectedRoute>` (the few that aren't
are explicitly token/credential-gated by design). `/ground-schedule`
rendered `GroundSchedule.jsx` — which does real admin scheduling/editing
(client-gated on `profile?.role === 'admin'`) and student sign-up/waitlist
actions — with no wrapper at all, so any anonymous visitor who navigated
there directly got the full page instead of a redirect to `/login`.
Wrapped in a plain `<ProtectedRoute>` (any authenticated role, matching
the page's own existing `isAdmin` branching for admin vs. student views —
this closes the anonymous-access gap without changing behavior for any
real student/instructor/admin user).

### 3. `portal/src/context/AuthContext.jsx` — a failed profile fetch was indistinguishable from "no profile"
`fetchProfile()` destructured only `data` from the `profiles` query,
discarding `error` entirely. A failed fetch (RLS hiccup, transient network
error, a just-created profile row not yet visible) set `profile` to `null`
under a `loading: false` flag — exactly as if the user genuinely had no
profile row. Every role-gating consumer (e.g. `PortalSelector.jsx`
defaulting an unknown role to `'student'`) had no way to tell "we don't
know yet" apart from "this user has no role." Now exposes a distinct
`profileError` on the context; this is additive only — no existing
consumer reads it yet, so no downstream behavior changes from this fix
alone. (Whether `PortalSelector` should actually use it to avoid bouncing
a real admin/instructor out on a transient failure is its own decision —
see below.) One new regression test.

### 4. `site/portal-login.html` — forgot-password fallback silently dropped the `dest=checkride-prep` deep link
When a free-signup's welcome email fails to send (an acknowledged real
failure mode), the UI offers a "Reset Password" fallback. That fallback's
`resetPasswordForEmail()` call hardcoded a bare redirect with no `dest`
param, unlike the primary welcome-email path which threads `dest` all the
way through to the personalized unlock offer. A member who signed up
specifically via `?dest=checkride-prep`, hit the email failure, and used
this fallback landed on the generic dashboard instead of the offer they
asked for. Fixed to read and forward `dest` the same way every other entry
point on this page already does.

### 5. `portal/supabase/functions/capture-waitlist-lead/index.ts` — unescaped `.ilike()` on user input
The dedup check for this public, unauthenticated waitlist form passed the
submitted email straight into `.ilike()` with no wildcard escaping, unlike
every other `.ilike()` dedup check in this codebase (all of which use the
established `escapeIlike()` helper for exactly this reason). An email
containing a literal `%` or `_` (rare but RFC-valid) could false-positive
match an unrelated lead, and the function then silently reports success
without ever inserting the real lead. Added the same `escapeIlike()`
pattern used elsewhere.

### 6. `portal/src/pages/Login.jsx` — wrong domain in the "back" link
`https://apexaviation.com` → `https://apexaviationtx.com` (every other
reference in this codebase, including this same file's sibling logic,
uses the `tx` domain; isolated typo, confirmed via repo-wide grep).

### 7. `portal/supabase/functions/mobile-iap-verify-purchase/index.ts` — stale header comment
Said "NOT YET DEPLOYED"; confirmed via `list_edge_functions` it's
`ACTIVE` at version 17+. Not a behavioral bug, but misleading to a future
reviewer of this entitlement-granting path. Corrected.

All 513 `portal/` vitest tests pass, all 814 `mobile-expo/` jest tests
pass (ran the full mobile suite twice after the fix to rule out a flaky
run elsewhere in the suite that reproduced once and not on either retry —
not related to this change; not chased further, out of scope for this
sweep), plus `oxlint`/`node --check`/`tsc --noEmit` clean on every touched
file.

## Found, NOT fixed — needs a decision before touching payment/auth-adjacent code

### Carried forward from BUG_SWEEP_2026_09_REPORT.md — re-verified against current code, still unfixed
1. **Ground school double-charge still has no refund path.**
   `confirm_scheduled_ground_class_enrollment`/legacy path still returns
   success on a duplicate registration (by design, for retry-safety), and
   `stripe-webhook` still only refunds on an RPC *error* — so a genuine
   double-charge (double-click/double-tab) is still never refunded.
2. **`checkride_prep_unlocked`/ground-school-pack boolean entitlements
   still have no double-charge protection.** `create-checkout-session`'s
   entitlement pre-check is still a non-atomic check-then-act; two
   concurrent checkout starts can both succeed, both charge, with no
   alert. Same unfixed gap, same class as the already-protected Study
   Pack path.
3. **Subscription webhook events still applied with no recency check.**
   `handleSubscriptionUpdated`/`handleSubscriptionDeleted` still update
   unconditionally on event type; a late-arriving `updated` event can
   still silently restore access after a `deleted` event revoked it.
4. *(Not re-verified this round: the Sept report's #3, "membership
   signup can create two simultaneous Stripe subscriptions" — this sweep
   didn't specifically re-check that path. Flagging that it was never
   confirmed fixed either, rather than silently dropping it.)*

### New this round
5. **`get_checkout_session_amount(p_stripe_session_id text)` has no
   ownership check** — any caller holding (or guessing) another
   customer's Stripe session id can read that purchase's exact
   `amount_cents`. This is the exact gap the Sept advisor sweep already
   flagged as "low severity, not urgent," confirmed still open. Low
   severity (no access or money moves), trivially fixable in isolation,
   but its real callers (confirmed to include `anon`, e.g. a post-checkout
   success page) need checking before tightening it blind.
6. **`mobile-expo/hooks/useCheckridePrepPurchase.ts`'s `restore()`** reads
   a stale closure of `availablePurchases` instead of the array its own
   `getAvailablePurchases()` call just fetched — a learner restoring
   purchases after a reinstall/device switch can be told "no previous
   purchase found" even though a valid one exists, with no
   system-provided recovery path. Needs the installed `expo-iap` v6
   library's actual `getAvailablePurchases()` return contract verified
   before patching (not confirmable from this checkout — the package
   isn't installed) — fixing this blind risks getting it wrong in a
   worse direction than leaving it flagged.
7. **`portal/src/pages/Students.jsx`'s `handleCreate`** calls
   `supabase.auth.signUp()` directly from the admin's own authenticated
   session (which immediately switches the client's active session to the
   brand-new student account), then calls `setSession()` to restore the
   admin's session back — without checking whether that restore call
   itself succeeded. On a network blip or near-expired token, the admin
   is silently left signed in as the new, unprivileged student account
   with no error shown. The robust fix is moving user creation server-side
   (`supabase.auth.admin.createUser()` in an Edge Function, never touching
   the admin's own client session) rather than patching the client-side
   session dance — a real redesign, not a one-line fix, hence flagged
   rather than touched.
8. **Repo hygiene, not a functional bug:** a `zz-scratch-multifile-test`
   Edge Function is live in production — a leftover from an earlier
   debugging session in this same conversation (used to test whether
   `deploy_edge_function` merges files across calls; it doesn't). Harmless
   but should be deleted; no deletion tool was available this round.
9. **Governance gap, resolved as harmless:** `admin-provision-review-
   account` is deployed live with zero trace in this repo's git history.
   Read its actual deployed source directly — it's a deliberately disabled
   stub (unconditional `410 Gone`) left in place so the slug can't be
   silently re-registered. Its own comment points to git history that
   doesn't exist in this repo (likely lost in the pre-monorepo-merge
   squash per the root `README.md`'s "formerly separate repos" note).
   Informational only, not a live risk.
10. **Mock Oral giveaway's migration lives outside the established
    convention** — `supabase/migrations/20261021_mock_oral_giveaway_
    entries_DRAFT.sql` (repo root) instead of `portal/supabase-portal-
    schema-vN.sql` (every other feature's numbered convention), and is
    still named `_DRAFT` despite being live in production. Discoverability
    issue, not a functional bug.

## Checked and confirmed clean (no action needed)
- `mobile-iap-verify-purchase` / `apple-app-store-notifications`: real
  Apple JWS/cert-chain verification, correct race handling via unique
  constraint + re-check, no client-supplied-receipt trust.
- All `mobile-*` content/practice/review functions route through
  `_shared/premiumAccess.ts`'s `hasPremiumAccess()` consistently — no
  bypass found.
- `mobile-expo/contexts/AuthContext.tsx`: careful, well-guarded session
  handling; no equivalent of the web `AuthContext` race exists here (this
  context never carries the separate async profile fetch that caused the
  web-side bug).
- Entitlement gating in `mobile-expo/app/(app)/practice` and `/oral`:
  consistently checks `bootstrap.ready && bootstrap.entitled` before
  rendering gated UI and before firing any fetch.
- `site/portal-stable.js`'s `showSection()`, `site/email-preferences.html`
  — Sept sweep's fixes confirmed still intact, no regression.
- `site/mock-oral-giveaway.html` (new, unreviewed before this sweep) —
  double-submit protection correct, intentional `verify_jwt=false`
  confirmed via its own comment + CORS headers, entry-period deadline
  consistent with the rules page and the Nov 10 extension.
- Live Supabase advisors: 0 ERROR-level. `rls_enabled_no_policy` (5
  tables) confirmed by-design — all are service-role-only tables with no
  `anon`/`authenticated` consumer. The ~153 `SECURITY DEFINER`-
  executable-by-anon/authenticated findings are the same accepted
  linter-noise pattern already spot-verified by the Sept sweep, beyond
  the one real, known gap (#5 above).

## Recommendation
The seven fixes above are isolated, tested, and ready to review/merge
independently. The carried-forward payment races (#1-3) and the new
Students.jsx session-hijack risk (#7) all touch live financial or
auth-session state and need a real decision (and in the payment cases, a
migration) before anyone touches them — same reasoning as the Sept
report gave for not rushing those. #6 (IAP restore) needs the actual
`expo-iap` library contract checked first. #5 (`get_checkout_session_
amount`) needs its real anon call site(s) checked before tightening.
