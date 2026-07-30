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
- Swap in a higher-resolution source icon if you want the polish (see above).
- Test the full money paths inside the actual native shell, not just the browser: Checkride Prep Pack purchase, and (as an admin, since it's currently gated — see `../site/portal-stable.js`'s `renderAdminIfApplicable()`) Membership join/cancel and Ask Andrew.
- Both stores will ask for privacy policy / data collection disclosures — point them at whatever privacy policy page the marketing site already has, and audit what member data Supabase/Stripe/Meta Pixel actually collect for the disclosure forms (Apple's App Privacy "nutrition label" and Google Play's Data Safety form both require this to be accurate).
