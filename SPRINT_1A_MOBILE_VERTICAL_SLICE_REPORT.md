# Sprint 1A -- Apex Advantage Native Mobile Vertical Slice

Status: **physical iPhone testing performed via Expo Go; two narrow UI defects found and fixed. Not merged to main. Not deployed. Not submitted to any app store.**

This report covers the native Expo/React Native vertical slice built in `mobile-expo/` per the "RESUME SPRINT 1A" authorization, which followed the closed backend stop-gate (the v118 Daily Drill / mobile-practice bridge, reviewed and production-verified in `SPRINT_1A_DAILY_DRILL_PRACTICE_BRIDGE_REPORT.md`).

**Rev2 update:** an independent review of the original Sprint 1A submission found ten narrow client-side issues to close before physical-device testing (a restart/resume reveal deadlock, Home/Practice entitlement-sequencing gaps, web-purchase-steering copy, incomplete readiness reason-code rendering, an under-detailed completion screen, a missing AppState-driven auth-refresh lifecycle, a Home component-render test gap, Home staleness after drill completion, and a malformed-API-response fail-safe gap). All ten are fixed in this revision -- see **section 27** for the exact changes, updated test/validation results, and what was superseded in the sections below. No backend file was touched; this remains a client-only revision.

**Rev3 update:** a further independent source review, cross-checked directly against the deployed `mobile-daily-drill`/`mobile-bootstrap`/`mobile-practice`/`mobile-readiness` Edge Function source and the v118 migration's `start_daily_drill_practice_session()` RPC body, found one genuine client-side defect Rev2 introduced (a Daily Drill validation rule that was stricter than the actual deployed contract, which would have rejected legitimate production data) plus three narrow correctness gaps. All four are fixed -- see **section 28**. No backend or shared-DTO file was touched; no deployed-contract mismatch was found (only the client's own Rev2 validation had drifted from the real contract).

---

## 1. Architecture

```
Expo Router (file-based navigation)
  |
  +-- app/_layout.tsx            root: font loading, AuthProvider, splash
  +-- app/(auth)/                signed-out stack (redirects into (app) if a session exists)
  +-- app/(app)/                 signed-in tab stack (redirects to (auth) if no session)
        |
        +-- screens (thin) --> hooks (state + orchestration) --> lib/api/* (typed, normalized)
                                                                        |
                                                                        v
                                                        supabase.functions.invoke()
                                                                        |
                                                                        v
                                                production mobile-* Edge Functions
                                                       (wqzfhcjsfzwrimvsudxy)
```

Screens are intentionally thin: they read hook state and render components from `components/`. All server communication, error normalization, and business-rule-free data shaping live in `hooks/` and `lib/`. No screen contains a raw `supabase.functions.invoke` call.

The client computes nothing the server is authoritative for: no XP, no entitlement, no readiness score, no weak-area list, no drill question selection, no completion scoring. Every one of those values is rendered exactly as the server returned it (see section 20's static test suite, which enforces this at the source-scan level).

## 2. Exact Expo / React Native versions

Current stable line at implementation time (September 2026) -- not pinned from memory:

| Package | Version |
|---|---|
| `expo` | 57.0.20 (SDK 57) |
| `react-native` | 0.86.3 |
| `react` | 19.2.3 |
| `expo-router` | 57.0.19 |
| `@supabase/supabase-js` | 2.115.0 |
| `typescript` | ~6.0.3 |
| `jest` / `jest-expo` | ~29.7.0 / ^57.0.5 |
| `@testing-library/react-native` | ^14.0.1 |

All native-module versions (`expo-secure-store`, `expo-font`, `expo-splash-screen`, `react-native-safe-area-context`, `react-native-screens`, `@react-native-async-storage/async-storage`, `react-native-get-random-values`, `react-native-url-polyfill`, `@expo/vector-icons`) were installed via `npx expo install`, which resolves the exact version compatible with this SDK rather than "latest" -- confirmed by `expo-doctor` (21/21 checks pass, including the dependency-version-match check).

## 3. Directory structure

```
mobile-expo/
  app/                     Expo Router screens (file-based routing)
    _layout.tsx            root layout: fonts, AuthProvider, Stack
    (auth)/
      _layout.tsx          redirect-if-signed-in guard
      sign-in.tsx
    (app)/
      _layout.tsx          redirect-if-signed-out guard, bottom tabs
      index.tsx             Home
      practice/
        _layout.tsx          Stack -- Practice tab's own nested navigator (nav fix)
        index.tsx           Practice tab (Today's Drill entry + placeholder)
        [drillId].tsx        Question -> Reveal -> Self-Rate -> Complete flow
      acs.tsx               placeholder
      oral.tsx              placeholder
      library.tsx           placeholder
      profile.tsx           sign-out (modal, reached via Home's avatar)
  components/              reusable design-system primitives
  contexts/
    AuthContext.tsx
  hooks/                   state + orchestration (one hook per concern)
  lib/
    api/                   typed, normalized clients for the 6 Edge Functions
    supabase.ts            Supabase client (LargeSecureStore-backed)
    largeSecureStore.ts
    authErrors.ts
    drillSessionReducer.ts pure question/reveal/rate state machine
    drillProgressStorage.ts local in-progress-rating persistence
  constants/
    theme.ts               Apex design tokens
  test/                    Jest test suites
  assets/
  .env.example
  app.json / package.json / tsconfig.json / metro.config.js / eslint.config.js
```

## 4. Dependencies and rationale

Kept deliberately minimal, per this Sprint's "keep dependencies minimal, do not introduce Redux unless an actual need appears" instruction -- no Redux, no React Query, no navigation library beyond Expo Router's own `@react-navigation` dependency, no UI kit. Every dependency added beyond the Expo Router quickstart has a specific reason:

- `@supabase/supabase-js` -- the one client for auth + Edge Function calls.
- `expo-secure-store` + `@react-native-async-storage/async-storage` + `aes-js` + `react-native-get-random-values` -- the LargeSecureStore session-storage pattern (section 5).
- `react-native-url-polyfill` -- required by supabase-js in React Native (no native `URL` global otherwise).
- `@expo-google-fonts/montserrat` + `@expo-google-fonts/playfair-display` -- the actually-shipped Apex typefaces (section 7).
- `@expo/vector-icons` -- bottom-tab and avatar icons; ships with Expo, no extra native linking.
- `expo-router`, `expo-linking`, `expo-constants`, `expo-font`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `react-native-safe-area-context`, `react-native-screens` -- the standard Expo Router foundation.
- Dev-only: `jest`, `jest-expo`, `@testing-library/react-native`, `test-renderer` (testing-library v14's React-19-compatible renderer peer, replacing the now-frozen `react-test-renderer`), `@types/jest`, `@types/node`, `@types/aes-js`, `eslint` + `eslint-config-expo`.

## 5. Auth persistence design

**Chosen: `LargeSecureStore`** (`lib/largeSecureStore.ts`) -- reviewed against Supabase's **current** official guidance before choosing:

- The plain React Native quickstart (`supabase.com/docs/guides/auth/quickstarts/react-native`) recommends `@react-native-async-storage/async-storage` directly.
- Supabase's dedicated Expo tutorial (`supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native`) instead documents a hybrid: an AES-256 key held in `expo-secure-store` (hardware-backed iOS Keychain / Android Keystore), encrypting the actual session blob before it's stored in `AsyncStorage`. `expo-secure-store` alone cannot hold a full Supabase session directly -- it caps individual values at 2048 bytes, and a session (access token + refresh token + user metadata) routinely exceeds that.

This app implements that second, more security-conscious pattern, not the plainer quickstart -- chosen specifically because this app persists a paid learner's session (Checkride Prep) on a personal phone that could be lost, shared, or backed up unencrypted by the OS. The rationale is documented in the file's own header comment. A corrupted/undecryptable stored value (e.g. after a device restore that cleared Keychain but not AsyncStorage) is treated as "no session" rather than crashing.

## 6. Stale-token behavior

`lib/authErrors.ts` is a direct TypeScript port of `portal/src/lib/authErrors.js` (Phase 9B), matching its semantics exactly: only the documented `refresh_token_not_found` and `refresh_token_already_used` codes (with a message-text fallback for a response missing `code`) are treated as a dead, unrecoverable token. `contexts/AuthContext.tsx` reproduces `portal/src/context/AuthContext.jsx`'s exact flow:

1. On launch, call `getSession()`.
2. If it returned a stale-token error, sign out with `scope: 'local'` only (never touches other devices) and clear local state -- guarded by a ref so this can only run once even if triggered from two code paths in quick succession.
3. Any **other** error (network hiccup, transient Auth outage) is explicitly **not** treated as stale -- the session `getSession()` still returned is used regardless.
4. `onAuthStateChange` keeps the session in sync afterward.

No internal Supabase storage keys are ever read or deleted manually; only the public `supabase.auth.signOut()` API is used. No raw auth error is ever shown to a learner (`signIn()` maps `Invalid login credentials` to "That email or password is incorrect." and anything else to a generic retry message).

**(Rev2 additions -- section 27 item 6)** Two hardening changes, both scoped to `contexts/AuthContext.tsx`:

- **AppState-driven auto-refresh lifecycle**, per current official Supabase React Native guidance: a `useEffect` registers one `AppState` listener, calling `supabase.auth.startAutoRefresh()` when the app is `active` and `supabase.auth.stopAutoRefresh()` otherwise, synchronizing the initial `AppState.currentState` immediately on mount and removing the listener on cleanup. This never touches stale-token handling and never triggers a sign-out on its own.
- **`initialize()` hardening**: the effect that calls `getSession()` on launch previously used `try/finally` with no `catch` -- a genuinely thrown/rejected `getSession()` (e.g. a secure-storage read failure) would have become an unhandled rejection. It's now wrapped in a `catch` that dev-logs the exception only, never classifies it as stale, never triggers a destructive sign-out, and still resolves `loading` so the app proceeds safely with whatever `session` state already holds.

Both are covered in `test/AuthContext.test.tsx`: active-on-mount starts auto-refresh, backgrounding/foregrounding stops/restarts it, the listener is removed on unmount, and an unexpected `getSession()` rejection never calls `signOut`. All pre-existing stale-token tests (C/D/E) continue passing unchanged.

## 7. API client design

`lib/api/client.ts` is the single seam every domain client (`bootstrap.ts`, `dailyDrill.ts`, `practice.ts`, `readiness.ts`, `library.ts`, `pushToken.ts`) goes through. It:

- Uses the active session automatically (supabase-js attaches the current access token to `functions.invoke` calls).
- Returns typed DTOs straight from `shared/mobile-dto`.
- Normalizes every failure into one `ApiError` shape (`lib/api/errors.ts`) with a `kind` (`auth` / `network` / `validation` / `forbidden` / `not_found` / `server`) and an always-learner-safe `userMessage`. A server-phrased domain error (e.g. v118's `"Checkride Prep is not unlocked on this account."`) passes through verbatim since it's already safe; a 5xx or malformed response is replaced with a generic message, with the real error only logged via `logDevError` in development (`__DEV__`).
- Distinguishes network failure (thrown/unreachable, or a `functions.invoke` error with no HTTP status) from a genuine domain error (a reachable non-2xx response) from an auth failure (401) -- verified in `test/apiClient.test.ts`.

`lib/api/dailyDrill.ts` wraps **only** `mobile-daily-drill`'s default and `start` actions -- the v118 bridge's session-creation path. `lib/api/practice.ts` is a genuinely separate module: `revealQuestion`/`completePractice` are used by the Daily Drill flow against a v118-linked `session_id`; `startAdHocPractice` (the independent ad-hoc path) exists for future use but is not called by any Sprint 1A screen. This separation is what makes "Daily Drill never calls mobile-practice's start" a structural property, not just a convention -- proven in `test/apiClient.test.ts`.

**(Rev2 addition -- section 27 item 9)** `lib/api/validate.ts` adds narrow runtime invariant checks -- deliberately not a schema-validation library -- to the four domain clients Sprint 1A actually renders (`bootstrap.ts`, `dailyDrill.ts`, `practice.ts`, `readiness.ts`). A failed check throws the same normalized `ApiError` (`kind: 'server'`) every other failure mode produces -- the malformed payload is only ever dev-logged, and the existing error-state/retry UI in every calling screen handles it exactly like any other server error, so a malformed 200 can never crash a render or leave the client in a non-completable state.

**(Rev3 correction -- section 28 item 1, the one genuine defect this revision found)** Rev2's Daily Drill validation was WRONG, not just incomplete: it required a non-null `session_id` for any `pending`/`in_progress` response regardless of which action produced it. The deployed `mobile-daily-drill` (confirmed by re-reading the actual Edge Function source directly, not assumed) returns `session_id: drill.practice_attempt_id ?? null` for BOTH the default (fetch) and `start` actions -- and a `pending` drill legitimately has a null `practice_attempt_id` until `start` is called on it. Production presently contains real pending Daily Drill rows with a null `practice_attempt_id`; Rev2's validation would have rejected every one of them as "malformed." Fixed by splitting `dailyDrill.ts` into two validators with genuinely different invariants: `fetchDailyDrill` only ever checks session_id's TYPE when present (null is fine for pending, for legacy pre-v118-bridge in_progress data, and for the deliberate completed-but-unlinked edge case); `startDailyDrill` additionally requires a non-null session_id specifically when the result's status is `in_progress` -- confirmed against `start_daily_drill_practice_session()`'s actual RPC body that there is no code path producing that combination with a null session_id. No backend or DTO change was needed; this was purely a client-side validation bug Rev2 itself introduced. See `test/apiValidation.test.ts`'s tests A-F.

**(Rev3 hardening -- section 28 item 3)** The remaining three validators were tightened with the exact nested fields each screen dereferences, still without adding a schema-validation dependency: `mobile-bootstrap`'s `user.id`/`full_name`, `training.*`, `access.checkride_prep` (must be boolean), `progress.xp`/`current_streak`/`longest_streak`/`current_rank`, `progress.readiness_summary` and `home.todays_drill` (both null-or-render-safe, sharing an `evidence_level`-enum/`reason_codes`-array-of-strings check with mobile-readiness's own snapshot), and `home.weak_areas` (array) -- an empty-object fixture no longer counts as "well-formed." Daily Drill questions are validated per-item (`id`/`question`/`category`) and `status` is checked against the real `pending`/`in_progress`/`completed` enum, not any string. `mobile-practice`'s `reveal` additionally validates `common_mistakes`/`dpe_evaluating`/`real_world_application` as null-or-string (never a stray number/object reaching `RevealContent`), and `complete`'s `score`/`total` must be finite, non-negative numbers, not just typeof `number` (which would still pass for `NaN`/`-1`/`Infinity`). Covered by 33 tests in `test/apiValidation.test.ts` (up from Rev2's 15).

## 8. Shared DTO integration

`../shared/mobile-dto/index.ts` is imported directly via relative paths (e.g. `import type { MobileBootstrapDTO } from '../../shared/mobile-dto'`) -- **no interfaces are copied into `mobile-expo/`**. `metro.config.js` configures the project as a small monorepo (`watchFolders` includes the repo root; `resolver.nodeModulesPaths` keeps native-module resolution scoped to `mobile-expo/node_modules` only) so Metro can see and bundle a file outside the project directory. This was end-to-end validated by a real `expo export --platform ios` production bundle (section 16) that successfully resolved and bundled every module, including this cross-directory import.

## 9. Implemented navigation

Bottom tabs: **Home, Practice, ACS, Oral, Library** -- the long-term shape. Sprint 1A behavior exactly as specified:
- **Home**: fully functional.
- **Practice**: shows Today's Drill (same card as Home) plus a restrained "more practice modes coming" note. **(Rev2)** Now reads the same shared `BootstrapContext` as Home and gates its own `mobile-daily-drill` fetch on "bootstrap resolved + entitled" exactly like Home; an unentitled learner sees the same neutral `LockedState`, never a retryable "premium API failed" error, and the tab never generates a `mobile-daily-drill` request in that case (section 27 items 2-3). **(Rev3 fix -- section 28 item 2)** Rev2 left one ordering gap: a bootstrap *failure* (network/server error, `data: null`) defaults `entitled` to `false` too, which meant a failed bootstrap call was misrendered as the permanent-sounding locked-access message instead of a retryable error. Practice's render order now matches Home's exactly -- loading, then error-or-no-data (retryable `ErrorState` calling `bootstrap.refresh`), then locked, then the Daily Drill UI -- so an entitled learner who simply hit a transient bootstrap failure sees the correct retryable state.
- **ACS / Oral**: polished, honest placeholders naming what's coming, no fabricated data.
- **Library**: same placeholder treatment (its API client exists in `lib/api/library.ts`, unused by any screen yet, per "clients prepared but no full UI requirement").
- **Profile/settings**: reachable via an avatar button on Home, not a tab -- a modal screen exposing only sign-out.

Protected routing: `(auth)/_layout.tsx` redirects a signed-in learner into `(app)`; `(app)/_layout.tsx` redirects a signed-out learner back to sign-in. Both render a loading state while the session is still resolving.

**(Navigation fix -- section 29)** The Practice tab contains two screens -- its own root (`practice/index.tsx`) and a pushed drill session screen (`practice/[drillId].tsx`) -- but had no navigator of its own; the parent `Tabs`' single `<Tabs.Screen name="practice" />` had nothing but a bare directory to resolve to. Fixed with `app/(app)/practice/_layout.tsx`, a nested `Stack` (`headerShown: false`, `unstable_settings.initialRouteName: 'index'`) per Expo Router's documented "Stack inside a Tab" pattern. The Practice tab always lands on its root first; `[drillId]` is only ever reached by an explicit push (from Home's Today's Drill card or the Practice tab's own copy of it) and renders inside that same nested Stack, so the tab bar stays on "Practice" the whole time a learner is in a drill -- never a separate, undesired sixth tab. The route path itself (`/(app)/practice/[drillId]`), every existing `router.push`/`router.replace` call site, and "Back to Home" all continue to work unchanged.

## 10. Home implementation

**(Rev2)** `contexts/BootstrapContext.tsx` now wraps `useBootstrap()` in a `BootstrapProvider` mounted once in `app/(app)/_layout.tsx`, so bootstrap loading/entitlement state is shared by every authenticated screen instead of Home calling `mobile-bootstrap` in isolation -- this is what lets both Home and the Practice tab gate their own Daily Drill fetch on the same "bootstrap resolved + entitled" signal (section 27, item 2).

Home renders, in order: greeting with the learner's name; training context (certificate type / aircraft class / ACS version, shown only when present); XP, streak, and rank as `MetricCard`s; `ReadinessCard` (always pairs `overall_score` with `evidence_level` and a restrained `reason_codes` explanation -- **Rev2**: now renders every recognized reason code, not just the first match, see section 27 item 4); Today's Drill (`hooks/useHomeDrill.ts` now takes an explicit `enabled` flag -- it never calls `mobile-daily-drill` until bootstrap has resolved AND the learner is entitled, see section 27 item 2); and `weak_areas` rendered exactly as `home.weak_areas` came back, with zero on-device weak-area computation. An unentitled account (`access.checkride_prep === false`) sees `components/StateViews.tsx`'s `LockedState` -- a neutral "contact your instructor or Apex support" message with **no URL, browser instruction, or purchase language of any kind** (Rev2 replaced the prior copy, which named a website -- section 27 item 3). Pull-to-refresh re-runs the bootstrap fetch (Today's Drill re-syncs automatically once the refreshed `bootstrapDrill` prop flows back down, no separate re-fetch call needed), guarded against a second concurrent refresh. **(Rev2)** Home also refreshes bootstrap automatically whenever it regains navigation focus (skipping the very first, redundant mount-time focus) -- see section 27 item 8 -- so returning from a completed drill shows current XP/streak/readiness without a manual pull-to-refresh.

**(Physical-device fix -- section 30 item 2)** The Rank `MetricCard` rendered the server's raw identity string (e.g. `student_pilot`) verbatim at the same giant "display" size used for numeric XP, which on a real iPhone wrapped mid-word ("stud/ent_/pilot"). `MetricCard` now accepts a `valueVariant` prop so a textual metric can opt into a smaller size than a numeric one; Home reformats `current_rank` for display only (`student_pilot` -> `Student Pilot`, same snake_case-to-Title-Case transform already used for `training.certificate_type`) and renders it at the `title` variant. The stored/server rank value itself is never altered -- only how Home displays it.

## 11. Daily Drill implementation

`hooks/useDrillSession.ts` calls `mobile-daily-drill`'s `start` action with the drill's id -- **never** `mobile-practice`'s `start` (which would create an unrelated ad-hoc session with its own randomly-selected questions). The response's `session_id`/`questions` populate a pure reducer (`lib/drillSessionReducer.ts`, unit-tested in isolation) via a single atomic `initialize` action, so the question list and any locally-restored ratings/reveals can never observe an inconsistent intermediate state. A completed drill (`drillStatus === 'completed'`, no fresh `completeResult`) renders a "this drill is already complete" summary and is never restarted -- consistent with the v118 bridge's own server-side guarantee that Start on a completed drill just returns the existing state.

## 12. Reveal / self-rating implementation

Before Reveal: only the question text, category, and progress indicator render -- no model answer, no common mistakes/DPE-evaluating/real-world-application text, no rating controls. Tapping **Reveal Answer** calls `mobile-practice`'s `reveal` action with the session's own `session_id` and the current `question_id`; `components/RevealContent.tsx` renders the four sections in the specified hierarchy, with `common_mistakes`/`dpe_evaluating`/`real_world_application` shown only when non-null, and the model-answer text rendered verbatim (no rewriting). Only after a successful reveal does `components/RatingButtons.tsx` appear, emitting the exact wire values `correct` / `partial` / `incorrect`. The reducer refuses a `rate` action for a question that hasn't been revealed yet (unit-tested), and re-rating the same question replaces the prior selection rather than appending a second entry -- structurally guaranteed by `ratings` being a `Record<questionId, rating>`, not a list.

## 13. Completion / idempotency handling

`complete()` builds its payload via `buildCompleteResponses()`, which walks the drill's own question order and emits exactly one `{question_id, self_rating}` per question that has been rated -- duplicates are impossible by construction. The Complete Drill button is disabled until every question has a rating and debounced against rapid double-taps: a `completeInFlight` ref set synchronously (before the function's first `await`) means three synchronous taps produce exactly one `mobile-practice` `complete` call, proven with a real concurrent-tap unit test (`test/useDrillSession.test.tsx`). `already_completed: true` from the server is treated as a normal success outcome, not an error. A network failure surfaces a retryable `ApiError` without corrupting state, so a second `complete()` call afterward proceeds normally. The client never computes or stores its own XP value anywhere -- `completeResult` only ever carries the server's own `score`/`total`/`already_completed` (enforced by both a targeted unit test and the static source scan in section 27's security test).

**(Rev2 -- section 27 item 5)** The completion screen's copy and content were both tightened: the session score now reads **"You marked X of Y correct"** rather than a bare "X of Y correct," making explicit that this is a self-rated tally, not an objectively-graded result. The completion screen also now renders the actual refreshed readiness score and evidence level via the real `ReadinessCard` primitive (reused as-is, same component Home uses) instead of a generic "Readiness indicator updated -- low evidence" line -- so a learner sees the same numeric indicator and evidence badge here as on Home, still with no pass/probability language anywhere. Covered by `test/DrillCompletion.test.tsx`.

**(Rev3 fix -- section 28 item 4)** That readiness rendering was still showing STALE data for a genuinely new completion. `hooks/usePostCompleteRefresh.ts` called `fetchLatestReadiness()` unconditionally, but `mobile-readiness`'s `latest` action explicitly never recomputes -- only `refresh` (`compute_readiness_snapshot()`) does. A learner who just recorded real new evidence via a Daily Drill completion would see the exact same snapshot they had before completing it. Fixed by passing `completeResult.alreadyCompleted` into `usePostCompleteRefresh`: a genuinely new completion (`alreadyCompleted === false`) now calls `refreshReadiness()`, sequenced to complete BEFORE `fetchBootstrap()` runs (so bootstrap's own `progress.readiness_summary`, which reads the same table fresh on every call, can never observe the old snapshot as current either); an idempotent replay (`alreadyCompleted === true`) still calls only `fetchLatestReadiness()`, since no new evidence was recorded and generating another snapshot would be an unnecessary duplicate write. No local readiness calculation occurs in either branch. Covered by `test/usePostCompleteRefresh.test.tsx` (which action fires for which case, and the sequencing) and `test/DrillCompletion.test.tsx` (the screen forwards the right flag through). **Physical device testing subsequently confirmed this works end to end: XP updated correctly on Home after a real completion, with no manual refresh needed.**

**(Physical-device fix -- section 30 item 1)** On a real iPhone, the completion screen itself failed to lay out: the title, self-rated score, XP/streak card, and readiness content were all invisible/clipped, though "Back to Home" remained visible and the underlying completion/XP write had genuinely succeeded (confirmed by XP updating correctly on Home afterward -- this was purely a client rendering defect). Root cause: `components/Screen.tsx`'s non-scrolling branch wrapped children in an outer `flex: 1` View, then an inner padded content View with no flex of its own -- so the completion screen's `flex: 1` + `justifyContent: 'center'` wrapper had no bounded-height parent to actually center within. This project's test renderer doesn't measure real layout, so the bug was invisible to every unit/component test despite passing cleanly. Fixed two ways: (1) `Screen`'s inner content View now also stretches (`flex: 1`) whenever `scroll` is false, restoring the layout contract its non-scrolling children expect; (2) independently, the completion screen itself no longer uses `scroll={false}` at all -- it renders as a normal scrolling `Screen` (matching every other screen in the app) with no special centering wrapper, which is both the more robust choice for smaller phones / larger Dynamic Type / longer readiness reason-code content, and removes the fragile assumption entirely rather than just patching around it. See `test/Screen.test.tsx` (style-level regression proving the inner View's flex contract) and `test/DrillCompletion.test.tsx` (proving every required element -- title, score, XP/streak, full `ReadinessCard`, Back to Home -- renders together, including with two simultaneous reason codes).

**(Physical-device fix -- section 30 item 3)** `components/TodaysDrillCard.tsx`'s completed state offered a **"View Summary"** button, but neither the current bootstrap nor `mobile-daily-drill`'s `start` contract actually exposes a historical completion summary -- revisiting a completed drill only ever re-renders the same "this drill is already complete" acknowledgment. Rather than promise detail Sprint 1A can't deliver (and without adding any backend endpoint to backfill it), the completed CTA now reads **"Completed"** and is disabled/non-interactive (`Button`'s existing `disabled` prop, which already communicates the state via `accessibilityState`). A real historical-summary screen remains a Sprint 1B+ idea, not something this fix attempts. Covered by an updated test in `test/Home.test.tsx`.

## 14. Restart / resume behavior

Tested behaviorally against the pure reducer and hook logic (a full physical-device restart-and-reopen cycle could not be exercised in this sandbox -- see section 21): closing and reopening mid-drill re-runs `useDrillSession`'s `start` effect, which calls `mobile-daily-drill`'s `start` action again. Because that action is idempotent (v118: an already-linked drill returns the same `session_id` and question order untouched), the resumed session is identical to the one left off.

**(Rev2 fix -- section 27 item 1)** The original submission had a real deadlock here: `lib/drillProgressStorage.ts` persisted both ratings AND which questions had been "revealed," but the reveal debrief content itself (`model_answer`/`common_mistakes`/etc.) was never persisted. Restoring a question as `revealed: true` with no local debrief content, combined with the screen hiding the Reveal button once `isRevealed` is true, stranded the learner with no way to see the answer or rate it. **Fixed by persisting ratings only.** `DrillProgress` no longer carries `revealedQuestionIds`; on restore, `useDrillSession`'s `initialize` dispatch always passes `revealed: {}`, so every question requires a fresh Reveal tap after a restart (re-fetching real content from the server) before its rating/navigation UI can show -- but the previously-saved rating for that question is still shown as selected the moment it's revealed again, since `ratings` restores independently of `revealed`. This makes the deadlocked state (`isRevealed === true` AND `revealContent === null` AND no way to trigger Reveal again) structurally impossible: `revealed[id]` can now only become `true` in the same synchronous update that also sets `revealContent`. Regression-tested in `test/useDrillSession.test.tsx` ("restart/resume regression (Rev2 section 1)").

## 15. Accessibility

- Every interactive control (`Button`, `RatingButtons`' radio options, the avatar button) carries an explicit `accessibilityLabel`/`accessibilityRole`, and buttons carry `accessibilityHint` where the action isn't self-evident from the label alone.
- Minimum 48pt touch targets on all buttons and rating options.
- Text renders through one `AppText` component using React Native's default `allowFontScaling` (not disabled anywhere), so the OS's dynamic type setting is honored throughout.
- `ProgressIndicator` exposes `accessibilityRole="progressbar"` with a numeric `accessibilityValue` and a paired "Question X of Y" text label -- progress is never conveyed by the bar's color/width alone.
- Loading/error/empty states use `accessibilityLiveRegion` so a screen reader announces state changes.
- Disabled states (Complete Drill before all questions are rated, buttons mid-request) set `accessibilityState={{ disabled, busy }}`, not just a visual dim.
- Palette contrast: body text uses Navy (#0B1F3A) or the mid-gray `mutedText` token on White/Light-Gray grounds, both comfortably AA-compliant; the Gold accent is never used for body text, only accents/badges/progress fill.

## 16. Test count / results

**Post-physical-device-fixes (current):**
```
Test Suites: 16 passed, 16 total
Tests:       125 passed, 125 total
```
(The navigation fix's 14/119 plus the physical-device-pass fixes' new `test/Screen.test.tsx` (2 tests) and `test/MetricCard.test.tsx` (2 tests), plus new/updated cases in `test/Home.test.tsx` and `test/DrillCompletion.test.tsx` -- section 30.)

Files (6 original + 6 added in Rev2 + 1 added in Rev3 + 1 added by the navigation fix + 2 added by the physical-device-pass fixes): `test/authErrors.test.ts`, `test/drillSessionReducer.test.ts`, `test/apiClient.test.ts`, `test/AuthContext.test.tsx`, `test/useDrillSession.test.tsx`, `test/security.test.ts`, Rev2's `test/ReadinessCard.test.tsx`, `test/Home.test.tsx`, `test/entitlementGating.test.tsx`, `test/DrillCompletion.test.tsx`, `test/HomeFocusRefresh.test.tsx`, `test/apiValidation.test.ts`, Rev3's `test/usePostCompleteRefresh.test.tsx`, the navigation fix's `test/practiceNavigation.test.tsx`, plus the physical-device-pass fixes' new `test/Screen.test.tsx` and `test/MetricCard.test.tsx`. Coverage against this Sprint's required list (section 20 of the original task):

- **AUTH (A-G)**: session restoration, no-session state, exactly-once stale-token cleanup for both `refresh_token_not_found` and `refresh_token_already_used`, transient-error tolerance, sign-in success/failure messaging, sign-out -- all in `AuthContext.test.tsx`. **(Rev2 additions)** AppState-driven auto-refresh start/stop/cleanup, and an unexpected `getSession()` rejection never triggering a destructive sign-out -- same file.
- **HOME (H-M)**: **(Rev2 -- closes the prior gap)** real component-render tests now exist in `test/Home.test.tsx` against production-shaped `MobileBootstrapDTO` fixtures -- H (learner/training state renders), I (XP/rank/streak reflect server values exactly), J (readiness score + evidence level), K (missing-readiness empty state), L (`insufficient_content_coverage` surfaced with no pass-probability copy), M (Today's Drill CTA per status: Start/Continue/Completed). `test/entitlementGating.test.tsx` additionally proves, against the REAL (unmocked) `useHomeDrill`/`useDailyDrill` hooks, that an unentitled Home/Practice never calls `mobile-daily-drill` and the locked-state copy carries no URL/browser/purchase language. **(Rev3 addition)** the same file now also proves Practice distinguishes a bootstrap *failure* from *locked access* -- a retryable error, never the locked-access message, and never a `mobile-daily-drill` call, while bootstrap is errored. **(Physical-device-pass additions -- section 30)** a long snake_case rank ("student_pilot") renders as "Student Pilot" with no underscore, and a completed drill's CTA reads "Completed" (disabled), never the retired "View Summary."
- **DAILY DRILL (N-X)**: `apiClient.test.ts` proves Start calls `mobile-daily-drill` (never `mobile-practice`); `drillSessionReducer.test.ts` proves question ordering, model-answer/rating-control gating before reveal, reveal rendering readiness, exact `correct`/`partial`/`incorrect` wire values, and one-rating-per-question. **(Rev2 addition)** `useDrillSession.test.tsx`'s "restart/resume regression" tests prove the reveal-deadlock fix: a restored question is never `isRevealed` with no content, its saved rating is retained, Reveal can always be called again, and only ratings (never `revealedQuestionIds`) are persisted locally. **(Rev3 correction)** `test/apiValidation.test.ts`'s Daily Drill section was rewritten with the corrected fetch-vs-start session_id contract (section 28 item 1) -- tests A-F prove fetch accepts a null session_id for pending/legacy-in_progress/completed, start requires a non-null session_id specifically for an in_progress result, and both accept the completed+unlinked edge case.
- **COMPLETE (Y-AE)**: `drillSessionReducer.test.ts` (unique-response payload) and `useDrillSession.test.tsx` (debounced duplicate taps, `already_completed` as success, retry after network failure, no local XP field, completed-drill-not-restarted is a design property verified by the v118 backend's own extensive suite plus this app's screen-level guard). **(Rev2 addition)** `test/DrillCompletion.test.tsx` proves the completion screen renders the actual refreshed readiness score/evidence level and the self-rated "You marked X of Y correct" copy. **(Rev3 addition)** the same file now also proves the screen forwards `alreadyCompleted` correctly to `usePostCompleteRefresh`; the new `test/usePostCompleteRefresh.test.tsx` proves a genuinely new completion calls `refreshReadiness()` (never `fetchLatestReadiness()`), sequenced before `fetchBootstrap()`, while an `already_completed` replay calls only `fetchLatestReadiness()`.
- **SECURITY/CONFIG (AF-AH)**: `security.test.ts`'s static source scan -- no service-role/Stripe-secret/lifecycle-secret/admin-token string, no local XP arithmetic, no local entitlement/readiness recomputation, anywhere in `app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `constants/`.
- **(New coverage, not in the original 20-section list)**: `test/ReadinessCard.test.tsx` proves every recognized reason code renders (not just the first via the old `.find(Boolean)`), with `insufficient_content_coverage` specifically guaranteed visible whether it's the only code or appears after another one. `test/apiValidation.test.ts` proves all four rendered APIs reject a malformed 200 body into a normalized `ApiError` while still accepting every legitimately-shaped response, now hardened in Rev3 with exact nested-field/enum/finite-number checks (invalid `evidence_level`/`status` values, non-boolean `checkride_prep`, non-string reason codes, non-finite/negative score/total, and non-null-or-string reveal debrief fields all rejected). `test/HomeFocusRefresh.test.tsx` proves Home refreshes bootstrap on every focus after the first, and does not refresh on the initial mount-time focus.

## 17. Lint result

```
npx expo lint
```
0 errors, 0 warnings.

## 18. TypeScript result

```
npx tsc --noEmit
```
0 errors.

## 19. Expo validation result

**Post-physical-device-fixes (current):**
```
npx expo-doctor
21/21 checks passed. No issues detected!
```
```
npx expo export --platform ios
iOS Bundled 6863ms node_modules/expo-router/entry.js (1316 modules)
```
A complete production JS bundle was produced -- every screen, hook, component, and the cross-directory `shared/mobile-dto` import all resolved and bundled successfully. Module count is unchanged from the navigation fix (1316) -- this pass only edited existing screens/components and added test files, which aren't part of the app bundle. `dist/` was deleted after export -- it's a validation artifact, not a committed build. (`--platform web` was not attempted: this is a mobile-only app and adding `react-dom`/`react-native-web` purely for an unused web target was judged out of scope.)

**Rev2 also added `expo-asset` as a direct dependency.** It's a real (if undeclared) transitive dependency of `expo-font`'s font-loading code path, which `@expo/vector-icons` pulls in; without it declared directly, npm nested it only under `node_modules/expo/node_modules/expo-asset` instead of hoisting it, which broke Jest's plain Node module resolution the first time a real `@testing-library/react-native` `render()` of a full screen (rather than just a hook) was attempted for the new Home tests. Metro's bundler resolution is more lenient than Jest's and already found it fine (the original submission's `expo export` succeeded even though `@expo/vector-icons` was already in use), but the gap was real and is now closed via `npx expo install expo-asset`, which also updated `app.json`'s `plugins` array.

## 20. Real production API validation

Performed against `wqzfhcjsfzwrimvsudxy` using only the existing disposable Sprint 0 test account (`247c0630-e803-488c-b48b-70d1f028a184`, entitled, already had a v118-completed Daily Drill from the prior deployment-verification session), exercising exactly the same Edge Function calls the app's `lib/api/*` layer makes. A temporary password was set via `pgcrypto` for the login step and rotated back to a random, unrecoverable value immediately afterward (mirroring the same discipline used for the v118 production verification).

1. **Login** -- password-grant against the project's own `/auth/v1/token`, a real Supabase session JWT.
2. **`mobile-bootstrap`** -- HTTP 200, `xp: 40`, `todays_drill` matching the known completed drill.
3. **Fetch Daily Drill** (default action) -- HTTP 200, same `session_id` as the completed attempt.
4. **Start/resume idempotency** -- calling `start` again on the completed+linked drill returned the identical `session_id` and `status: completed`, unchanged.
5. **Reveal** -- HTTP 200 for a question genuinely in that session, model answer returned.
6. **Complete replay** -- HTTP 200, `already_completed: true`, identical `completed_at` -- confirms idempotent behavior through this exact client contract shape.
7. **Readiness `latest`** then **`refresh`** -- HTTP 200 both; refresh recomputed a new snapshot (`evidence_level: low`), a legitimate write to the disposable account.
8. **Bootstrap re-fetch** -- HTTP 200, XP unchanged (40) as expected for an idempotent replay.

No customer row was read, written, or altered. The only writes were to the one disposable test account, which already carried the state left over from the prior v118 deployment-verification session (its password was the only thing changed and then restored to random).

## 21. Simulator/device testing actually performed

**Updated -- physical device testing has now been performed.** Every prior revision of this report through the navigation fix stated plainly that this sandbox has no iOS Simulator, no Android emulator, and no physical device attached, and made no device-testing claim. That remains true of *this sandbox* -- all work in sections 1-29 (and the fixes in section 30) was still built and validated here via static analysis, unit/integration tests, and a production Metro bundle only. What changed is that Andrew has now run the app on a real physical iPhone via Expo Go, following section 22's exact commands, and reported the results back -- see **section 30** for the full pass/fail list and the two narrow UI defects that testing pass found (both now fixed here, but not yet re-verified on the device).

## 22. Exact Mac setup / run commands

**Expo Go is *not* sufficient** for this project -- `expo-secure-store` and the exact native module set here work fine in Expo Go for basic testing, but the project should be run as a **development build** once any additional native module is added in a later sprint; for Sprint 1A's current dependency set, Expo Go is actually sufficient (no custom native code, no config plugin requiring a prebuild beyond what Expo Go already includes). Use Expo Go for now; move to a development build (`npx expo run:ios` / `eas build --profile development`) if Sprint 1B adds any native module Expo Go doesn't bundle (e.g. push notifications' full native config, in-app purchase SDKs).

```bash
# 1. Install dependencies
cd apexaviation/mobile-expo
npm install

# 2. Environment
cp .env.example .env
# Edit .env and fill in:
#   EXPO_PUBLIC_SUPABASE_URL=https://wqzfhcjsfzwrimvsudxy.supabase.co
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=<the publishable/anon key -- never the service-role key>

# 3. Start the dev server
npx expo start

# 4a. iOS Simulator (requires Xcode installed)
#     Press "i" in the terminal running `expo start`, or:
npx expo start --ios

# 4b. Android Emulator (requires Android Studio + an AVD configured)
npx expo start --android

# 4c. Physical iPhone (no Mac-only step needed beyond having Expo Go installed)
#     - Install "Expo Go" from the App Store on the iPhone
#     - Ensure the iPhone and the Mac are on the same Wi-Fi network
#     - Run `npx expo start`, then scan the terminal's QR code with the iPhone's Camera app
#     - If the QR scan doesn't connect (corporate/guest Wi-Fi that blocks LAN discovery),
#       run `npx expo start --tunnel` instead and re-scan

# Sign in with any real Checkride-Prep-entitled Apex Advantage account,
# or a disposable Sprint 0 test account if one is available to you.
```

Validation commands (all run clean in this session, safe to re-run on the Mac too):
```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm run test        # jest
npx expo-doctor
```

## 23. Known limitations

**Fixed in Rev2 (superseded, kept here only as a changelog pointer -- see section 27 for detail):**
- ~~Home does not live-refresh from a backgrounded tab~~ -- **fixed**, item 8 (refresh-on-focus).
- ~~No automated component-render tests for Home~~ -- **fixed**, item 7 (`test/Home.test.tsx`).
- ~~Restart/resume reveal deadlock risk~~ (not previously listed as a limitation, but discovered and fixed in this revision) -- **fixed**, item 1.

**Still open after Rev2:**
- **No simulator/device visual verification** (section 21) -- the highest-priority item for Andrew to confirm on his Mac before this is considered UI-complete, not just logically correct. Not attempted or claimed in Rev2 either.
- **Local in-progress-rating persistence is best-effort**, as designed and documented (section 14) -- a failed write, or a force-close before the first write lands, loses those specific ratings on reopen. The server-side session and its question set are never at risk; only the learner's own already-made-but-unsynced self-ratings for the current sitting. **(Rev2 narrowed this further)**: only ratings are persisted now, never "revealed" state, specifically to close the reveal-deadlock bug -- so a restart now always requires re-revealing each previously-revealed question (a real network call per question) before the learner can advance past it again, trading one redundant `mobile-practice reveal` call per question for the guarantee that the flow can never get stuck.
- **This exact dependency combination (Expo SDK 57 / React 19.2 / `@testing-library/react-native` 14 / the new `test-renderer` peer package) is very recent** and required real debugging to get `jest`/`renderHook` working correctly in this sandbox (a missing `@react-native/jest-preset` peer install, a version mismatch between it and `react-native` itself, `renderHook` becoming `async` in this testing-library version, and the global `IS_REACT_ACT_ENVIRONMENT` flag needing explicit setup). All of that is now resolved and committed (`test/jest.setup.ts`, pinned `@react-native/jest-preset@0.86.3`, `test-renderer` dev dependency). **(Rev2 additional finding)**: this version combination's `render()` (not just `renderHook()`) is also `async` and must be awaited -- discovered while adding Rev2's new full-screen component-render tests -- and a plain (non-awaited) `act(() => {...})` callback intermittently failed to flush a state update in time for the next assertion, so every new Rev2 test uses `await act(async () => {...})` even for synchronous state updates.
- **`--platform web` was not validated** (see section 19) -- this is a mobile-only app; web was never a target.
- **No push notification UI or Expo Notifications registration flow** -- `lib/api/pushToken.ts` exists per this Sprint's "clients prepared" instruction, but nothing calls it yet.
- **Library tab has no real catalog UI** despite `lib/api/library.ts` existing -- intentional per Sprint 1A scope, not an oversight.
- **`components/Screen.tsx` uses React Native's own (deprecated) `SafeAreaView`** rather than `react-native-safe-area-context`'s, which is already a project dependency -- surfaced as a console warning during Rev2's new render tests. Pre-existing from the original submission, out of scope for this review's ten items, flagged here for Sprint 1B.

## 24. Files changed

All new files under `mobile-expo/` (nothing outside it was touched -- see section 25). Full list: `git log --stat` on this branch's Sprint 1A commits, or `git diff --stat 86d8297..HEAD -- mobile-expo/` (the commit before this Sprint's Expo work began). Summary by area:

- Scaffold: `package.json`, `package-lock.json`, `app.json`, `tsconfig.json`, `metro.config.js`, `eslint.config.js`, `.npmrc`, `.gitignore`, `.env.example`, `AGENTS.md`, `assets/*`, `constants/theme.ts`, `app/_layout.tsx`.
- Auth: `lib/supabase.ts`, `lib/largeSecureStore.ts`, `lib/authErrors.ts`, `contexts/AuthContext.tsx`, `app/(auth)/*`, `app/(app)/_layout.tsx`, `app/(app)/profile.tsx`.
- API client: `lib/api/*.ts` (7 files).
- Design system + navigation: `components/Screen.tsx`, `AppText.tsx`, `Button.tsx`, `Card.tsx`, `SectionHeader.tsx`, `ProgressIndicator.tsx`, `MetricCard.tsx`, `StateViews.tsx`, `PlaceholderScreen.tsx`; `app/(app)/acs.tsx`, `oral.tsx`, `library.tsx`.
- Home: `components/ReadinessCard.tsx`, `TodaysDrillCard.tsx`, `hooks/useBootstrap.ts`, `useHomeDrill.ts`, `app/(app)/index.tsx`.
- Daily Drill flow: `lib/drillSessionReducer.ts`, `lib/drillProgressStorage.ts`, `components/RatingButtons.tsx`, `RevealContent.tsx`, `hooks/useDailyDrill.ts`, `useDrillSession.ts`, `app/(app)/practice/index.tsx`.
- Completion: `app/(app)/practice/[drillId].tsx`, `hooks/usePostCompleteRefresh.ts`.
- Tests: `test/*.test.ts(x)`, `test/jest.setup.ts`.

**Rev2 additions:**
- `contexts/BootstrapContext.tsx` (new) -- shared bootstrap state/entitlement provider.
- `lib/api/validate.ts` (new) -- malformed-response invariant checks.
- Modified: `app/(app)/_layout.tsx` (mounts `BootstrapProvider`), `app/(app)/index.tsx` (Home: entitlement-gated drill fetch, `LockedState`, refresh-on-focus, ref-in-effect lint fix), `app/(app)/practice/index.tsx` (Practice tab: same entitlement gate + `LockedState`), `app/(app)/practice/[drillId].tsx` (completion screen: `ReadinessCard` reuse + self-rated copy), `hooks/useHomeDrill.ts` and `hooks/useDailyDrill.ts` (both: `enabled` option), `hooks/useDrillSession.ts` and `lib/drillProgressStorage.ts` (ratings-only local persistence), `components/ReadinessCard.tsx` (all reason codes, not just the first), `components/StateViews.tsx` (new `LockedState` export), `contexts/AuthContext.tsx` (AppState lifecycle + init hardening), `lib/api/bootstrap.ts` / `dailyDrill.ts` / `practice.ts` / `readiness.ts` (validation calls), `app.json` + `package.json` + `package-lock.json` (`expo-asset` dependency).
- New tests: `test/ReadinessCard.test.tsx`, `test/Home.test.tsx`, `test/entitlementGating.test.tsx`, `test/DrillCompletion.test.tsx`, `test/HomeFocusRefresh.test.tsx`, `test/apiValidation.test.ts`.
- Modified tests: `test/AuthContext.test.tsx` (AppState + init-exception coverage), `test/useDrillSession.test.tsx` (restart/resume regression tests, `await`-fixed `act()`/`unmount()` calls), `test/apiClient.test.ts` (Daily Drill fixtures updated to satisfy the new shape validation).

**Rev3 additions:**
- Modified: `lib/api/dailyDrill.ts` (split into `validateFetchDailyDrillResponse`/`validateStartDailyDrillResponse` with the corrected session_id contract), `lib/api/validate.ts` (new shared primitives: `isNonEmptyString`, `isNullableString`, `isDrillStatus`, `isEvidenceLevel`, `isValidReadinessSummaryOrNull`, `isValidTodaysDrillOrNull`, `isValidQuestion`), `lib/api/bootstrap.ts` (full nested-field validator), `lib/api/practice.ts` (reveal debrief null-or-string checks, complete finite/non-negative score/total checks), `lib/api/readiness.ts` (reuses the shared readiness-summary validator), `app/(app)/practice/index.tsx` (bootstrap-error-before-entitlement ordering fix), `app/(app)/practice/[drillId].tsx` and `hooks/usePostCompleteRefresh.ts` (`alreadyCompleted`-aware readiness recompute).
- New tests: `test/usePostCompleteRefresh.test.tsx`.
- Modified tests: `test/apiValidation.test.ts` (rewritten Daily Drill section with tests A-F, plus new nested-field/enum/finite-number malformed-response cases), `test/entitlementGating.test.tsx` (new "Practice distinguishes bootstrap failure from locked access" describe block), `test/DrillCompletion.test.tsx` (proves the screen forwards `alreadyCompleted` correctly).

**Navigation fix additions (section 29):**
- `app/(app)/practice/_layout.tsx` (new) -- nested `Stack` navigator for the Practice tab.
- `test/practiceNavigation.test.tsx` (new) -- narrow structural test proving the layout declares exactly `index` then `[drillId]`, with `initialRouteName: 'index'`.

**Physical-device-pass fix additions (section 30):**
- Modified: `components/Screen.tsx` (inner content View now stretches to fill height when `scroll` is false), `app/(app)/practice/[drillId].tsx` (completion screen no longer uses `scroll={false}` / the centering wrapper), `components/MetricCard.tsx` (new `valueVariant` prop), `components/AppText.tsx` (exports its `AppTextProps` type so `MetricCard` can reference it), `app/(app)/index.tsx` (renamed/reused `formatSnakeCaseLabel` helper applied to `current_rank`, rendered at `valueVariant="title"`), `components/TodaysDrillCard.tsx` (completed CTA copy `View Summary` -> `Completed`, now disabled).
- New tests: `test/Screen.test.tsx`, `test/MetricCard.test.tsx`.
- Modified tests: `test/DrillCompletion.test.tsx` (new scrolling-layout/all-content-present regression case), `test/Home.test.tsx` (long snake_case rank formatting case; completed-CTA test updated for the new copy and disabled state).

## 25. Confirmation: backend was not modified

- No file under `portal/supabase/functions/`, no `portal/supabase-portal-schema-*.sql` migration, and no `test/run_security_regression_tests.sh` change was made during this Sprint 1A implementation work, **nor during the Rev2 revision, the Rev3 revision, the navigation fix, or the physical-device-pass fixes** -- `git diff --stat -- portal/ shared/` against this revision's base is empty.
- `shared/mobile-dto/index.ts` was **not** modified in this session, in Rev2, in Rev3, in the navigation fix, or in the physical-device-pass fixes -- it was already updated (adding `session_id`) during the prior v118 Rev2 work and is consumed here as-is.
- **Rev3 specifically re-read the actual deployed Edge Function source** (`portal/supabase/functions/mobile-daily-drill/index.ts`, `mobile-bootstrap/index.ts`, `mobile-practice/index.ts`, `mobile-readiness/index.ts`) and the v118 migration's `start_daily_drill_practice_session()`/`complete_mobile_practice_session()` RPC bodies directly, rather than assuming the prior validation was correct. The one contract question this raised -- whether `session_id: null` is ever legitimate for a `pending`/`in_progress` Daily Drill -- resolved as "yes, for fetch" (confirmed against the RPC's own status-transition logic and the deployed function's `session_id: drill.practice_attempt_id ?? null` shape), so this was a client-side validation bug, not a backend contract mismatch, and no STOP was required.
- `mobile/` (the existing Capacitor WebView wrapper) was not touched, read, or referenced by any file in `mobile-expo/`.
- No production deployment, database migration, or Edge Function redeploy occurred during this session, the Rev2 revision, the Rev3 revision, the navigation fix, or the physical-device-pass fixes. The physical-device-pass fixes touched only presentation-layer files (`Screen`, `MetricCard`, `AppText`, `TodaysDrillCard`, the completion screen, and Home's own display formatting) -- no API client, hook, DTO, or entitlement/XP/readiness logic was touched. The XP write and Daily Drill completion that the physical device test exercised were real production writes made by Andrew's own device against the already-deployed backend, not something this session performed.
- No blocking backend contract defect was discovered in Rev3, the navigation fix, or the physical-device-pass fixes -- every review item across all three was resolvable entirely within `mobile-expo/`.

## 26. Sprint 1B recommendations

1. **Ad-hoc practice UI** -- `lib/api/practice.ts`'s `startAdHocPractice` is ready; build the "Practice tab: more modes" screens (targeted ACS-task drills, rapid-fire) it was scoped for.
2. **Library catalog UI** -- `lib/api/library.ts` is ready; build the Study Pack browsing/purchase-status screens (no native purchase flow yet, per this Sprint's explicit exclusion).
3. **Push notifications** -- `lib/api/pushToken.ts` is ready; wire Expo Notifications registration and call `registerPushToken` on grant.
4. **Real device/simulator pass on Andrew's Mac** using section 22's exact commands -- the one verification this sandbox categorically could not perform, before or after Rev2/Rev3.
5. **Consider a development build** once any Sprint 1B native module isn't Expo-Go-compatible (push notifications' full native entitlements, any future in-app-purchase SDK).
6. **Migrate `components/Screen.tsx` off the deprecated React Native `SafeAreaView`** onto `react-native-safe-area-context` (already a dependency) -- flagged in section 23, surfaced by Rev2's new render tests.
7. **Consider persisting drill index/position, not just ratings**, if force-close-mid-drill UX (having to re-reveal already-seen questions on resume) is judged worth the added complexity -- deliberately not done in Rev2, which prioritized correctness (no deadlock) over resume convenience.

## 27. Rev2 revision -- independent review fixes

Ten items from an independent review, each addressed:

1. **Restart/resume reveal deadlock (fixed).** See section 14. Root cause: `revealed` state was restored locally without its debrief content. Fix: persist/restore ratings only, never `revealed`; every restored question requires a fresh Reveal tap. Regression test in `test/useDrillSession.test.tsx`.
2. **Home bootstrap/entitlement sequencing (fixed).** `useHomeDrill`/`useDailyDrill` now take an explicit `enabled` boolean (never a conditional hook call) computed as "bootstrap resolved AND entitled," backed by a new shared `contexts/BootstrapContext.tsx` so Home and Practice read the same bootstrap state instead of each fetching it independently. See sections 7, 10.
3. **Web purchase steering removed; Practice tab locked state added (fixed).** Home's locked-state copy no longer names a URL, browser, or purchase action -- replaced with `components/StateViews.tsx`'s new `LockedState` ("Checkride Prep isn't included on this account... contact your instructor or Apex support"). The Practice tab now shows the identical locked state and, per item 2's gating, never calls `mobile-daily-drill` when unentitled. Tests in `test/Home.test.tsx` and `test/entitlementGating.test.tsx` assert both the absence of any URL/browser/purchase-shaped text and zero `mobile-daily-drill` calls.
4. **ReadinessCard reason-code rendering (fixed).** Replaced `reasonCodes.map(...).find(Boolean)` (which could silently hide `insufficient_content_coverage` behind an earlier code) with rendering every recognized, de-duplicated reason code. Tested in `test/ReadinessCard.test.tsx` with multiple simultaneous codes including `insufficient_content_coverage`.
5. **Completion screen readiness + self-rated wording (fixed).** See section 13. Now reuses the real `ReadinessCard` (actual score + evidence level, not a generic sentence) and reads "You marked X of Y correct." Tested in `test/DrillCompletion.test.tsx`.
6. **AppState auth-refresh lifecycle + init hardening (fixed).** See section 6. `AuthContext` now starts/stops Supabase auto-refresh on foreground/background transitions and safely catches an unexpected `initialize()` exception without misclassifying it as stale or destructively signing out.
7. **Home component-render test gap (closed).** `test/Home.test.tsx` adds real `@testing-library/react-native` render tests (H-M) against production-shaped DTO fixtures, not a source-scan. Required adding `expo-asset` as a direct dependency (section 19) to fix a Jest-only module-resolution gap surfaced by the first full-screen `render()` call in this repo.
8. **Home staleness after completion (fixed).** See section 10. Home now calls `useFocusEffect` (from `expo-router`) to refresh bootstrap on every focus after the first; `useHomeDrill` re-syncs automatically from the new `bootstrapDrill` prop with no extra fetch call needed. Tested in `test/HomeFocusRefresh.test.tsx`. Pull-to-refresh is unchanged and still works.
9. **Malformed-response fail-safes (added).** See section 7. New `lib/api/validate.ts` plus per-endpoint invariant checks in all four rendered API clients. 15 targeted tests in `test/apiValidation.test.ts`.
10. **Backend untouched (confirmed).** See section 25.

**Rev2 validation, run clean together in this session:**
```
npx jest --runInBand
Test Suites: 12 passed, 12 total
Tests:       89 passed, 89 total

npx tsc --noEmit
(0 errors)

npx expo lint
(0 errors, 0 warnings -- one ref-mutated-during-render error was found and
fixed while adding the Home refresh-on-focus effect: the ref update moved
into its own useEffect)

npx expo-doctor
21/21 checks passed. No issues detected!

npx expo export --platform ios
iOS Bundled 12430ms node_modules/expo-router/entry.js (1315 modules)
```

`git status`/`git diff --stat` confirm only files under `mobile-expo/` and this report changed in this revision -- no file under `portal/`, no migration, and no change to `shared/mobile-dto/index.ts`. No production deployment or live Supabase API call occurred during this revision. No physical-device or simulator verification is claimed here, consistent with section 21.

## 28. Rev3 revision -- independent review fixes

A further independent source review, cross-checked directly against the deployed Edge Function source and the v118 RPC bodies (not assumed from the DTO or Rev2's own comments), found one genuine defect Rev2 introduced plus three narrow correctness gaps:

1. **Daily Drill session_id validation was WRONG, not just strict (fixed -- the one blocker).** See section 7. Rev2's validation required a non-null `session_id` for any `pending`/`in_progress` Daily Drill response, regardless of which action produced it. Re-reading `portal/supabase/functions/mobile-daily-drill/index.ts` directly confirmed the deployed function returns `session_id: drill.practice_attempt_id ?? null` for BOTH the default (fetch) and `start` actions, and re-reading `start_daily_drill_practice_session()`'s actual RPC body confirmed a `pending` drill legitimately has `practice_attempt_id = null` until `start` is called -- production presently contains real rows in exactly this state. Rev2's validation would have rejected every one of them as malformed. Fixed by splitting into two validators: `fetchDailyDrill` treats a null `session_id` as legitimate for `pending`, for legacy pre-v118 `in_progress` data, and for the deliberate completed-and-unlinked edge case; `startDailyDrill` additionally requires a non-null `session_id` specifically when the result's status is `in_progress` (the one combination the RPC genuinely never produces with a null session_id). Six explicit tests (A-F) in `test/apiValidation.test.ts` cover every combination named in the review. No backend or DTO change was needed or made.
2. **Practice now distinguishes a bootstrap failure from locked access (fixed).** See section 9. `bootstrap.entitled` defaults to `false` whenever `bootstrap.data` is null -- exactly the shape a failed bootstrap call has -- so Practice's entitlement check alone was misrendering a network/server error as the permanent-sounding "Checkride Prep isn't included on this account" message. Practice's render order now matches Home's exactly: loading, then error-or-no-data (a retryable `ErrorState` calling `bootstrap.refresh`), then locked, then the Daily Drill UI. `useDailyDrill`'s `enabled` flag already prevented a `mobile-daily-drill` call in the errored state before this fix (only the *rendered copy* was wrong) -- confirmed explicitly in the new tests rather than assumed. Four new tests in `test/entitlementGating.test.tsx`.
3. **Narrow nested runtime validation completed (hardened).** See section 7. `mobile-bootstrap`'s validator now checks the exact fields Home reads (not just that the five top-level objects exist): `user.id`/`full_name`, all three `training` fields, `access.checkride_prep` as a real boolean, `progress.xp`/`current_streak`/`longest_streak`/`current_rank`, and `progress.readiness_summary`/`home.todays_drill` against shared null-or-render-safe checks (an `evidence_level` enum of exactly `low`/`moderate`/`high`, `reason_codes` as an array of strings, `home.weak_areas` as an array). An empty-object fixture no longer passes as "well-formed." Daily Drill questions are validated per-item and `status` is checked against the real three-value enum, not any string. `mobile-practice reveal` additionally validates the three optional debrief fields as null-or-string so a malformed value can't reach `RevealContent`; `complete`'s `score`/`total` must be finite and non-negative, not just `typeof number` (which would still pass `NaN`/`-1`/`Infinity`). `test/apiValidation.test.ts` grew from 15 to 33 tests.
4. **Readiness now actually recomputes after a new completion (fixed).** See section 13. `usePostCompleteRefresh` called `fetchLatestReadiness()` unconditionally, but `mobile-readiness`'s `latest` action explicitly never recomputes -- only `refresh` does. A learner completing a real new Daily Drill would see the exact same (stale) readiness snapshot they had before completing it. Fixed by passing `completeResult.alreadyCompleted` through: a genuinely new completion calls `refreshReadiness()`, sequenced to resolve before `fetchBootstrap()` so nothing can observe the old snapshot as current; an idempotent replay still calls only `fetchLatestReadiness()`, since no new evidence was recorded and recomputing would be an unnecessary duplicate write. No local readiness calculation occurs in either branch. New `test/usePostCompleteRefresh.test.tsx` (4 tests) plus two new assertions in `test/DrillCompletion.test.tsx`.
5. **All Rev2 fixes remain intact.** Verified by re-running the full Rev2 test suite unchanged alongside the new Rev3 tests (see the combined run below) -- ratings-only restart persistence, the Reveal-required-again behavior, `BootstrapContext` entitlement sequencing, the neutral `LockedState`, full readiness reason-code rendering, the self-rated "You marked X of Y correct" wording, the `AppState` auto-refresh lifecycle, unexpected-`getSession()`-rejection safety, Home's real render tests, Home's focus refresh, the absence of external purchase steering, and the absence of any local XP/readiness/entitlement computation all still pass.
6. **Backend untouched; no contract mismatch found (confirmed).** See section 25. Rev3's own investigation (reading the deployed Edge Function source and RPC bodies directly) is exactly what surfaced item 1 -- and it confirmed the backend itself was correct throughout; only the client's own Rev2 validation had drifted from the real contract. No STOP was required.

**Rev3 validation, run clean together in this session:**
```
npx jest --runInBand
Test Suites: 13 passed, 13 total
Tests:       117 passed, 117 total

npx tsc --noEmit
(0 errors -- one cast-narrowing error was found and fixed while splitting
dailyDrill.ts's validators: `assertCommonDrillShape` returns a typed
shape object now, cast through `unknown` before the final DTO cast,
rather than using an `asserts data is {...}` type-predicate signature
that narrowed `data` too aggressively for the later `as
MobileDailyDrillResponse` cast to type-check)

npx expo lint
(0 errors, 0 warnings)

npx expo-doctor
21/21 checks passed. No issues detected!

npx expo export --platform ios
iOS Bundled 19211ms node_modules/expo-router/entry.js (1315 modules)
```

`git status`/`git diff --stat` confirm only files under `mobile-expo/` and this report changed in this revision -- no file under `portal/`, no migration, and no change to `shared/mobile-dto/index.ts`. No production deployment or live Supabase API call occurred during this revision. **No physical-device or simulator verification is claimed here** -- that remains the one outstanding step, per section 21 and section 22's exact Mac instructions.

## 29. Final pre-device navigation fix

A final independent review, otherwise approving Rev3, found one Expo Router structure issue: the Practice **tab** contains two screens -- `practice/index.tsx` (the tab root) and `practice/[drillId].tsx` (the pushed drill session screen) -- but `practice/` had no `_layout.tsx` of its own. The parent `app/(app)/_layout.tsx`'s `<Tabs.Screen name="practice" />` therefore had only a bare directory to resolve to, not a real navigator, which is the documented "Stack inside a Tab" shape Expo Router expects whenever a tab holds more than one screen.

**Fix:** `app/(app)/practice/_layout.tsx` (new) -- a nested `Stack`:

```tsx
import { Stack } from 'expo-router'

export const unstable_settings = {
  initialRouteName: 'index',
}

export default function PracticeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[drillId]" />
    </Stack>
  )
}
```

This matches the suggested shape exactly -- no SDK 57 typing/API deviation was needed. Effects:
- `<Tabs.Screen name="practice" />` in the parent layout now resolves to this whole nested navigator (confirmed by the production bundle's module count increasing by exactly 1, 1315 -> 1316 -- section 19).
- The Practice tab always lands on `index` first (`unstable_settings.initialRouteName`).
- `[drillId]` is pushed inside this same Stack, never a separate visible tab -- the tab bar stays on "Practice" the entire time a learner is in a drill, since both screens live under the one `Tabs.Screen`.
- Headers stay hidden (`headerShown: false`), matching every other screen's existing treatment -- no deliberate design reason existed to introduce one here.
- The route path (`/(app)/practice/[drillId]`), every existing `router.push`/`router.replace` call site (Home's Today's Drill card, the Practice tab's own copy, "Back to Home" from both the already-complete-drill state and the completion screen), and the completed-drill guard all continue to work completely unchanged -- this fix only added a navigator declaration, it did not touch any screen's own logic.

**Verification:** a narrow structural test (`test/practiceNavigation.test.tsx`, 2 tests) confirms the layout module declares `initialRouteName: 'index'` and renders exactly two `Stack.Screen`s named `index` and `[drillId]`, in that order -- deliberately not a full Expo Router route-resolution integration test (out of scope for this narrow fix, and unnecessary given the production bundle itself is the stronger, more authoritative proof that the navigator is real and reachable).

**Validation, run clean together in this session:**
```
npx jest --runInBand
Test Suites: 14 passed, 14 total
Tests:       119 passed, 119 total

npx tsc --noEmit
(0 errors)

npx expo lint
(0 errors, 0 warnings)

npx expo-doctor
21/21 checks passed. No issues detected!

npx expo export --platform ios
iOS Bundled 8416ms node_modules/expo-router/entry.js (1316 modules)
```

`git status`/`git diff --stat` confirm only `mobile-expo/app/(app)/practice/_layout.tsx`, `mobile-expo/test/practiceNavigation.test.tsx`, and this report changed for this fix -- no file under `portal/`, no migration, and no change to `shared/mobile-dto/index.ts`. No production deployment or live Supabase API call occurred. **No physical-device or simulator verification is claimed here** -- this fix removes the one known structural blocker to that step, but the device/simulator pass itself (section 21, section 22's exact Mac commands) still has not been performed in this sandbox.

## 30. Physical device pass (real iPhone, Expo Go) -- results and fixes

Andrew ran the app on a real physical iPhone via Expo Go, following section 22's exact commands. This is the first actual device/simulator verification this project has had -- everything before this section was built and validated in this sandbox without one.

**PASSED, exactly as designed:**
- App opens successfully in Expo Go.
- Authentication works.
- Native Home renders real production data.
- Practice tab navigation works (the section 29 nested-Stack fix holds up on device).
- Daily Drill starts correctly.
- Reveal / self-rate works.
- Force-close mid-drill, then reopen: works.
- A saved self-rating is restored after restart.
- A previously-revealed answer is **not** falsely restored as already-revealed (the section 27 item 1 reveal-deadlock fix holds up on device) -- the learner correctly has to tap Reveal again.
- No restart/resume deadlock of any kind.
- Drill completion succeeds.
- XP is awarded server-side (confirmed as a real backend write, not a client-side computation).
- Updated XP appears on Home afterward.
- Home reflects the completed Daily Drill without a manual pull-to-refresh (the section 27 item 8 focus-refresh fix holds up on device).

**FOUND, and fixed in this pass (see sections 10, 13, 24, and their respective components/tests for full detail):**
1. **Completion screen layout collapse on physical iOS** -- the title, self-rated score, XP/streak card, and readiness content were all invisible/clipped after completing a drill (Back to Home remained visible; the underlying XP/completion write had genuinely succeeded). Root cause: `Screen`'s non-scrolling branch didn't give its inner content View the height its `flex: 1` child expected. Fixed in `components/Screen.tsx` and by making the completion screen a normal scrolling `Screen`.
2. **Raw snake_case rank display** -- `student_pilot` rendered literally, wrapping mid-word in the giant numeric display font ("stud/ent_/pilot"). Fixed with presentation-only Title Case formatting (`student_pilot` -> `Student Pilot`, server value unchanged) and a smaller `MetricCard` variant for Rank.
3. **Misleading completed-drill CTA copy** -- "View Summary" promised detail the app can't actually show. Replaced with an honest, disabled "Completed" state; no backend endpoint was added to backfill a real summary (Sprint 1B+ territory).

**Explicitly noted:** the floating blue gear/menu button visible in physical-test screenshots is **Expo Go's own development UI** (its dev-menu shake/tap affordance) -- it is not part of the Apex Advantage application and will not exist in a standalone/production build.

**All ten Rev2/Rev3/navigation-fix guarantees the task asked to preserve were preserved** (verified by re-running their existing dedicated tests unchanged alongside this pass's new ones): ratings-only restart persistence, fresh-Reveal-required-after-restart, same-`session_id` resume behavior, entitlement gating, the `AppState` auth lifecycle, the malformed-response guards, Home's focus refresh, readiness reason-code rendering, the nested Practice `Stack`, the v118 Daily Drill session path, and completion idempotency.

**Validation, run clean together in this session:**
```
npx jest --runInBand
Test Suites: 16 passed, 16 total
Tests:       125 passed, 125 total

npx tsc --noEmit
(0 errors)

npx expo lint
(0 errors, 0 warnings)

npx expo-doctor
21/21 checks passed. No issues detected!

npx expo export --platform ios
iOS Bundled 6863ms node_modules/expo-router/entry.js (1316 modules)
```

`git status`/`git diff --stat` confirm only the files listed in section 24's "Physical-device-pass fix additions" and this report changed -- no file under `portal/`, no migration, and no change to `shared/mobile-dto/index.ts`. No production deployment or live Supabase API call was made by this session (the XP award and Daily Drill completion referenced above were real writes made earlier by Andrew's own device against the already-deployed backend, not something performed here). **The three fixes in this section have not yet been re-verified on the physical device** -- that retest is the next step, not something this session could perform itself.

---

**SPRINT 1A PHYSICAL DEVICE UI FIX READY -- AWAITING RETEST**
