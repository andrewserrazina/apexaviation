# Sprint 1C Reconciliation Report — Study Pack Library + Push Notification Foundation

Branch: `claude/sprint-1c-reconcile` (created fresh from `origin/main` at `f9961e3`, never merged from the old branch — every file below was ported by hand from `git show`/`git diff` against `origin/claude/sprint-1c-library-push`, which was used only as a read reference throughout).

## 1. Branch Comparison

- Merge-base of `main` and `claude/sprint-1c-library-push`: `40f2912fdeed5481d44ced41568be20548027d43`.
- At reconciliation start: `main` was 46 commits ahead of that merge-base; `claude/sprint-1c-library-push` was 16 commits ahead of it (`git rev-list --left-right --count origin/main...origin/claude/sprint-1c-library-push` → `46  16`).
- Full old-branch diff against `origin/main`: 53 files changed, 6014 insertions(+), 53 deletions(-).
- This reconciliation's diff against `origin/main` (`main...claude/sprint-1c-reconcile`): 53 files changed, 5985 insertions(+), 50 deletions(-) — nearly identical file count and size to the old branch's own diff, which is the expected shape for "port everything additively, change nothing about what's newer." The small deltas (29 fewer insertions, 3 fewer deletions) are almost entirely `shared/mobile-dto/index.ts`, where Sprint 1C's version *deleted* Sprint 3/4/4.1 readiness fields that this reconciliation deliberately did not carry forward (see §7).
- `claude/sprint-1c-library-push` itself was never merged, rebased, or fast-forwarded — it still exists at its original tip, untouched, and remains available as a reference if anything here needs to be re-checked against it.

## 2. Reconciliation Strategy

Branch created via `git checkout main && git pull && git checkout -b claude/sprint-1c-reconcile`. Every file from the old branch was individually read via `git show origin/claude/sprint-1c-library-push:<path>`, diffed against the corresponding file on current `main` (`git diff origin/main origin/claude/sprint-1c-library-push -- <path>`), and either:
- applied as a **pure addition** (new file, or an additive block/import appended to an existing file), or
- **manually merged** where the old branch's version touched something `main` had since changed (only `shared/mobile-dto/index.ts` required this — see §7), or
- **skipped** where the old branch's change would have reverted something added after it forked (nothing was found that required this beyond the DTO deletions already excluded in the merge above).

At no point was `git merge`, `git cherry-pick`, or a wholesale file copy from the old branch used without first diffing it against the current file. The `claude/sprint-1c-library-push` branch was read-only throughout.

## 3. Library

Native Study Pack Library, fully ported:
- `app/(app)/library/{_layout,index,[packId]}.tsx` — nested Stack-in-Tab layout identical in shape to the existing `practice/` tab's own `unstable_settings.initialRouteName` pattern (arrived at independently by Sprint 1C; zero adaptation needed).
- `components/library/{PackHome,LessonsView,ScenariosView,CheckrideCornerView,MasteryCheckView,QuickReferenceView,LibraryBackButton}.tsx` — all built exclusively on the existing, byte-identical design-system components (`AppText`, `Button`, `Card`, `SectionHeader`, `StateViews`, verified via empty `git diff` before porting).
- `hooks/useLibraryCatalog.ts`, `hooks/useLibraryContent.ts`.
- The placeholder `app/(app)/library.tsx` screen was deleted.

**Entitlement model**: the catalog screen resolves `owned` per pack from the authenticated `mobile-library` catalog call. The catalog card's "Open"/"View Details" button passes **only `packId`** through `router.push` — never `owned` or `name` as route params. `[packId].tsx` re-resolves both from the catalog itself and independently gates the `content` fetch on the catalog's own `owned` flag; the `mobile-library` Edge Function's `content` action re-checks entitlement server-side regardless, so a stale or spoofed client-side `owned` value fails closed to a normal retryable error, never privileged content.

## 4. Push Notifications

Full foundation ported:
- `lib/notificationOptInStorage.ts` — per-account (not per-device) opt-in flag, kept structurally distinct from OS-level permission so a shared device can never let one account's consent silently apply to another.
- `lib/pushRegistrationStorage.ts` — per-account local pointer to the device's current `mobile_devices` row.
- `lib/notifications/{expoPushConfig,pushRegistration,notificationRouting,pushMutationCoordinator}.ts`.
- `hooks/usePushRegistration.ts` (506 lines — the single owner of permission/registration/preferences state, hardened across the old branch's four independent review passes: generation-scoped staleness guards against a stale async operation committing state after an account switch/unmount; Android channel-created-before-permission-prompt ordering; fail-closed opt-out persistence).
- `hooks/useNotificationRouting.ts`, mounted once at the root layout, active regardless of auth state.
- `contexts/NotificationsContext.tsx`, mounted once inside the authenticated app shell (`app/(app)/_layout.tsx`) so the registration-sync effect runs exactly once per app session, not once per screen.
- `components/notifications/{NotificationsSection,DevNotificationTest}.tsx`, wired into Profile.
- `app.json`'s `expo-notifications` plugin block.

**Consent model**: OS notification permission and Apex-level opt-in are two independently tracked signals. Automatic re-registration on launch requires *both* — a learner who disabled notifications (opt-in cleared) is never silently re-registered just because OS permission is still granted; a different account signing in on the same device never inherits the previous account's opt-in, because the flag is stored per-user-id.

**Sign-out safety**: `AuthContext.signOut()` now revokes the device *before* the Supabase session is destroyed (revocation requires auth). `pushMutationCoordinator` closes the signing-out user's push-mutation gate and waits for any registration already in flight to finish (including its local-storage write) before reading "the final" device pointer — closing a same-account ordering race that token-pinning alone cannot close (a captured JWT can still complete a mutation after sign-out's own cleanup believed it had revoked the last device). This ordering, and the reasoning behind it, is preserved verbatim from the old branch's Rev4 review.

**Notification routing security**: a notification payload's `data` is turned into a navigation target through exactly one validated resolver (`resolveNotificationTarget`) with a fixed allowlist of shapes (`daily_drill`, `practice`, `library_pack` with a regex-validated pack id). A payload can never carry an arbitrary router path, and `library_pack` targets carry only the pack id — never an `owned`/entitlement claim (Rev2 removed that from the old branch's own contract before this reconciliation even started).

`DevNotificationTest` is `__DEV__`-gated inside the component itself, so no separate build-time exclusion was needed; it schedules a local notification only, never touches Expo's push service, and is not a substitute for real push-delivery testing (see §12).

## 5. Auth Integration

`AuthContext.tsx`'s existing stale-refresh-token handling, `AppState`-driven auto-refresh lifecycle, and sign-in flow are **unchanged**. The only addition is inside `signOut()`: before calling `supabase.auth.signOut()`, it now (a) captures `userId` from the current render's session closure, (b) calls `closeUserForSignOut(userId)` and waits for it, (c) loads and revokes that user's stored device registration if one exists, (d) clears the local pointer, and (e) releases the user's push-mutation gate in a `finally` — all wrapped so that any failure (offline, a missing local record) is logged and swallowed, never blocking or corrupting sign-out itself.

## 6. API Client Integration

`lib/api/client.ts`'s `invokeMobileFunction` gained one new optional third parameter, `options?.accessToken` — when supplied, it overrides the Authorization header supabase-js would otherwise attach from whichever session happens to be ambient at call time. Every existing caller that omits it keeps its exact prior behavior. A new exported `getPinnedAccessToken(expectedUserId)` resolves the *current* session and throws unless it still belongs to `expectedUserId` — used by `registerPushToken`/`revokePushToken`/`getNotificationPreferences`/`updateNotificationPreferences` so a mutation that started for one account can never be silently reattributed to a different one if the ambient session changes mid-flight (verified in `test/apiClient.test.ts`'s new pinning-specific test block).

`lib/api/library.ts` and `lib/api/pushToken.ts` were both hardened with the same runtime-validation convention every other mobile-* client already follows (`assertShape`/`isPlainObject`/etc. from `lib/api/validate.ts`), with their public function signatures unchanged except for the new `expectedUserId` optional parameter and the two new preference functions.

## 7. DTO Changes

`shared/mobile-dto/index.ts` was **manually merged, not copied**. Ported additively:
- Full Study Pack content type tree (`MobileStudyPackLesson`, `MobileStudyPackScenario`, `MobileStudyPackCheckrideQuestion`, `MobileStudyPackMasteryCheck`, `MobileStudyPackQuickReference`, and `MobileStudyPackContent`), narrowing `MobileLibraryContentResponse.content` from `unknown` to `MobileStudyPackContent`.
- `MobilePushTokenRegisterResponse`, `MobilePushTokenRevokeResponse`.
- `MobileNotificationPreferences`, `MobileGetPreferencesRequest`, `MobilePreferencesResponse`, `MobileUpdatePreferencesRequest`.

**Deliberately NOT ported** (this is the single highest-risk decision in the whole reconciliation): Sprint 1C's version of this file *deletes* `ReadinessEvidenceLevel`, `ReadinessCategoryBreakdown` (with its `assessable_task_count`/`evidenced_task_count`/`weak_task_count`/`strong_task_count`/`last_demonstrated_at`/`ai_dpe_reason_code` fields), `MobileReadinessSummary.category_breakdown`, and `MobileReadinessSummary`'s own exact-count fields — because the old branch forked before Sprint 3/4/4.1 added them. None of those deletions were applied. `tsc --noEmit --strict` on the merged file passes clean.

## 8. Backend

`portal/supabase/functions/mobile-push-token/index.ts` gained `get_preferences` and `update_preferences` actions; `register`/`revoke`/default-list are **byte-identical** to what was already deployed (verified via `get_edge_function` before touching the file — production was byte-identical to the pre-reconciliation `main` repo file, so nothing already-shipped was at risk). Both new actions run through the same auth-carrying (non-service-role) client every existing action already uses — `notification_preferences`' own RLS (`auth.uid() = profile_id`, confirmed enabled with `relrowsecurity = true`) is the real enforcement boundary, identity comes only from the verified JWT, never a client-supplied `profile_id`.

`validatePreferencesUpdate.ts` is a new, dependency-free validation module: allowed keys only (four booleans + `daily_drill_time`), strict type/format checks, explicit `null` rejected (never silently dropped), unknown fields (including an attempted `profile_id` override) simply never read.

No new tables or columns were needed — `mobile_devices` and `notification_preferences` already exist in production (confirmed via `execute_sql`) with exactly the shape this code expects.

**Deployed to production**: `mobile-push-token` version 2 → version 3, `verify_jwt: true`, status `ACTIVE`.

## 9. Security

- RLS confirmed enabled on `notification_preferences` with a single `ALL`-command policy scoped to `auth.uid() = profile_id` on both `USING` and `WITH CHECK`.
- Live HTTP smoke test against the deployed v3 function using a disposable account (created via anon-key signup, confirmed via SQL, signed in via password grant) proved: default list unaffected; `register`/`revoke` unaffected (byte-identical behavior to pre-deploy); `get_preferences` returns table defaults for a new account; `update_preferences` persists a partial update and leaves other fields untouched; a non-boolean value is rejected with 400; an attempted `profile_id` override in the request body is silently ignored (only the caller's own row, keyed by JWT `userId`, is ever touched); an empty update body is rejected with `No preference fields provided`. All test data (auth user, `mobile_devices` row, `notification_preferences` row) was deleted immediately after — verified zero rows remain.
- `get_advisors(type: security)` re-run after deployment: 0 ERROR-level findings, 5 pre-existing WARN-level findings (function search-path mutability, extension-in-public — all pre-existing, unrelated to this change, none mentioning `mobile-push-token` or `notification_preferences`).
- No readiness, bootstrap, auth, entitlement, or native-app security behavior added after Sprint 1C branched was reverted or weakened — the DTO merge in §7 is the direct evidence of this being upheld under the most likely place it could have failed.

## 10. Dependencies

Added `expo-device@~57.0.1` and `expo-notifications@~57.0.17` to `mobile-expo/package.json`, matching the versions Sprint 1C's own `package.json` pinned. The lockfile was **regenerated via `npm install`**, not copied from the old branch (which was 46 commits stale relative to current `main`'s other dependencies) — `git diff --stat` on the resulting `package-lock.json` shows a clean 76-line addition, no unrelated churn. `npx expo install --check` and `npx expo-doctor` both show a pre-existing minor-version drift across roughly a dozen `expo-*` packages (including ones untouched by this reconciliation, e.g. `expo-router`, `expo-splash-screen`) — `expo-device`/`expo-notifications` are pinned exactly as consistently as everything else and are not flagged as newly problematic. This drift predates this branch and was left alone per the "no opportunistic refactors" scope rule.

## 11. Tests

Ported wholesale (all pure additions, verified via diff before copying): `LibraryCatalog.test.tsx`, `LibraryPackDetail.test.tsx`, `NotificationsSection.test.tsx`, `notificationOptInStorage.test.ts`, `notificationRouting.test.ts`, `pushMutationCoordinator.test.ts`, `pushRegistration.test.ts`, `useNotificationRouting.test.tsx`, `usePushRegistration.test.tsx`. Merged additively (existing files, new test blocks appended): `apiClient.test.ts`, `apiValidation.test.ts`, `AuthContext.test.tsx`. `Screen.test.tsx` and `security.test.ts` were unchanged by the old branch and needed no action.

Backend: `test/run_security_regression_tests.sh` gained one new section (compiles `validatePreferencesUpdate.ts` with `tsc` and runs `test/mobile_push_token_validatePreferencesUpdate.test.mjs` under plain Node — the same pattern already used for `validateAcsTaskId.ts`), appended immediately before the results summary so it participates in the existing pass/fail tally.

**Results**: `tsc --noEmit` clean. `expo lint` clean. Jest: 30/30 suites, 392/392 tests passing. Backend security regression suite (against a rebuilt local Postgres 16 test database): 383/383 passing, 0 failures — including all pre-existing Sprint 0/1A/1B/4/4.1 sections (nothing regressed) and the new `validatePreferencesUpdate()` Node unit tests (18/18 passing).

## 12. Mobile Smoke Test

**Not performed as a physical-device/native-build test** — this execution environment has no physical iOS/Android device, no EAS build capability, and no Expo Go/native runtime attached. What *was* verified instead: `expo lint`, `tsc --noEmit`, `expo-doctor`, the full Jest suite (which exercises `usePushRegistration`, `useNotificationRouting`, and the Library screens' render logic against mocked native modules), and a live HTTP-level exercise of the deployed Edge Function against a disposable account (§9). No push notification of any kind — test or production — was sent to any organic user or device; the only "notification" involved in this reconciliation was `DevNotificationTest`'s local-only scheduled notification, which was read but not triggered, since doing so would require a running app instance this environment doesn't have. Before this branch ships, a real physical-device smoke test (Library catalog → pack detail → each content surface; Enable/Disable Notifications on a real device; sign-out revocation confirmed via a `mobile_devices` row check; a local `DevNotificationTest` tap confirmed to route to Practice) is still required and is called out explicitly in §13.

## 13. Known Limitations

- Physical-device/native-build smoke testing has not been performed (§12) — required before this branch merges to a release channel a real user will run.
- The pre-existing `expo-*` minor-version drift (§10) was left untouched; it existed before this branch and affects packages this reconciliation didn't touch.
- No new push notifications are actually *sent* by the server yet (no scheduler, no send-side Edge Function) — this reconciliation only lands the registration/preferences/routing foundation, matching the old branch's own documented scope. `AuthContext.tsx`'s own comment (carried forward verbatim) flags that the shared-device/token-ownership question this leaves must be explicitly re-reviewed before any future server-initiated sender is turned on.
- `claude/sprint-1c-library-push` itself was left untouched and unmerged; it can be archived once this branch is confirmed as its replacement.

## 14. Old Branch Status

`claude/sprint-1c-library-push` was used exclusively as a read-only reference (`git show`/`git diff`) throughout this reconciliation. No `git merge`, cherry-pick, or branch reset was performed against it, and it was never checked out. It remains at its original tip on `origin`, unchanged, and can be deleted/archived once this reconciliation branch is accepted as its replacement — no further work should be built on it directly.

## 15. Merge Recommendation

All 18 success criteria from the reconciliation spec are satisfied except physical-device verification (§12), which is explicitly flagged rather than fabricated. Current `main` was treated as authoritative throughout; the one real conflict (`shared/mobile-dto/index.ts`) was resolved by additive merge, preserving every Sprint 3/4/4.1 readiness field. Full local validation (typecheck, lint, 392 Jest tests, 383 backend regression tests) passes with zero failures, and the deployed Edge Function was live-smoke-tested against a disposable account with full cleanup. No unrelated web portal work was touched.

**MERGE RECONCILED SPRINT 1C** — conditional on a physical-device smoke test pass (§12) before this reaches real users; nothing in the code itself blocks the merge.
