# Apex Advantage — native app wrapper

A thin native shell (via [Capacitor](https://capacitorjs.com)) around the existing Apex Advantage member portal, for real iOS/Android App Store distribution.

## How this works

This is **not** a separate app to build and maintain — `capacitor.config.json`'s `server.url` points the native shell directly at the live production site:

```
https://advantage.apexaviationtx.com/portal-login.html
```

Every screen a member sees is loaded remotely, exactly like opening that URL in mobile Safari/Chrome, just inside a native app chrome with a home-screen icon. This means:

- Every change to `site/portal.html` / `site/portal-stable.js` shows up in the app immediately on next launch — **no app-store resubmission needed** for ordinary portal changes.
- `www/index.html` is **not** what members see. It's a one-time fallback Capacitor requires a local `webDir` to build from, shown only if the app somehow launches with no network connection.
- Supabase auth, Stripe Checkout redirects, and everything else behave identically to the mobile web experience, since it *is* the mobile web experience.

`server.allowNavigation` in `capacitor.config.json` whitelists `*.stripe.com` so that a full-page redirect to Stripe Checkout or the Stripe Billing Portal (both already used by `portal-stable.js` via `window.location.href`) stays inside the app instead of being blocked or kicked out to the system browser.

## Identity

- **App name**: Apex Advantage
- **Bundle ID / package name**: `com.apexaviationtx.advantage`

Both are set as of this build. The bundle ID is effectively permanent once you submit to either store — changing it later means a new app listing, not an update — so confirm it's what you want before your first real submission.

## App icon / splash screen

Generated from `portal/src/assets/apex-logo-mark.png` (the existing gold "A" mark used elsewhere in the codebase) composited onto the portal's navy brand background (`#0B1F3A`), via `@capacitor/assets`. Source composites are in `assets/icon.png` (1024×1024) and `assets/splash.png` (2732×2732) — regenerate with:

```bash
npx capacitor-assets generate --iconBackgroundColor '#0B1F3A' --iconBackgroundColorDark '#0B1F3A' --splashBackgroundColor '#0B1F3A' --splashBackgroundColorDark '#0B1F3A'
```

if you swap in a different source image. The source mark is only 480×461px — noticeably below Apple's ideal 1024×1024 — so it may look soft at the largest App Store sizes. Worth swapping in a proper high-resolution square logo file before your first real store submission.

## What's already done

- `npx cap add android` and `npx cap add ios` — both native projects scaffolded (`android/`, `ios/`).
- Icons and splash screens generated for both platforms.
- `npx cap sync` run cleanly.

## What you still need to do (can't be done from this sandbox)

This session has no Xcode, no Android SDK, and no physical devices — the following steps need your own machine:

### Android (needs Android Studio)
1. Install [Android Studio](https://developer.android.com/studio).
2. `npx cap open android` (or open the `android/` folder directly in Android Studio).
3. Let Gradle sync, then Build → Generate Signed Bundle/APK for a release build, or just hit Run to test on an emulator/device first.
4. Create a [Google Play Console](https://play.google.com/console) account ($25 one-time) and upload the signed `.aab`.

### iOS (needs a Mac with Xcode)
1. Install Xcode and CocoaPods (`sudo gem install cocoapods`) if you haven't.
2. `cd ios/App && pod install` — this sandbox couldn't run this step (no CocoaPods installed here), so it's still pending.
3. `npx cap open ios` (or open `ios/App/App.xcworkspace` — **not** the `.xcodeproj`, once Pods are installed).
4. Set up your Apple Developer account ($99/yr) and signing team in Xcode's Signing & Capabilities tab.
5. Build to a real device or simulator to test, then Archive → Distribute App for TestFlight/App Store submission.

### Before either store submission
- Swap in a higher-resolution source icon if you want the polish (see above) — `assets/icon-source.png` is only 480×461px and there's no higher-resolution version of the Apex logo anywhere in this repo. If you have a proper 1024×1024+ source file, drop it in and re-run the `capacitor-assets generate` command above.
- Test the full money paths inside the actual native shell, not just the browser: Checkride Prep Pack purchase, and (as an admin, since it's currently gated — see `../site/portal-stable.js`'s `renderAdminIfApplicable()`) Membership join/cancel and Ask Andrew.
- **Test account deletion** (Account → Delete Account in the portal) inside the native shell too — it's new (see below) and hasn't been tested against a live Supabase instance from this sandbox.
- **Apple's In-App Purchase requirement (Guideline 3.1.1)**: the Checkride Prep Pack, individual Ground School classes, and the full Ground School pack all currently sell through Stripe web checkout inside the WebView. Apple generally requires IAP for digital content unlocked in-app — Ground School might qualify for the "real-world service" exception the way booking apps do, but the Prep Pack (pure digital content) likely wouldn't. Per your call, this submission is going in as-is with Stripe checkout; treat a possible rejection here as Apple's own answer on whether the exception applies, not a bug to pre-emptively fix.

### Account deletion (added — required for submission)

Apple's Guideline 5.1.1(v) requires any app with account creation to also offer in-app account deletion, not just deactivation. This didn't exist anywhere in the portal before now.

- **Client**: Account → "Delete Account" (`site/portal.html`), type-to-confirm with the member's own email, then calls the new `delete-account` edge function.
- **Server**: `portal/supabase/functions/delete-account/index.ts` — cancels any active Stripe subscription, hard-deletes AI chat/Guided Notes/testimonial content, anonymizes the profile's identity fields, and soft-deletes the auth account (disables login without a risky cascading hard-delete — see the function's header comment for why). Purchase and Ground School attendance records are retained in anonymized form for accounting purposes, which is standard practice.
- **Deploy**: this is a new edge function, not a SQL migration — deploy it via `supabase functions deploy delete-account` (needs `STRIPE_SECRET_KEY` set as a function secret, same as the other Stripe-calling functions).
- Verified with a Playwright test of the client-side confirm flow (button gating, redirect); **not** verified against a live Supabase instance or a real Stripe subscription cancellation from this sandbox.

### Privacy policy / store disclosure forms

`../site/privacy.html` now has a "The Apex Advantage member portal" section covering what was previously undocumented — Supabase auth/profile data, Stripe payment metadata (no card data), Anthropic (Ask Andrew / AI DPE Practice conversation content), referral emails, and study/usage data. Use this as your source when filling out:

- **Apple App Privacy ("nutrition label")**, in App Store Connect: Contact Info (name, email) → linked to identity; Financial Info → not collected (Stripe handles it) unless you count transaction metadata, which most apps don't need to declare separately; User Content → the AI chat messages, declare as linked to identity and used for App Functionality; Identifiers → none beyond account ID; Usage Data → study/progress data, declare as linked to identity, used for App Functionality and Analytics (GA4/Meta/Clarity load on portal pages too).
- **Google Play Data Safety form**: same categories — Personal info (name, email), App activity (study/usage data), App info and performance (via GA4/Clarity). Declare data is encrypted in transit (Supabase/Stripe both use TLS) and that users can request deletion (true now, both self-service in-app and via email).
