# Apple In-App Purchase for Checkride Prep — Audit & Implementation Plan

Branch: `claude/apple-iap-checkride-prep` (created, no application changes yet — plan only, pending approval)
Status: **Phase 1 (audit) complete. Phases 2–6 below are a plan, not yet implemented.**

---

## Phase 1 — Audit findings

### 1.1 Existing entitlement, purchase, and authentication systems

- **Auth**: Supabase Auth, email/password. Mobile app: `mobile-expo/contexts/AuthContext.tsx` (session via `supabase.auth`), `mobile-expo/lib/largeSecureStore.ts` (AES-encrypted session persistence, key in iOS Keychain via `expo-secure-store`).
- **Entitlement, single source of truth**: `profiles.checkride_prep_unlocked` (boolean). Protected by a database trigger (`lock_profile_privileged_columns()`) that silently reverts any write to this column unless the writer is `service_role` or an admin — **a client (including an authenticated student's own session) can never set this column directly, only a server-side Edge Function running with the service-role key can.** This is the correct, existing security boundary and the new Apple-purchase handler must use it the same way.
- **Mobile entitlement surface**: `mobile-bootstrap` Edge Function reads `profiles.checkride_prep_unlocked` and returns it as `access.checkride_prep: boolean` in `MobileBootstrapDTO` (`shared/mobile-dto/index.ts`). `mobile-expo/contexts/BootstrapContext.tsx` exposes this as `entitled`. **Nine+ screens** (`acs.tsx`, `practice/*`, `oral/*`, `library/*`, `review/*`, `ground-school/*`, `training-report/*`) already gate on `bootstrap.entitled` and render `<LockedState />` (`components/StateViews.tsx`) when false.
- **Conclusion**: because the mobile entitlement check is just "read the one boolean column," **a new Apple-purchase handler that writes `checkride_prep_unlocked = true` through the exact same trigger-respecting path Stripe's webhook already uses requires zero changes to `mobile-bootstrap` or to any of the nine gated screens.** This is the cleanest possible integration point and satisfies the "shared entitlement checks for both Stripe and Apple" requirement almost for free.

### 1.2 Existing Checkride Prep product, price, and access representation

- **Not a fixed price.** `get_checkride_prep_pricing(p_profile_id)` (Postgres function, `SECURITY DEFINER`) computes one of three tiers dynamically:
  - `founding`: **$29.00**, first 25 purchases only (counted from `portal_access_purchases` + in-flight `checkout_session_attempts`), until an early-access deadline.
  - `launch`: **$29.00**, for any profile within 48 hours of its own `created_at`, until the same deadline.
  - `standard`: **$49.00**, otherwise (and unconditionally after the early-access deadline, currently `2026-10-11T03:59:00Z`).
- **This dynamic, per-user, time-windowed pricing cannot be replicated by Apple IAP.** An IAP non-consumable has one price (or a scheduled price change you configure in App Store Connect), decided before purchase, never computed server-side per user at purchase time. **This is a real product decision, not a code problem — see "Open decisions" below.**
- **Access representation**: `profiles.checkride_prep_unlocked = true`, set by `stripe-webhook/index.ts`'s `handleUnlockCheckridePrep()`, which also writes:
  - `portal_access_purchases` (`profile_id`, `email`, `full_name`, `stripe_session_id` **UNIQUE**, `amount_cents`, `tier` CHECK IN `('founding','launch','standard')`) — the idempotency guard (catches Postgres `23505` on the unique `stripe_session_id`) and the founding-seat counter both live here. **This table's shape is Stripe-specific (`stripe_session_id` UNIQUE NOT NULL semantics, `tier` CHECK constraint with no room for a 4th "apple" value that would conflate payment platform with pricing tier) — Apple purchases should get their own table, not be forced into this one.**
  - `invoices` (`student_id`, `product`, `amount_cents`, `status` CHECK IN `('unpaid','paid','pending')`, `stripe_session_id` — **nullable, no unique constraint**). This table is already deliberately platform-agnostic (`ground_registrations`, a completely different source, already feeds the same table) and is exactly what the existing `verified_purchases` view reads from:
    ```sql
    select student_id::text as uid, product, amount_cents, issued_at as paid_at, stripe_session_id
    from invoices where status = 'paid' and product is not null
    ```
    **An Apple-sourced `invoices` row (`product = 'checkride_prep'`, `stripe_session_id = NULL`) flows into `verified_purchases` and the downstream `canonical_paid_transaction_attribution` view automatically, with zero changes to either view, and with zero double-counting risk** (it's a new row, not a duplicate of any Stripe row).
  - `portal_events` (`premium_unlocked` analytics event).
  - A confirmation email.

### 1.3 Native app's current purchase-related UI

**There is none, by design.** From the prior crash-fix audit (confirmed again here): `components/StateViews.tsx`'s `LockedState` is a deliberate dead end —
> "Sprint 1A has no in-app purchase flow, so this is deliberately a dead end with NO url/price/checkout/browser steering of any kind."

No screen in `mobile-expo/app/` has a Buy/Checkout/Purchase button anywhere. Every `Linking.openURL` call in the app (there are exactly two — "Open Settings" and the Privacy Policy link) was already audited in the TestFlight crash-fix report; still true. This means Phase 2/4 is pure greenfield UI — no existing purchase-steering code needs to be removed, and nothing here conflicts with Apple's rule against pointing to external purchase flows for digital content (3.1.1), since none exists today.

### 1.4 Safest StoreKit-compatible library for Expo SDK 57 / RN 0.86

Checked npm registry metadata directly (not from memory):

| Library | Latest | Peer deps | Notes |
|---|---|---|---|
| **`expo-iap`** | 5.8.3 | `expo: *`, `react-native: *`, `react: *` (unpinned peers) — but its own **devDependencies are `expo ^57.0.12`, `react-native 0.86.2`, `react 19.2.3`** | Actively developed against the *exact* SDK/RN/React combination this project uses. Expo's own official in-app-purchases guide names it alongside RevenueCat. Ships an Expo config plugin (`"expo-iap"` in `app.json` plugins — same pattern this project already uses for every other native module). Implements the OpenIAP spec, which covers non-consumables **and** auto-renewable subscriptions through the same API — directly relevant to "must support multiple product/entitlement types without a major rewrite." No third-party backend/vendor involved — purely a client StoreKit wrapper, which fits the task's explicit ask for *us* to do server-side verification and handle Apple's notifications directly. Requires a development build (this app already builds via EAS, never Expo Go, so this is a non-issue). Requires `ios.deploymentTarget` ≥ **16.4** (current `app.json` has no `ios.deploymentTarget` set at all — needs adding) and an iOS **In-App Purchase** capability added to the generated Xcode project (handled by the config plugin during `expo prebuild`, which is what `eas build` runs internally for a managed/CNG project like this one — no manual Xcode step for an EAS cloud build). |
| `react-native-purchases` (RevenueCat) | 10.12.2 | `react-native >= 0.73.0`, no Expo constraint; dev-pinned to **RN 0.78** internally (older than this project's 0.86) | Mature, widely used, but brings in a third-party purchase-management backend/vendor. Verification and (optionally) webhooks would partly run through RevenueCat's servers rather than Apple's App Store Server API directly — doesn't match the task's explicit Phase 3 ask for *our own* server-side verification and *our own* handling of Apple's App Store Server Notifications V2. Has a real cost beyond a free tier. Looser version match to this exact RN/Expo combination. |

**Recommendation: `expo-iap`.** It's the tighter version match, it's Expo's own current-generation recommendation, it has no vendor/cost dependency, and it leaves verification and notification-handling exactly where the task wants it — in our own Supabase Edge Functions, against Apple directly.

### 1.5 Existing Stripe webhook / Supabase entitlement infrastructure to reuse

- **Idempotency pattern** (`stripe_webhook_events`: `event_id` PK, `event_type`, `status`, `attempt_count`, `last_error`, `processed_at`) — proven, has its own regression test (`stripeWebhookRetry.test.js`) from an earlier hardening sprint. **Plan: mirror this exactly** for Apple notifications (`notificationUUID` as the PK instead of Stripe's `event_id`).
- **`verified_purchases` / `canonical_paid_transaction_attribution` views** — already platform-agnostic (union across `invoices` + `ground_registrations`); an Apple-sourced `invoices` row slots in with no view changes (confirmed in 1.2 above).
- **`is_admin(auth.uid())` + `SECURITY DEFINER` function pattern** — reused for any new admin-facing read of Apple transaction records.
- **Edge Function conventions** (confirmed by reading `stripe-webhook/index.ts`, `create-checkout-session/index.ts`): `esm.sh/<pkg>@<version>?target=denonext` for Node-targeting npm packages (not `?target=deno` — this codebase already hit and documented the exact reason: `Deno.core.runMicrotasks` incompatibility with plain `?target=deno`). CORS header object, `jsonError()` helper, service-role `createClient()`, non-fatal best-effort email/analytics inserts after the entitlement write succeeds.
- **`admin-provision-review-account`** — confirmed (from an earlier session) to exist live on this Supabase project as a deployed Edge Function, though its source isn't checked into this repo. Relevant to Apple review access (demo account), not to this phase's build, but worth knowing it already exists.

### 1.6 App Store purchase requirements and potential review blockers

- **Guideline 3.1.1 (In-App Purchase)**: digital content/services must be purchased via IAP, not steered to an external payment flow, inside the app. The mobile app currently has zero purchase flow (1.3), so there's nothing to remove — just something to add correctly.
- **Non-consumable product type** is correct for "unlock once, keep forever" Checkride Prep access (matches `checkride_prep_unlocked`'s own semantics — a boolean that, once true, never goes back to false except via an explicit admin/refund action).
- **Restore Purchases is mandatory** for any non-consumable (Apple review checks for this explicitly) — must be a visible, working button, not just automatic-on-launch restoration.
- **No dual pricing / no price shown that doesn't match StoreKit** — the task's own Phase 2 instruction ("do not hardcode product pricing... retrieve localized product information from StoreKit") is the correct approach and also what Apple requires: the displayed price must be the real, localized StoreKit price, not a hardcoded `$29`/`$49` string that could drift from what Apple actually charges in a given country/currency.
- **The pricing-tier mismatch (1.2) is itself a potential review/business-logic risk** if not resolved before submission — not an App Review *rejection* reason by itself, but a real product inconsistency between what iOS users and web users pay for the identical product, worth a deliberate decision (below).
- **Server-to-server verification is required**, not just trusting the client's "purchase succeeded" callback — this is both an App Review expectation (anti-fraud) and explicitly required by the task.
- **Paid Apps Agreement / banking / tax** in App Store Connect must be active before *any* IAP product can go live — this is an account-level prerequisite, not something I can verify or complete from this repository; flagged for Phase 6 and for the user to confirm directly in App Store Connect.
- **Demo account for App Review**: already flagged in the TestFlight crash-fix report as a gap (no in-app account creation, no confirmed reviewer credentials in App Store Connect's notes). Adding a paid-content IAP makes this more acute — if Apple's reviewer account doesn't already have `checkride_prep_unlocked = true`, they can't review the "already purchased" experience without actually completing (or being granted) a real purchase.

---

## Open decisions (need your input before implementation)

These aren't things I can safely decide unilaterally — they're product/business calls:

1. **IAP price.** Apple needs one price (or a scheduled price-point change), not three dynamic tiers. Options: (a) launch IAP at the current `standard` price ($49) and treat web's founding/launch pricing as a time-limited promotion specific to the web channel; (b) launch IAP at $29.99 (closest App Store price point to $29) as a flat "early adopter" price for everyone who buys via iOS, with no founding-seat counter on the iOS side; (c) something else. I'd lean toward (a) for simplicity (no cross-platform-fairness complaints, matches what "standard" already means) **but this is your call, not mine.**
2. **`expo-iap` vs. RevenueCat.** I'm recommending `expo-iap` (1.4) — confirm you're fine with a library with no vendor backend, meaning *we* own Apple JWS verification and Apple's App Store Server Notifications entirely (more code on our side, zero third-party cost/dependency/lock-in).
3. **Apple's official verification library in Deno.** Apple publishes `@apple/app-store-server-library` (Node-targeted, depends on `node-fetch`/`jsonwebtoken`/`jsrsasign`). This codebase already successfully imports Stripe's own Node SDK into a Deno Edge Function via `esm.sh/stripe@14?target=denonext`, so the plan is to try the same approach for Apple's library first. If that import doesn't transform cleanly for Deno (real risk — untested combination, and `jsrsasign` in particular is a less common choice for edge/serverless crypto), the fallback is a hand-written JWS/x5c-chain verifier against Apple's root certificate using `jose` (a Deno-native, ESM-first library already proven in edge runtimes). **I'll determine which path actually works during implementation and report back — this can't be fully settled without writing and running the code**, but it doesn't change the external architecture (the Edge Function's inputs/outputs/schema are identical either way).
4. **Reviewer/demo account.** Confirm whether App Store Connect's review notes already have working credentials, and whether that demo account should have `checkride_prep_unlocked` pre-set to true (so the reviewer sees the "already purchased" experience, not just the purchase sheet) — I can help provision this via Supabase once you confirm.

---

## Phase 2 — Apple IAP (plan)

**Product**: one non-consumable, identifier `com.apexaviationtx.advantage.checkrideprep`.

**Client library**: `expo-iap` (1.4). Install via `npx expo install expo-iap`, add `"expo-iap"` to `app.json`'s `plugins` array, add `"ios": { "deploymentTarget": "16.4", ... }` to `app.json` (currently unset).

**New files** (plan, not yet written):
- `mobile-expo/lib/iap/storeKit.ts` — thin wrapper around `expo-iap`'s connection lifecycle (`initConnection`/`endConnection`), `getProducts([PRODUCT_ID])` for localized price/title/description, `requestPurchase()` with an `appAccountToken` set to the signed-in student's own `auth.uid()` (the mechanism that lets Apple's server notifications be mapped back to the correct Supabase profile *without trusting anything the client asserts* — Apple echoes this token back in the verified, signed transaction payload), and `getAvailablePurchases()` for Restore.
- `mobile-expo/hooks/useCheckridePrepPurchase.ts` — owns purchase/restore/loading/error/cancelled state (mirrors the existing `usePushRegistration.ts` "generation counter" pattern already in this codebase for guarding against stale/overlapping async operations — e.g. a double-tap on Purchase, or a sign-out mid-purchase).
- `mobile-expo/app/(app)/checkride-prep/unlock.tsx` — the purchase screen (Phase 4).

**Required behaviors** (StoreKit-native, handled by `expo-iap` + our wrapper):
- Native Apple purchase sheet (StoreKit's own UI — not a custom one; Apple requires this).
- Loading state while `getProducts`/`requestPurchase` are in flight.
- Cancellation: StoreKit resolves/rejects distinctly for user-cancelled vs. a real error — surfaced as its own state, not a generic error.
- Error handling: network failure, StoreKit unavailable (e.g. restricted by parental controls), product not found/misconfigured.
- Restore Purchases: calls `getAvailablePurchases()`, re-submits any found Checkride Prep transaction to the same backend verification endpoint as a fresh purchase would (idempotent — see Phase 3 — so restoring an already-applied purchase is a safe no-op).
- Duplicate-purchase prevention: (a) client-side, the purchase button is disabled once `bootstrap.entitled` is already true (no reason to show it at all — see Phase 4); (b) server-side, the *real* guard — `transactionId`/`originalTransactionId` uniqueness in the new Apple transactions table (Phase 3), so even a client bug or a replayed request can't double-grant or double-charge.
- Reinstall / device change: a non-consumable's entitlement lives in the user's Apple ID, not the device — `getAvailablePurchases()` after a fresh install (once signed in to the same Apple ID) returns the prior transaction, which Restore Purchases re-submits to our backend, which re-confirms the already-`checkride_prep_unlocked = true` profile (or sets it true if, e.g., a different Supabase account on the same device is now signed in — see the account-switching note in Phase 3.8).
- **No Stripe steering inside the native purchase screen** — it shows only the IAP product/price/Purchase/Restore, nothing else (satisfies the explicit instruction and Guideline 3.1.1).

---

## Phase 3 — Backend entitlement integration (plan)

### New Supabase schema (additive only — new tables/columns, nothing existing altered)

```sql
-- Apple App Store Server Notifications idempotency ledger.
-- Mirrors stripe_webhook_events exactly (same proven pattern).
create table apple_notification_events (
  notification_uuid text primary key,
  notification_type text not null,
  subtype text,
  status text not null default 'received', -- received | processing | processed | failed
  attempt_count integer not null default 0,
  last_error text,
  raw_payload jsonb not null,  -- the verified, decoded payload, for audit/replay
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- The durable, Apple-specific transaction ledger -- the detailed record
-- Stripe's checkout_session_attempts/portal_access_purchases play for
-- web purchases, kept separate (not forced into those Stripe-shaped
-- tables -- see 1.2) because an Apple transaction has no stripe_session_id
-- and no founding/launch/standard tier concept.
create table apple_iap_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  product_id text not null,               -- e.g. com.apexaviationtx.advantage.checkrideprep
  transaction_id text not null unique,    -- Apple's transactionId -- THE idempotency key
  original_transaction_id text not null,  -- links renewals/refunds back to the original purchase
  purchase_date timestamptz not null,
  environment text not null check (environment in ('Sandbox', 'Production')),
  amount_cents integer,                   -- from the verified transaction when available
  currency text,
  status text not null default 'active' check (status in ('active', 'revoked', 'refunded', 'expired')),
  -- Deliberately present now, even though Phase 2 only ships a
  -- non-consumable: an auto-renewable subscription's row uses the same
  -- columns (expires_at populated, status transitions on renewal/
  -- expiry/billing-retry) instead of a second table or a schema change.
  expires_at timestamptz,
  revocation_reason text,
  raw_transaction_info jsonb not null,    -- verified, decoded signedTransactionInfo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on apple_iap_transactions (profile_id);
create index on apple_iap_transactions (original_transaction_id);

-- RLS: a student can read their OWN transactions (for an "already
-- purchased" UI state); only service_role/admin can write -- same
-- is_admin()/service_role pattern as every other privileged table.
alter table apple_iap_transactions enable row level security;
create policy "Students can view their own Apple transactions"
  on apple_iap_transactions for select using (auth.uid() = profile_id);
```

No change to `profiles`, `invoices`, `portal_access_purchases`, `checkout_session_attempts`, `verified_purchases`, or `canonical_paid_transaction_attribution` — all additive, as instructed.

### New Edge Functions (plan)

1. **`verify-apple-purchase`** — called by the client (authenticated) immediately after `requestPurchase()`/`getAvailablePurchases()` resolves, with the signed transaction JWS from StoreKit.
   - Verifies the JWS signature against Apple's certificate chain (3 of "Open decisions" above) — **never trusts the client-decoded fields, only the result of our own signature verification.**
   - Confirms `appAccountToken` in the verified payload matches `auth.uid()` of the caller's own session (the anti-forgery boundary — a client cannot claim someone else's purchase, because the token is embedded in Apple's *signed* payload, set at the original purchase time, not re-submitted as a trustable parameter now).
   - Upserts into `apple_iap_transactions` keyed on `transaction_id` (idempotent — a resubmitted Restore for an already-recorded transaction is a safe no-op).
   - Sets `profiles.checkride_prep_unlocked = true` via the service-role client (same trigger-respecting write Stripe's webhook already does).
   - Inserts one `invoices` row (`product = 'checkride_prep'`, `stripe_session_id = null`) — flows into `verified_purchases` automatically (1.2).
   - Inserts a `portal_events` row (`premium_unlocked`, `metadata: { source: 'apple_iap', ... }`) for the same analytics dashboard Stripe purchases already feed.
2. **`apple-app-store-notifications`** — the actual App Store Server Notifications V2 webhook endpoint, registered in App Store Connect (Phase 6).
   - Verifies the outer JWS, decodes `notificationType`/`data.signedTransactionInfo`/`data.signedRenewalInfo`.
   - Idempotency via `apple_notification_events.notification_uuid` (mirrors `stripe_webhook_events` exactly).
   - `REFUND` / `REVOKE`: sets the matching `apple_iap_transactions.status`, and — this is the one place Apple can take access away — sets `profiles.checkride_prep_unlocked = false` **only if no other still-valid entitlement source exists for that profile** (i.e., never silently revoke a student who *also* separately bought via Stripe — see 3.6 below).
   - `CONSUMPTION_REQUEST`: not applicable to a non-consumable in the same way as a consumable, but Apple still expects a response within its deadline for refund-related consumption requests — the handler responds appropriately (details finalized during implementation against the real current API).
   - Everything else (`DID_RENEW`, `EXPIRED`, etc.) is a no-op for Phase 2 (no subscriptions yet) but the handler and schema already accommodate it for the future, per the task's explicit requirement.

### Addressing each Phase 3 requirement explicitly

1. **Server-side verification** → `verify-apple-purchase` + `apple-app-store-notifications`, both verify Apple's JWS before trusting anything (3 above).
2. **Secure mapping to the authenticated student** → `appAccountToken = auth.uid()`, checked against the verified payload, never the client's say-so.
3. **Idempotent transaction processing** → `transaction_id` UNIQUE + upsert in `apple_iap_transactions`; `notification_uuid` PK in `apple_notification_events`.
4. **App Store Server Notifications V2, including refund/revocation** → `apple-app-store-notifications` function (above).
5. **Durable record of purchase origin and product identifiers** → `apple_iap_transactions` (full `product_id`, `raw_transaction_info`, environment).
6. **Shared entitlement checks for Stripe and Apple** → both write the same `profiles.checkride_prep_unlocked`; `mobile-bootstrap` needs no changes (1.1).
7. **Protection against client-side entitlement forgery** → signature verification + `appAccountToken` check (2 above); the privileged-column trigger already blocks any direct client write regardless.
8. **Safe restoration and account-switching** → Restore re-submits to the same idempotent `verify-apple-purchase` path. Account-switching: if a *different* Supabase account signs in on a device that already has an Apple-side purchase, Restore Purchases would surface that prior transaction — `verify-apple-purchase` maps it to **whichever Supabase account is currently authenticated when Restore is tapped** (via `auth.uid()` at call time, matching the `appAccountToken` set at the time THAT purchase was made) — if the token on the historical transaction doesn't match the currently-signed-in user, the function must reject it rather than grant it to the wrong account; the precise UX for that edge case (a shared device, a second family member signing in) is called out as a test case in Phase 5 rather than guessed at here.

---

## Phase 4 — Student experience (plan)

New screen, `mobile-expo/app/(app)/checkride-prep/unlock.tsx`, reached from:
- `LockedState` (`components/StateViews.tsx`) gaining a "View Checkride Prep" action — the one, minimal-footprint change that gives all nine existing gated screens a path to purchase without touching any of their own gating logic.
- A new entry point from `app/(app)/profile.tsx` as well, so it's discoverable even outside a locked-content moment.

Screen contents:
- Apex navy (`#0B1F3A`) / gold (`#F4B400`) styling via the existing `constants/theme.ts` tokens (no new palette).
- Product title/description from `expo-iap`'s `getProducts()` result — **never hardcoded**, per the task's explicit instruction and Apple's own expectation.
- Localized price string from the same StoreKit response (handles currency/locale correctly for every App Store territory automatically — something a hardcoded `$29`/`$49` string could never do).
- Purchase button → `requestPurchase()`, with loading/disabled state while in flight.
- Restore Purchases button, always visible (mandatory per Apple review).
- Purchase confirmation state (success) → navigates back into the now-unlocked content.
- Error states: StoreKit unavailable, product fetch failed, purchase failed, verification failed (sent to our backend but rejected) — each a distinct, human-readable message, matching this app's existing `ApiError`/`ErrorState` conventions (`lib/api/errors.ts`, `components/StateViews.tsx`) rather than inventing a new error-presentation pattern.
- **Already-entitled students never see this screen's purchase UI** — `bootstrap.entitled` is checked first; an already-unlocked student who somehow navigates here sees a "You already have full access" state instead of a second purchase prompt (this is also what prevents a confusing double-purchase attempt, on top of the server-side idempotency guard).

---

## Phase 5 — Testing (plan)

New test files (Jest, matching this project's existing extraction/mocking conventions):
- `mobile-expo/test/useCheckridePrepPurchase.test.ts` — successful purchase, cancelled purchase, duplicate-transaction no-op, failed-verification error surfaced, restore-purchases happy path, missing/unavailable StoreKit products (empty `getProducts()` result handled gracefully, not a crash).
- `mobile-expo/test/CheckridePrepUnlockScreen.test.tsx` — already-entitled student sees no purchase UI; price/description render from a mocked StoreKit product rather than a hardcoded string (a real regression test that the price is never hardcoded).
- Backend (Deno/edge-function-shaped, following this repo's established extraction-and-execute convention used for `stripe-webhook`'s own tests): existing Stripe entitlement is never disturbed by an Apple purchase or by an Apple refund for a *different* purchase; Apple refund/revocation correctly flips `checkride_prep_unlocked` to false only when no other valid entitlement source exists; backend retry/idempotency (a notification or verification request delivered twice produces exactly one `apple_iap_transactions` row and exactly one `invoices` row); account-switching behavior (Phase 3.8).

Also run: `npx tsc --noEmit`, `npx expo lint`, `npx jest`, `npx expo-doctor`, plus whatever Supabase-side SQL harness test (matching this repo's `test/sql/*.sql` local-Postgres-harness convention, not applied to production) validates the new tables/RLS before any migration is proposed for approval.

**Apple sandbox / TestFlight test procedure** (documented in full at implementation time, summary now): create one or more Sandbox Apple IDs in App Store Connect → Users and Access → Sandbox Testers; sign into that Sandbox account in iOS Settings → App Store (not the regular Apple ID); run a development/TestFlight build; attempt a purchase (sandbox purchases are free but go through the real StoreKit flow and the real verification path); confirm `apple_iap_transactions`/`profiles.checkride_prep_unlocked` update correctly; test Restore Purchases by deleting and reinstalling the app under the same Sandbox Apple ID; test a sandbox-initiated refund (App Store Connect → sandbox test, or via Apple's sandbox refund testing tools) and confirm the notification handler revokes access correctly. **I will not claim any of this has actually passed unless a real sandbox or TestFlight transaction is actually run and its result observed — per the task's explicit constraint.**

---

## Phase 6 — App Store Connect (plan, exact steps to be handed over, not executed by me)

1. **Create the IAP product**: App Store Connect → the app → Monetization → In-App Purchases → "+" → **Non-Consumable**. Reference Name (internal), Product ID `com.apexaviationtx.advantage.checkrideprep`.
2. **Identifier/display name/description/price**: set the customer-facing display name and description (what shows in the native purchase sheet); choose a price tier (see "Open decisions" #1 above — this determines the actual tier picked here).
3. **Review metadata/screenshots**: a non-consumable IAP needs a review screenshot showing the purchase in context (App Store Connect will prompt for this) — I'll provide the exact screen/moment to screenshot once Phase 4's UI exists, since it should literally be that screen.
4. **App Store Server Notifications**: App Store Connect → the app → App Information (or App Store Server Notifications settings, depending on current ASC layout) → set the Production and Sandbox URLs to the deployed `apple-app-store-notifications` Edge Function's URL; select **Version 2**.
5. **Paid Apps Agreement / banking / tax**: App Store Connect → Agreements, Tax, and Banking — this is an account-level, legal/financial prerequisite that must already be (or become) active before any IAP can go live; I cannot complete or verify this step, it needs to be done directly by whoever administers the Apple Developer account.
6. **Submitting the first IAP with the app version**: a brand-new IAP must be submitted *together with* an app binary version for its very first review (subsequent price/metadata-only changes don't require a new binary) — so this ships as part of the next TestFlight/App Store build that includes Phase 2–4's code, not separately.

---

## Summary / what I'm asking approval for

Nothing has been implemented. This document is the complete Phase 1 audit plus a concrete plan for Phases 2–6. Before I write any code, I need:
1. Your decision on the 4 "Open decisions" above (price point is the one that actually matters most).
2. Explicit approval to proceed with implementation on this branch (already created: `claude/apple-iap-checkride-prep`).

Per the task's constraints, even after that approval: no merge to `main`, no backend migration applied to production, no new Edge Function deployed, and no new iOS build submitted — all of those are separate, later approval gates, and I will not claim sandbox/TestFlight purchase testing has passed without an actual observed transaction.
