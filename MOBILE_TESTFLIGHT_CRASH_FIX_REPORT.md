# Apex Advantage iOS — TestFlight Startup Crash: Diagnosis, Fix, and Apple Guideline 2.1 Response

Branch: `claude/testflight-crash-fix` (pushed, **not merged — awaiting approval**)
Commit: `caf209f`
Scope: `mobile-expo/` only (the real Expo/EAS native app). `mobile/` (legacy Capacitor) was not read or touched.

---

## 1. Confirmed findings and remaining hypotheses

### Confirmed (reproduced directly, not inferred)

**Root cause: `mobile-expo/lib/supabase.ts` threw a synchronous exception at module-import time whenever `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` were unset.**

The import chain is `app/_layout.tsx` → `contexts/AuthContext.tsx` → `lib/supabase.ts`. In JavaScript, every module's `import` statements are fully evaluated before that module's own top-level code runs — so `lib/supabase.ts` (and its `throw`) executed *before* `app/_layout.tsx` ever reached its own first line, which is `SplashScreen.preventAutoHideAsync()`. A JS exception thrown while a module is first being imported happens before any component has rendered, so it is **not** something a React error boundary (including Expo Router's per-route `ErrorBoundary` export) can catch — those only catch errors thrown *during render*. The result: the native launch/splash screen appears (it's controlled by native config, independent of JS), the JS bundle then throws during its own startup `require` chain, and the app terminates — which is exactly what "installed through TestFlight, crashes during loading" describes.

I reproduced this directly (not just read the code and inferred it): with `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` deleted from the environment and the module freshly required, the old code threw every time, 100% reproducibly — see `mobile-expo/test/supabaseClient.test.ts`, which asserts this against the *real* module (every other test file in this suite mocks `lib/supabase` away entirely, which is exactly why 631 previously-passing tests never caught this).

`EXPO_PUBLIC_*` values are not read from the device at runtime — Expo's build tooling inlines whatever value each one held *at build time*. `mobile-expo/eas.json` has no `env` block in any build profile (development/preview/production), there is no `.env` committed (correctly gitignored — only `.env.example` with placeholder values exists), and there is no CI workflow in this repository that sets them either. That means whether a given TestFlight binary has these values baked in depends entirely on whether they were configured as **EAS project Environment Variables** (via the EAS dashboard or `eas env:create`) for the profile that built it — something I cannot verify from this repository checkout or sandbox (no `eas` CLI, no EAS account access here). **This is the one fact in this report that still needs confirmation from whoever has access to the EAS project (`apex-aviation` / project id `fb3ad0c5-9655-4d9d-9ecb-8a4e0ccfe7f2`)** — run `eas env:list --environment production` (or check the EAS dashboard's Environment Variables page) and confirm both names are present and non-empty for the `production` build profile.

Regardless of that confirmation, the code-level defect — an unconditional crash with no recovery path if those two specific values are ever absent — is real, verified by direct reproduction, and is fixed.

### Ruled out (checked and confirmed clean)

- **Font loading** (`useFonts` in `app/_layout.tsx`): already correctly handles both success and `fontError`, dismissing the splash screen and proceeding either way. No defect.
- **SecureStore / session storage** (`lib/largeSecureStore.ts`): matches Supabase's own documented Expo pattern; `getItem` already catches decryption failures and treats them as "no session" rather than throwing. No defect.
- **Push notification registration** (`hooks/usePushRegistration.ts`, `hooks/useNotificationRouting.ts`): extensively defensive — every async operation is wrapped in try/catch with logging, nothing here can throw uncaught. `NotificationsProvider` (which owns push registration) is only mounted *after* sign-in (inside `(app)/_layout.tsx`), so it cannot be the cause of a pre-auth startup crash. Not ruled out as a *contributing* factor if Apple's reviewer account somehow reaches a signed-in state and something about push *capability provisioning* (APNs entitlement on the actual build) misbehaves on-device — this is a native-credentials question outside what's visible in source, flagged below under physical-device testing.
- **Monorepo module resolution** (`metro.config.js` resolving `../shared/mobile-dto` from outside `mobile-expo/`): deliberately configured (`config.watchFolders`), and verified working — a full local production export (`npx expo export --platform ios`) bundled all 1483 modules successfully with no resolution errors.
- **Dependency/native-module incompatibility**: `expo-doctor` reports only patch-version drift (10 packages, e.g. `expo-router` 57.0.19 vs 57.0.25) — not a known crash pattern, and I did not speculatively bump these per the task's explicit instruction to avoid unnecessary dependency changes.
- **TypeScript/ESLint-detectable defects**: zero errors from either tool, before or after the fix.

### Remaining hypotheses (cannot be fully settled from code alone)

1. **EAS environment variable configuration for the `production` profile** — the fact pattern above is strongly consistent with this being the actual trigger, but confirming it requires EAS dashboard/CLI access this environment doesn't have.
2. **Push notification entitlement/provisioning on the specific installed binary** — if the installed TestFlight build's provisioning profile doesn't include the Push Notifications capability (a credentials/provisioning question, not a code question), a *post-sign-in* crash is theoretically possible despite the defensive code, though I found no code path that would surface this as an uncaught throw.
3. If the EAS environment variables are confirmed already correctly configured, the crash may have a different, not-yet-identified cause — in that case, the next step is requesting the actual crash log via Xcode Organizer or TestFlight's own crash reports (see §6), since nothing else in the startup path showed an unguarded failure mode.

---

## 2. Exact changes and affected files

| File | Change |
|---|---|
| `mobile-expo/lib/supabase.ts` | No longer `throw`s when env vars are missing. Exports `isSupabaseConfigured: boolean`. Falls back to syntactically-valid placeholder strings so `createClient()` always succeeds; a real network call made against placeholders would fail through this app's existing `ApiError`/`networkError` handling like any offline failure — but in practice no screen reaches that point, because: |
| `mobile-expo/app/_layout.tsx` | Renders a clear "Apex Advantage couldn't start due to a configuration problem" screen (reusing the existing `ErrorState` component) when `!isSupabaseConfigured`, instead of proceeding into `AuthProvider`. Also adds a named `ErrorBoundary` export (Expo Router's documented per-route mechanism) as defense-in-depth against any *other* uncaught render-time error producing the same crash-during-load symptom, with a "Try again" retry action. Both paths explicitly call `SplashScreen.hideAsync()` so neither can leave an indefinite splash screen. |
| `mobile-expo/test/supabaseClient.test.ts` (new) | Regression test exercising the *real* `lib/supabase.ts` (not mocked) under both the missing-env-var condition (proving it no longer throws, and `isSupabaseConfigured` is `false`) and the configured condition (`isSupabaseConfigured` is `true`, a real client is constructed). |

No changes to authentication logic, session persistence, entitlement checks, or any existing student data path. No dependency versions changed. `mobile/` (legacy Capacitor) was not touched.

---

## 3. Test results

All run inside `mobile-expo/` after a clean `npm ci`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** — zero errors |
| `npx expo lint` | **Pass** — zero errors, exit code 0 |
| `npx jest` | **Pass — 634/634 tests, 52/52 suites** (631 pre-existing + 3 new in `supabaseClient.test.ts`). No regressions. |
| `npx expo-doctor` | **20/21 checks pass.** The 1 failure is a pre-existing, unrelated patch-version mismatch across 10 Expo packages (e.g. `expo-router` 57.0.19 installed vs 57.0.25 expected) — not touched, per the instruction to avoid speculative dependency upgrades. |
| `npx expo export --platform ios` (local production-mode bundle) | **Succeeded** — 1483 modules bundled, Hermes bytecode produced, zero resolution/bundling errors. This is the closest available "production bundle" check in this sandbox (no EAS account/credentials here to run an actual `eas build`). |

### Environment limitations (reported honestly, not glossed over)
- No `eas` CLI session/credentials available in this environment — I could not run a real `eas build`, could not inspect the EAS project's configured Environment Variables, and could not install anything to a physical device myself.
- No physical iPhone or simulator available in this sandbox — nothing here constitutes on-device verification. **The task's own success criterion — a corrected build verified to launch on a physical iPhone — has not yet been met and requires the steps in §5/§6 to be carried out by someone with EAS/device access.**

---

## 4. Recommended corrected EAS production build process

1. **Confirm/set the Supabase environment variables for the `production` build profile** before building anything:
   ```
   eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://wqzfhcjsfzwrimvsudxy.supabase.co" --visibility plaintext
   eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<the publishable/anon key>" --visibility plaintext
   ```
   (Both are explicitly client-safe/publishable by this app's own design — see `.env.example`'s header comment — so `--visibility plaintext` is correct, not a secret leak.) If they're already configured, `eas env:list --environment production` will show them — don't recreate, just confirm.
2. From `mobile-expo/`, run `npx expo-doctor` and `npx tsc --noEmit` one more time immediately before building (cheap, catches anything that drifted).
3. Build: `eas build --platform ios --profile production` from inside `mobile-expo/` (the project root EAS needs is wherever `eas.json`/`app.json` live — confirmed that's `mobile-expo/`, not the repo root).
4. Once the build finishes, **before submitting to TestFlight**, if at all possible, install the resulting `.ipa`/simulator build locally and launch it once to confirm it reaches the sign-in screen without crashing. (`eas build:run` for a simulator build, or TestFlight itself for a device build — see §5.)
5. Submit: `eas submit --platform ios --profile production` (or let `eas build --auto-submit` do it).

---

## 5. Steps to install the corrected build through TestFlight

1. Confirm the build in step 3/4 above completed and shows `finished` in `eas build:list`.
2. If not auto-submitted, run `eas submit --platform ios --latest`.
3. In App Store Connect → TestFlight, wait for the new build to clear automated processing (a few minutes to ~1 hour).
4. On the physical iPhone already used for the original crash report: open the TestFlight app, the new build should appear with an "Update" action (same bundle id, `com.apexaviationtx.advantage`, higher build number since `eas.json` has `autoIncrement: true` for `production`). Tap Update.
5. Launch the app. **Expected result with the fix**: either (a) it reaches the sign-in screen normally (if Supabase env vars are correctly configured — the crash is gone and the app is fully functional), or (b) if the EAS environment variables turn out to still be unconfigured for some reason, it now shows the "Apex Advantage couldn't start due to a configuration problem" screen instead of crashing — which is itself a clear, actionable signal (and still means the crash itself is fixed, even though the underlying config gap would need a separate follow-up).
6. Only once outcome (a) is confirmed on the physical device should anyone tell Apple the crash is resolved — per this task's own stated success criterion.

---

## 6. Remaining issues requiring physical-device testing

1. **The actual launch-success verification itself** — nothing in this sandbox can substitute for installing the real corrected build on the physical iPhone and confirming it reaches the sign-in screen. This is the task's explicit success criterion and is not yet met.
2. **Push notification permission/registration end-to-end on-device** — the code is defensively written (confirmed by reading), but whether the *actual provisioning profile* on the TestFlight build has the Push Notifications capability/entitlement correctly attached is an Apple Developer portal / EAS credentials fact, not something visible from source.
3. **If the corrected build still fails to launch**, the next concrete step is pulling the real crash log: Xcode → Window → Devices and Simulators → (select the iPhone) → View Device Logs, or TestFlight's own "Send Feedback"/crash report from the tester's device, or Apple's own crash reports in App Store Connect → TestFlight → (build) → Crashes. That log will show the actual native/JS stack at the moment of the crash, which would either confirm the env-var hypothesis precisely or reveal a different cause entirely.
4. **Sign-in and full navigation smoke test as a real account** — confirming the rest of the app (Practice, Oral, Library, Ground School, Training Report, Delete Account) behaves correctly post-fix, since this investigation focused specifically on the startup path per the task's scope.

---

## 7. Apple Guideline 2.1 response draft

Two things plausibly sit under Apple's Guideline 2.1 note here: the launch crash itself, and — because this app requires sign-in with **no in-app account creation** (accounts are created only via the web portal's Stripe checkout) — Apple's reviewer may also need working demo credentials to get past the sign-in screen at all. The draft below addresses both; delete whichever section doesn't apply once you know exactly what Apple's note said.

> **Response to Guideline 2.1 — App Completeness**
>
> Thank you for flagging this. We've identified and fixed the cause of the launch crash.
>
> **Root cause:** Our app's Supabase client initialization code (`lib/supabase.ts`) threw an unhandled exception during the app's startup import sequence whenever its required configuration values were not present in the build. Because this occurred before our first UI frame could render, it was not recoverable by any in-app error handling at the time, and surfaced as a crash immediately after launch.
>
> **Fix:** We've corrected the initialization logic so that a missing or invalid configuration state can never throw an unhandled exception. The app now either initializes normally, or — in the unlikely event its configuration is ever incomplete again — displays a clear, non-crashing message rather than terminating. We've also added a top-level error boundary as a second layer of protection against any other unexpected startup error. We verified the fix with automated tests that reproduce the exact failure condition against our real initialization code, confirmed a clean production bundle build, and installed the corrected build via TestFlight on a physical iPhone, confirming it launches successfully to the sign-in screen. [Confirm this last sentence is literally true before sending — see §6, item 1 — and only send this response after that verification actually happens.]
>
> **Reviewer access:** Apex Advantage accounts are provisioned through our web portal (apexaviationtx.com) rather than in-app registration, since the mobile app is a companion to an existing paid training program. We've provided a full-access demo account in the "App Review Information" notes in App Store Connect so the review team can sign in and exercise every feature, including the full Checkride Prep content library that would otherwise require a separate purchase. [Confirm a working demo account with `checkride_prep_unlocked = true` is actually present in App Store Connect's review notes before sending this — if not, provision one and add the credentials there first; see note below.]
>
> We appreciate the review team's patience and are happy to provide any additional information needed.

**Before sending this:** two things need to be true, not just stated:
- The corrected build must actually be the one installed and verified (§6.1) — don't claim verification that hasn't happened.
- A real, working demo account must exist and be listed in App Store Connect's review notes, with Checkride Prep already unlocked on it (so the reviewer isn't blocked by the same "Checkride Prep isn't included on this account" locked state a real free account would see — see `components/StateViews.tsx`'s `LockedState`). I did not create or verify one from this sandbox (it requires live Supabase access to the `profiles` table); the production Supabase project already has an `admin-provision-review-account` Edge Function deployed (confirmed present in a prior session's `list_edge_functions` listing, though its source isn't checked into this repository) — the simplest path is almost certainly to use that function to provision a correctly-entitled reviewer account, then paste its email/password into App Store Connect's review notes.

### Other Guideline-relevant findings from the Task 4 audit (informational, not required for this specific 2.1 reply unless Apple's note covers them too)

- **Account deletion (5.1.1(v))**: fully implemented and compliant — `app/(app)/delete-account/index.tsx` offers in-app, irreversible, type-your-email-to-confirm deletion, calling the same `delete-account` Edge Function the web portal uses.
- **No external purchase/payment steering (3.1.1)**: verified by reading every `Linking.openURL` call in the app (there are exactly two: "Open Settings" for notification permissions, and the Privacy Policy link) and the locked-content state (`LockedState` in `components/StateViews.tsx`), which deliberately shows no price, checkout link, or "upgrade on our website" messaging — matching Apple's reader-app rules for content purchased outside the app.
- **Privacy disclosure**: a working in-app Privacy Policy link exists (`app/(app)/profile.tsx` → `https://apexaviationtx.com/privacy.html`).
- **No undeclared permission-requiring APIs**: no camera/location/contacts/microphone usage in the dependency list, so no missing Info.plist usage-description strings.
- **No App Tracking Transparency requirement triggered**: no analytics/tracking SDK is present in `mobile-expo/` at all.

---

## Summary

The verified, reproduced root cause of the TestFlight launch crash was an unconditional synchronous throw in `lib/supabase.ts` when Supabase configuration env vars are absent from the build — occurring before the splash screen could even be told to hide, with no way for React to catch it. The fix removes the throw, adds a visible recoverable error screen plus a root-level `ErrorBoundary` as defense-in-depth, and is covered by a new regression test that reproduces the exact original failure against the real module. TypeScript, ESLint, Jest (634/634), `expo-doctor`, and a local production bundle export all pass. The one still-open fact (whether the EAS `production` profile actually has these env vars configured) requires EAS dashboard/CLI access this sandbox doesn't have, and the task's explicit success criterion — launch verified on a physical iPhone — has not yet been met and is the immediate next step for whoever has EAS/device access. Changes are on `claude/testflight-crash-fix`, pushed, not merged.
