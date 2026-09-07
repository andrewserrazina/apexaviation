# Sprint 1B -- Practice Expansion

Status: **Stage 1 (v119 backend contract, deployed and production-verified) and Stage 2 / Sprint 1B.1 (native Practice Hub + ad-hoc practice UI) are both complete in source. Sprint 1B.1 has NOT been merged to main, has NOT been submitted to TestFlight/App Store, and has NOT been verified on a physical device -- see "Sprint 1B.1 -- Native Practice Expansion" below for the full report and its explicit stop-gate confirmations.**

## Objective

Sprint 1A shipped Practice as a Daily-Drill-only surface: one curated, server-generated session per day, driven entirely through the v118 Daily Drill / mobile-practice bridge. Sprint 1B turns Practice into a repeatable, on-demand oral-exam training experience -- a learner can start a fresh ad-hoc practice session at any time, optionally scoped to a specific ACS task, without waiting for or being limited to today's one curated drill.

This must happen **without regressing any of the guarantees Sprint 1A's four review rounds (Rev2, Rev3, the navigation fix, the physical-device pass) already established and physically verified**. Specifically, every native Practice surface -- Daily Drill and the new ad-hoc mode alike -- must continue to uphold:

- **Server-authoritative sessions** -- the phone never selects, supplies, or reorders question IDs; every session's question set is decided and stored server-side.
- **Reveal-before-rating** -- a learner never sees a model answer, common mistakes, DPE-evaluating notes, or real-world application text before tapping Reveal, and self-rating controls stay hidden until that reveal has happened.
- **Self-assessment semantics** -- `correct` / `partial` / `incorrect` are the learner's own self-rating of an oral answer they spoke aloud, never an objectively auto-graded response. Every wire value, every completion-screen phrasing, must keep saying so honestly (Sprint 1A Rev2 section 5's "You marked X of Y correct" precedent).
- **Idempotent completion** -- completing the same session twice (a network retry, a duplicate tap) must never double-write evidence, task progress, or XP. `already_completed: true` is success, not an error.
- **Shared XP/readiness/evidence pipeline** -- no mobile-only XP schedule, no mobile-only completion event, no client-side XP calculation. The one shared `award_xp_on_practice_attempt` trigger (v117) remains the sole XP authority for every practice mode, ad-hoc included. Readiness/evidence are RPC- and trigger-authoritative, never recomputed on-device.
- **Restart/resume resilience** -- a learner who force-closes mid-session, loses connectivity, or backgrounds the app must be able to come back to the *same* session (not a fresh, differently-shuffled one) with their already-answered questions intact. Sprint 1A's Daily Drill flow proved this pattern on a physical device (Rev2 section 1's ratings-only local persistence + a fresh Reveal required after restart); ad-hoc practice needs the equivalent guarantee, but ad-hoc sessions have no Daily Drill row to anchor them to, so the *session itself* must be independently resumable from the server, not just from local device storage.
- **Entitlement enforcement** -- every practice action re-checks Checkride Prep access the same way Daily Drill already does; no new session-creation path bypasses `requirePremiumAccess()`.
- **No client-side business-rule duplication** -- no local XP arithmetic, no local readiness computation, no local re-implementation of what "eligible question" or "mapped to this ACS task" means. The phone renders what the server decided.

## Staged delivery

This Sprint is being delivered in stages, each independently reviewed before the next begins:

1. **Stage 1 (COMPLETE, deployed and production-verified)** -- audited the current `mobile-practice` contract against the two known-suspect behaviors named in the kickoff (a silent fallback to unrelated general questions when a targeted ACS-task start has zero mapped content, and the absence of an authenticated resume action), confirmed both, and shipped a narrowly-scoped v119 backend contract hardening: fail-closed targeted start, a new authenticated `resume` action, and question-set integrity validation on resume. See `SPRINT_1B_V119_PRACTICE_CONTRACT_REPORT.md` for the full audit findings and implementation detail.
2. **Stage 2 / Sprint 1B.1 (COMPLETE IN SOURCE, not yet merged/deployed/device-tested)** -- built the native ad-hoc Practice UI in `mobile-expo/` on top of v119: the Practice Hub (Quick/Standard/Weak-Area practice, Continue Practice), the ad-hoc session route using the `resume` action, and the Practice tab's old "more practice modes coming" placeholder is now real. Superseded the "future, not started" note this line originally carried -- see "Sprint 1B.1 -- Native Practice Expansion" and its Rev2/Rev3 follow-ups below for the full implementation, fix, and validation history.

## Explicitly out of scope for all of Sprint 1B unless a stage says otherwise

- Daily Drill's own generation algorithm, question selection, or v118 session-linking behavior.
- The readiness algorithm and its scoring weights.
- The ACS task/content mapping model itself (`content_acs_mappings`, `acs_task_applicability`).
- Entitlement/Checkride-Prep-unlock rules.
- Stripe, the web portal, Ground School, Library, and push notifications.
- Any production deployment or database migration application -- every stage that touches the backend contract is source-controlled and reviewed first.

---

# Sprint 1B.1 -- Native Practice Expansion

**Backend status: unchanged.** This stage built exclusively on the already-deployed, production-verified v119 `mobile-practice` contract (`start`, `resume`, `reveal`, `complete`). No migration, no Edge Function, no RPC, no production Supabase state was touched. No backend behavior changed. This is confirmed again explicitly at the end of this section.

## What shipped

The Practice tab's old "Today's Drill, plus more practice modes coming" placeholder is replaced with a real, repeatable on-demand practice hub, entirely inside `mobile-expo/`.

### 1. Practice Hub (`app/(app)/practice/index.tsx`, full rewrite)

Maintains the exact same bootstrap gating order Home and the rest of Sprint 1A already established -- loading -> retryable error (never confused with locked access) -> `LockedState` for an unentitled account -> the real hub. No premium API call (Daily Drill or ad-hoc practice) fires before bootstrap has resolved and confirmed entitlement.

The hub contains, top to bottom:
- **Today's Drill** -- unchanged card/behavior, still independently usable even while an ad-hoc session is active.
- **Continue Practice** -- shown when a locally-known unfinished ad-hoc session exists (title + "`N` of `M` rated" progress pulled from the existing `drillProgressStorage` cache), with a single "Continue ->" action that resumes the exact server session.
- **Quick Practice** (5 questions) and **Standard Practice** (10 questions) cards, each calling `startAdHocPractice` with only `session_size` -- no `acs_task_id`.
- **Practice Your Weak Areas** -- renders up to the first three entries of `bootstrap.data.home.weak_areas` (server-computed, never locally calculated), each showing exactly `area_code.task_code` and `Evidence: NN%` -- no invented ACS task titles, since the current bootstrap DTO doesn't supply one. A targeted Start uses the bootstrap-provided `acs_task_id` verbatim; the client never constructs or infers an ACS UUID. An empty `weak_areas` array renders an honest "Complete more practice and Apex will identify areas worth targeting" message, never a fabricated area.
- A targeted Start that gets v119's fail-closed 404 (`not_found`) shows a friendly inline message ("No practice questions are available for this ACS task yet.") on that specific card -- no crash, no navigation, and no local active-session record is ever created for a Start that never actually produced a session.
- While a valid local active ad-hoc session exists, Quick/Standard/Weak-Area Start buttons are disabled with the helper copy "Finish your current practice session before starting another" -- Today's Drill is explicitly exempted from this. No backend session-abandonment endpoint was added or is needed for this.
- Start is debounced via an in-flight ref (matching `useDrillSession`'s existing `completeInFlight` pattern) so a double tap can never fire two Start requests.
- A successful Start persists the local `ActivePracticeSession` pointer (best-effort -- a persistence failure still navigates, since the server session is already valid) and navigates to `practice/session/[sessionId]`.
- The hub refreshes bootstrap, Daily Drill, and the local active-session pointer on focus (skipping the first mount, matching Home's established pattern) so completing an ad-hoc session elsewhere makes Continue Practice disappear and updated weak areas appear without a manual pull-to-refresh, and without ever auto-starting anything.

### 2. Active ad-hoc session persistence (`lib/activePracticeStorage.ts`, new)

Since v119's `resume` action requires a `session_id` and the backend has no "list my unfinished sessions" endpoint, this narrow module is the only place "does this learner have an unfinished ad-hoc session" is known locally. It stores only `{sessionId, userId, kind, title, startedAt, sessionSize, acsTaskId?, areaCode?, taskCode?}` -- never `model_answer`, `common_mistakes`, `dpe_evaluating`, or `real_world_application`.

Storage is keyed `apex-advantage-active-practice:<userId>` (one active session per user, not per session id) -- proven, not just asserted, by 8 tests exercising the real AsyncStorage jest mock: a session saved for one user is never returned for a different user, two users can each have their own session on the same device simultaneously, clearing one user's pointer never touches another's, and corrupt/incomplete/mismatched stored JSON all fail safe to `null` rather than throwing or returning bad data. The hook and screen treat the server's `resume` response as authoritative in every case -- this local record is only ever a pointer to what to resume, never a substitute for server state.

### 3. V119 mobile API client hardening (`lib/api/practice.ts`, rewritten)

Added `resumePractice(sessionId)`, calling `mobile-practice` with `action: 'resume'` and consuming the shared `MobilePracticeResumeRequest`/`MobilePracticeResumeResponse` DTOs. Both `startAdHocPractice()` and the new `resumePractice()` now run through a shared `assertCommonPracticeShape()` validator (the same defensive pattern `dailyDrill.ts` already established) checking `session_id`/`mode`/`started_at` are non-empty strings, `target_acs_tasks` is an array of valid ACS task refs, and `questions` is a non-empty array of valid questions; `resume` additionally validates `completed_at` is `null` or a string. A malformed HTTP 200 from either action is never trusted -- it becomes a normalized `ApiError` (`kind: 'server'`), the same as every other rendered mobile API response in this codebase.

### 4. Ad-hoc session route + controller (`app/(app)/practice/session/[sessionId].tsx`, `hooks/useAdHocPracticeSession.ts`, both new)

A dedicated hook, deliberately kept separate from `useDrillSession` rather than branching inside it, reusing the same `drillSessionReducer`, `RevealContent`, `RatingButtons`, and `ProgressIndicator` primitives. It never creates a session -- Start only ever happens on the hub; this route always calls v119's `resume` action, which returns the exact stored question order. Saved self-ratings restore from the existing `drillProgressStorage` cache by `session_id`; **reveal state and debrief content never restore** -- a learner returning after a force-close always sees an unrevealed question and must tap Reveal again before their prior rating reappears, matching Sprint 1A's Daily Drill restart guarantee exactly, with no deadlock.

The route itself independently enforces the same bootstrap/entitlement gating as the hub (Sprint 1B.1 section 13) since it's reachable via deep link or a resumed last-route without ever passing through the hub -- `enabled` only becomes `true` once bootstrap has resolved, has no error, has data, and reports the learner entitled. No resume call fires before that.

Three additional outcomes are handled explicitly:
- **Already-completed resume** -- v119 may resume a session whose `completed_at` is already set. The hook never re-completes it; it clears the stale local active-session pointer and local ratings for that session immediately, and the screen shows "This practice session is already complete" with a "Back to Practice" CTA, promising no historical score detail the resume DTO doesn't actually carry.
- **Permanent resume failure** (`not_found` / `forbidden`) -- offers an explicit "Remove Saved Session" recovery action alongside Retry, clearing only the local pointer and rating cache (never touching the server attempt), so a stale local pointer never traps the learner behind permanently disabled mode buttons.
- **Transient resume failure** (network/server) -- offers Retry only. A momentary failure never silently discards a perfectly valid, still-resumable local session pointer.

Completing a session reuses Sprint 1A's completion experience via a newly extracted `PracticeCompletionView` component (title/score line/CTA are the only parameters; Daily Drill's own, physically-verified completion output is preserved byte-for-byte -- proven by `DrillCompletion.test.tsx` continuing to pass unchanged against the refactor). The ad-hoc completion screen phrases the score as self-rated ("You marked X of Y correct in `<mode>`"), shows the real refreshed `ReadinessCard`, and its CTA reads "Back to Practice" (never "Back to Home" -- that wording is exclusive to Daily Drill's own completion screen, which is unchanged).

### 5. Navigation (`app/(app)/practice/_layout.tsx`)

The Practice tab's nested Stack now declares three screens (`index`, `[drillId]`, `session/[sessionId]`), `index` still first/default. Daily Drill's own `practice/[drillId]` navigation is unaffected -- proven by `practiceNavigation.test.tsx` and `DrillCompletion.test.tsx` continuing to pass unchanged.

## Explicitly not implemented in this stage (per the kickoff's stated scope)

Timer-based Rapid Fire, a full mock checkride mode, voice AI Oral, Library, push notifications, in-app purchase / checkout links / any external-purchase CTA, offline sync, cross-device unfinished-session discovery, a backend session-abandonment endpoint, and a historical practice browser. No new analytics subsystem was built -- this codebase currently has no existing mobile analytics-event helper to extend, so none was added; this is a scope omission to flag, not a gap silently filled.

## Files changed

**New:**
- `mobile-expo/lib/activePracticeStorage.ts`
- `mobile-expo/hooks/useAdHocPracticeSession.ts`
- `mobile-expo/components/PracticeCompletionView.tsx`
- `mobile-expo/app/(app)/practice/session/[sessionId].tsx`
- `mobile-expo/test/activePracticeStorage.test.ts`
- `mobile-expo/test/PracticeHub.test.tsx`
- `mobile-expo/test/useAdHocPracticeSession.test.tsx`
- `mobile-expo/test/AdHocPracticeSessionScreen.test.tsx`

**Modified:**
- `mobile-expo/app/(app)/practice/index.tsx` (full rewrite -- the Practice Hub)
- `mobile-expo/app/(app)/practice/[drillId].tsx` (completion screen refactored onto the shared `PracticeCompletionView`; Daily Drill's own rendered output is unchanged)
- `mobile-expo/app/(app)/practice/_layout.tsx` (third nested-Stack screen added)
- `mobile-expo/lib/api/practice.ts` (added `resumePractice`; hardened `startAdHocPractice` with the same runtime-validation pattern the rest of the client already uses)
- `mobile-expo/lib/api/validate.ts` (added `isValidAcsTaskRef`)
- `mobile-expo/test/apiClient.test.ts`, `test/apiValidation.test.ts`, `test/entitlementGating.test.tsx`, `test/practiceNavigation.test.tsx` (updated for the new route/hardened validation; no assertion was weakened -- each change is a direct, necessary consequence of the new nested route or the newly-added strict response validation)

**Not touched:** the v119 migration, the `mobile-practice` Edge Function, `mobile-daily-drill`, the readiness algorithm, XP triggers, the ACS mapping schema, Stripe, the web portal, Ground School, Library, and push notifications.

## Test coverage

56 new tests were added across five new/extended files, targeting every numbered item in the kickoff's test list:

| Area | File | Tests |
|---|---|---|
| API response validation (items 1-6) | `test/apiValidation.test.ts` | 9 (new, in the existing file) |
| Practice Hub gating, Start shapes, disabling, empty states (items 7-18) | `test/PracticeHub.test.tsx` | 13 |
| Local storage user-scoping and corruption safety (items 19-22) | `test/activePracticeStorage.test.ts` | 8 |
| Ad-hoc session hook: resume, reveal/rate/next, complete, already-completed, error classification (items 25-41 core logic) | `test/useAdHocPracticeSession.test.tsx` | 14 |
| Ad-hoc session screen: bootstrap gating (items 23-24), CTA/copy/recovery-button behavior (items 31, 35-37, 40) | `test/AdHocPracticeSessionScreen.test.tsx` | 12 |

Regression items 42-47 (Daily Drill navigation, restart/reveal guarantee, completion wording/readiness, Home focus refresh, entitlement gating, auth lifecycle) are covered by the pre-existing `practiceNavigation.test.tsx`, `DrillCompletion.test.tsx`, `HomeFocusRefresh.test.tsx`, `entitlementGating.test.tsx`, and `AuthContext.test.tsx` -- all of which continue to pass unchanged (three of them required a small, documented update to accommodate the new nested route or new imports; no assertion was weakened).

**A real bug was found and fixed during this work, not shipped:** the first draft of `PracticeHub.test.tsx` had 5 of its 13 tests fail only when the full file ran together (never in isolation). Root cause: firing three synchronous `fireEvent.press()` calls back-to-back against an async `onPress` handler, and a manually-resolved mock promise outside `act()`, both left React with unflushed, overlapping `act()` scopes that leaked into whichever test ran next. Fixed by wrapping each press and the manual promise resolution in its own awaited `act()` call. This was a test-harness-only fix -- no production code changed as a result, and the full file, and the full suite, now pass consistently across repeated runs.

## Validation results

All run from `mobile-expo/` unless noted:

- `npm test -- --runInBand` -- **20 suites, 181 tests, 0 failed.** Re-run three times consecutively with identical results (no flakiness).
- `npm run typecheck` -- clean, 0 errors.
- `npm run lint` -- clean, 0 errors, 0 warnings (`expo lint`, uncached).
- `npx expo-doctor` -- 21/21 checks passed.
- `npx expo export --platform ios` -- exported successfully.
- `test/run_security_regression_tests.sh` (repo root, backend regression suite) -- **364 passed, 0 failed** -- byte-identical to the pre-existing baseline. This is expected and required: no backend file was touched in this stage.

## Known limitations

- No physical-device verification has occurred for any part of this stage -- everything above is source-level and simulator/Jest-level validation only.
- ~~The "Remove Saved Session" recovery action is offered for `not_found`/`forbidden` resume errors only; v119's `invalid_question_set` failure mode ... is conservatively treated as retry-only rather than immediately offering local-clear recovery.~~ **Superseded by Rev2 below**: `invalid_question_set` now classifies as a `permanent` resume failure (its machine-readable `code` is preserved through 5xx normalization) and DOES offer "Remove Saved Session" -- this limitation no longer applies.
- No mobile analytics events were added for any new Practice Hub or ad-hoc session interaction, since no existing analytics helper exists in `mobile-expo/` to extend -- flagged per the kickoff's instruction rather than building a new subsystem to fill the gap.
- Cross-device unfinished-session discovery, session abandonment, and a historical practice browser remain unimplemented, as explicitly scoped out of this stage.

## Explicit confirmations

- **No backend change occurred.** No migration was written or applied, no Edge Function was modified or deployed, no RPC was added or altered, and no production Supabase state was touched at any point in this stage. The backend regression suite's unchanged 364/0 result is direct evidence of this.
- **No merge to `main` occurred.** All work remains on `claude/sprint-1b-practice-expansion`.
- **No TestFlight/App Store build was submitted, and no physical-device testing has occurred.** Everything above is Jest/simulator/source-level validation only.

**SPRINT 1B.1 NATIVE PRACTICE EXPANSION READY — AWAITING SOURCE REVIEW**

---

# Sprint 1B.1 Rev2 — Independent Source Review Fixes

Five native-client issues identified by independent source review of commit `1cd849b8ca2109e5d6fa72f65a23f76f122dd0d2` are fixed below. **No backend file changed in this revision** -- every fix is scoped to `mobile-expo/`, confirmed at the end of this section by diffing against that commit.

## 1. Active-session load race could create orphaned sessions

`app/(app)/practice/index.tsx`'s per-user active-session pointer lookup (`loadActive()`) is itself asynchronous. The previous `disableNewAdHoc = starting || hasActiveAdHoc` formula left Quick/Standard/Weak-Area Start enabled while that lookup was still pending -- `hasActiveAdHoc` was `false` not because no session existed, but because it wasn't known yet. A learner who tapped Start in that window while a real unfinished session already existed could create a second, orphaned server attempt.

Fixed: `disableNewAdHoc = starting || !activeSessionLoaded || hasActiveAdHoc`. New ad-hoc Starts now stay disabled until the lookup has actually completed, whatever it finds. Today's Drill is unaffected -- it has its own, independent resume mechanism and was never gated on this pointer. A restrained inline caption ("Checking for an existing practice session…") replaces the "Finish your current..." copy during the pending window, rather than hiding the whole hub.

## 2. Active-pointer clear was per-user, not per-session

The active-session pointer is a single slot per user (`apex-advantage-active-practice:<userId>`), not one per `session_id`. The hook previously cleared it with a blind `clearActivePracticeSession(userId)` after successful completion, already-completed-resume cleanup, and "Remove Saved Session" -- any of which could silently wipe out a *different*, still-unfinished session's saved pointer (e.g. a learner with saved active "Session B" who deep-links to an older, already-completed "Session A").

Fixed: added `clearActivePracticeSessionIfMatches(userId, sessionId)` to `lib/activePracticeStorage.ts` -- a compare-and-clear that loads the current pointer, and only removes it if `pointer.sessionId === sessionId`; a mismatched or absent pointer is left untouched. All three call sites in `useAdHocPracticeSession.ts` (`complete()`, the already-completed branch of `resume()`, `removeSavedSession()`) now use this instead of the blind clear.

## 3. Completion UI could render before local cleanup finished

`complete()` previously called `setCompleteResult(...)` (which renders the completion screen and its "Back to Practice" CTA) *before* awaiting `clearDrillProgress`/`clearActivePracticeSessionIfMatches`. On a slower device, a learner could tap "Back to Practice" and return to a hub whose focus-refresh ran before that cleanup had actually written its result, briefly showing a stale "Continue Practice" card for an already-completed session. The already-completed-resume branch had the same ordering problem with `alreadyCompletedOnResume`.

Fixed: both cleanup calls are now awaited *before* `setCompleteResult(...)` / `setAlreadyCompletedOnResume(true)` are called. These storage helpers already fail safe internally (they never throw), so awaiting them cannot turn a successful server completion into a failure -- proven by a dedicated test.

## 4. `invalid_question_set` was permanently unrecoverable

v119's `resume` action returns `{ error, code: 'invalid_question_set' }` with HTTP 500 for a genuinely corrupt stored question set -- a permanent, per-session failure, never a transient one. `invokeMobileFunction()`'s 5xx branch called `serverError(error, status)`, which discarded the extracted `code`, so `classifyResumeError()` only ever saw `kind: 'server'` -- indistinguishable from an ordinary infra failure -- and classified it transient. That meant Retry was offered forever and "Remove Saved Session" was never offered, permanently stranding the learner behind disabled Quick/Standard/Weak-Area buttons (a session pointer that could never resolve, and no way to clear it).

Fixed: `serverError(raw, status, code?)` (`lib/api/errors.ts`) now accepts and preserves the machine-readable `code`; `client.ts`'s 5xx branch passes it through (`serverError(error, status, code)`). `classifyResumeError()` now checks `error.kind === 'server' && error.code === 'invalid_question_set'` and classifies it `permanent`, offering "Remove Saved Session." Every other server-kind error (no code, or a different/unknown code) still classifies `transient` -- this is deliberately narrow, not "every server error is permanent." The learner-facing message stays the existing generic, safe one; only the internal `code` field (never rendered) changed.

## 5. Bootstrap `weak_areas` had no per-item runtime validation

Before Sprint 1B.1, `home.weak_areas` only needed to be checked as an array. Sprint 1B.1 now directly renders `area_code`/`task_code`/`evidence_score` and passes `acs_task_id` straight through, unmodified, as a targeted Start's request body -- a malformed or `undefined` `acs_task_id` can be silently omitted during JSON serialization, which would make v119's server interpret the request as *general* practice, degrading a visually-targeted "Practice I.A" CTA into untargeted practice without any indication to the learner.

Fixed: added `isValidWeakArea()` to `lib/api/validate.ts`, building on the existing `isValidAcsTaskRef()` rather than duplicating its field checks, additionally requiring non-empty `area_code`/`task_code` and a finite `evidence_score` in the same `0..1` range `task_evidence.evidence_score` is authoritatively stored in server-side (confirmed by reading `supabase-portal-schema-v114-readiness-snapshots.sql`'s `weak_tasks` aggregation -- read-only, not modified). `bootstrap.ts`'s `isValidBootstrap()` now requires `home.weak_areas.every(isValidWeakArea)`. A malformed bootstrap 200 becomes the same normalized `ApiError` every other malformed response already produces -- Practice renders the retryable bootstrap error, and no targeted Start CTA can ever be built from malformed data.

## Storage hardening (small addition, while touching `activePracticeStorage.ts`)

A stored `ActivePracticeSession` record with a non-integer, zero, or negative `sessionSize`, or an empty `title`/`startedAt`/optional `acsTaskId`/`areaCode`/`taskCode`, is exactly as unusable to the UI as a missing field -- now rejected the same way (`loadActivePracticeSession` returns `null`), rather than silently rendering "0 of 0 rated" or a blank title. This stays local corruption defense only, not a schema-validation library.

## Files changed (Rev2)

All within `mobile-expo/`:

- `app/(app)/practice/index.tsx` -- blocker 1 (disable formula + pending-lookup caption)
- `lib/activePracticeStorage.ts` -- blocker 2 (`clearActivePracticeSessionIfMatches`) + storage hardening
- `hooks/useAdHocPracticeSession.ts` -- blockers 2, 3, 4
- `lib/api/errors.ts` -- blocker 4 (`serverError` now carries `code`)
- `lib/api/client.ts` -- blocker 4 (passes `code` through on 5xx)
- `lib/api/validate.ts` -- blocker 5 (`isValidWeakArea`)
- `lib/api/bootstrap.ts` -- blocker 5 (validates every `weak_areas` item)
- `test/PracticeHub.test.tsx`, `test/activePracticeStorage.test.ts`, `test/useAdHocPracticeSession.test.tsx`, `test/apiClient.test.ts`, `test/apiValidation.test.ts`, `test/entitlementGating.test.tsx` -- extended
- `test/useAdHocPracticeSession.sessionMatchedCleanup.test.tsx` -- new (end-to-end, real-storage proof for blocker 2)

## New test coverage (Rev2)

40 new tests were added, covering each blocker's required shapes:

| Blocker | Coverage |
|---|---|
| A. Active pointer load unresolved -> Starts disabled | 3 new tests in `PracticeHub.test.tsx` (`active-session lookup race` describe block): disabled + no `startAdHocPractice` call + Today's Drill usable while pending; enabled once resolved null; stays disabled once resolved to an existing pointer |
| B. Session-matched pointer clearing | 4 real-storage tests in `activePracticeStorage.test.ts` (matching removed / mismatching preserved / no-pointer no-op / never affects a different user even with the same session id) + 4 end-to-end tests in the new `useAdHocPracticeSession.sessionMatchedCleanup.test.tsx` (complete/already-completed-resume/Remove-Saved-Session on Session A never clears a saved Session B; completing Session A does clear its own matching pointer) + updated call-shape assertions in `useAdHocPracticeSession.test.tsx` |
| C. Cleanup-before-completion-render ordering | 3 new tests in `useAdHocPracticeSession.test.tsx`'s `cleanup-before-render ordering` describe block: `completeResult` stays null while cleanup is pending; `alreadyCompletedOnResume` stays false while cleanup is pending, then becomes true once it settles; a successful completion still resolves even when cleanup internally no-ops |
| D. `invalid_question_set` permanent classification | 2 unit tests + 1 end-to-end hook test in `useAdHocPracticeSession.test.tsx`; 2 tests in `apiClient.test.ts` proving `code` survives a 5xx and the learner-facing message stays generic |
| E. Weak-area bootstrap runtime validation | 13 new tests in `apiValidation.test.ts` (missing/empty `acs_task_id`/`area_code`/`task_code`, non-numeric/NaN/Infinity/out-of-range `evidence_score`, boundary values 0 and 1 accepted, empty array accepted) |
| Storage hardening | 8 new tests in `activePracticeStorage.test.ts` (bad `sessionSize` values, empty `title`/`startedAt`/`acsTaskId`, valid populated record accepted) |

## Validation results (Rev2)

All run from `mobile-expo/`:

- `npm test -- --runInBand` run three consecutive times: **21 suites, 221 tests, 0 failed, all three runs identical.** (Baseline before Rev2 was 20 suites / 181 tests; Rev2 added one new test file and extended six existing ones.)
- `npm run typecheck` -- clean, 0 errors.
- `npm run lint` -- clean, 0 errors, 0 warnings.
- `npx expo-doctor` -- 21/21 checks passed.
- `npx expo export --platform ios` -- exported successfully.
- `test/run_security_regression_tests.sh` (repo root) -- **364 passed, 0 failed** -- byte-identical to the pre-Rev2 baseline, confirming no backend behavior changed.

## Diff scope confirmation

`git diff --stat 1cd849b8ca2109e5d6fa72f65a23f76f122dd0d2` shows changes in exactly 13 files, all under `mobile-expo/` (7 source/test files modified for the fixes, 6 test files extended, 1 new test file) plus this report. Nothing under `portal/`, `shared/`, `test/run_security_regression_tests.sh`, or `test/sql/` changed -- the shared DTO was read (to confirm `evidence_score`'s `0..1` range and v119's exact `invalid_question_set` response shape) but not modified; no factual defect in it was found.

## Explicit confirmations (Rev2)

- **No backend file was modified, no migration applied, no Edge Function deployed, no production Supabase state touched.** The backend regression suite's unchanged 364/0 result is direct evidence.
- **No deployment occurred** -- Supabase, TestFlight, and the App Store are all untouched.
- **No merge to `main` occurred.** All work remains on `claude/sprint-1b-practice-expansion`.
- **Physical-device testing remains pending**, as it was after the initial Sprint 1B.1 pass -- everything above is Jest/simulator/source-level validation only.

**SPRINT 1B.1 REV2 NATIVE PRACTICE FIXES READY — AWAITING SOURCE REVIEW**

---

# Sprint 1B.1 Rev3 — Return-to-Practice Focus Race Fix

One remaining client lifecycle race, found by independent source review of commit `12220fa18e9159f41f8ba1e828a08ff22141d7fa`, is fixed below. **No backend file changed in this revision.**

## The blocker: return-to-practice focus race

Rev2's blocker 1 fix closed the active-session load race for the *initial* mount, but the Practice hub stays **mounted** underneath the nested Stack while the learner is on the ad-hoc session route -- it is never remounted on Back. That means a fresh AsyncStorage lookup runs on every `useFocusEffect` return, not just on first mount, and the SAME race could reopen there: `loadActive()`'s pending-lookup flag (`activeSessionLoaded = false`) wasn't set until after `bootstrap.ready`/`bootstrap.entitled`/`uid` checks, and there was no synchronous ref a same-frame double-tap could be checked against. A learner who started Quick Practice, backed out before finishing, and immediately tapped Start again during that focus-triggered re-check's pending window could create a second, orphaned server attempt.

## Fix A -- every active-session lookup enters a pending state synchronously

`loadActive()` (`app/(app)/practice/index.tsx`) now sets a new `activeLookupInFlight` ref to `true` **and** calls `setActiveSessionLoaded(false)` before its first `await`, wrapping the actual lookup in a `try/finally` that always resets both. `handleStart()`'s guard now checks `activeLookupInFlight.current` directly (a synchronous ref read, not dependent on a render having committed) in addition to the existing `disableNewAdHoc` render-state check -- closing the same-frame gap between "a lookup started" and "the re-render that reflects it." This applies uniformly whether the lookup is the initial mount's or a focus-return's re-check; Today's Drill remains independent and unaffected.

## Fix B -- a successful Start publishes into the hub's own memory immediately

`handleStart()` now calls `setActiveSession(record)`, `setActiveProgress({ rated: 0, total: record.sessionSize })`, and `setActiveSessionLoaded(true)` **before** the best-effort `saveActivePracticeSession(record)` call and the `router.push(...)` navigation -- not after. Since the hub stays mounted underneath the session route, it now already knows a session exists the instant Start succeeds, rather than only finding out via a later focus-triggered AsyncStorage read. This means: a fast Back before the navigation transition (or the local persistence write) finishes no longer briefly exposes a no-active-session state, and even a failed local persistence write still leaves the *running app's* in-memory guard intact for the remainder of that process's lifetime. The documented best-effort local-storage limitation is unchanged: if the process itself dies before persistence completes, the pointer still cannot be recovered on a fresh launch -- no backend discovery endpoint was invented to cover that case, matching the explicit instruction not to.

## Test coverage (Rev3)

2 new tests were added to `test/PracticeHub.test.tsx`:

- **`return-to-practice focus race (Rev3)`** describe block (1 test): captures the real `useFocusEffect` callback (previously mocked as a bare `jest.fn()` that never actually invoked its argument, so this path was never exercised) and drives the full scenario end-to-end -- initial load resolves null, Start Quick succeeds, the learner "leaves and returns" (first focus-callback invocation is the initial-mount focus the `hasFocusedOnce` guard skips, matching real navigation; the second is the actual return-to-focus), a deferred `loadActivePracticeSession` promise simulates the lookup staying pending, and while pending: Quick/Standard/Weak-Area stay disabled, `startAdHocPractice` cannot fire a second time, and Today's Drill remains usable. Resolving the lookup then shows Continue Practice with Starts still disabled.
- **`a successful Start publishes the active session into the hub's own memory immediately, with no second lookup required`**: proves Fix B directly -- Continue Practice and the disabled state appear from the single initial-mount lookup call, with no second `loadActivePracticeSession` call required, and an immediate re-press cannot fire a second Start.

**A second, unrelated test-order-flakiness bug was found and fixed during this work, not shipped:** the first draft of the new focus-race test corrupted the *next* test in the file (`Today's Drill stays enabled...`) when the full file ran together, even though every individual test passed in isolation -- diagnosed via a stray `toJSON()` returning `null` on the following test's render, indicating a delayed continuation from the first test's earlier `Start` press was still dispatching state updates into React's reconciler at the moment the next test's fresh tree was mounting. Fixed by replacing ad-hoc `Promise.resolve()` microtask waits with a real macrotask yield (`setTimeout(resolve, 0)` wrapped in `act()`) at every settle point in the new test, plus an explicit `unmount()` at its end as a second line of defense -- this is a test-harness-only fix, no production code changed as a result of it, and the full file now passes consistently across repeated runs.

## Validation results (Rev3)

All run from `mobile-expo/`:

- `npm test -- --runInBand` run three consecutive times: **21 suites, 223 tests, 0 failed, all three runs identical.** (Baseline before Rev3 was 21 suites / 221 tests; Rev3 added 2 tests to `PracticeHub.test.tsx`.)
- `npm run typecheck` -- clean, 0 errors.
- `npm run lint` -- clean, 0 errors, 0 warnings.
- `npx expo-doctor` -- 21/21 checks passed.
- `npx expo export --platform ios` -- exported successfully.
- `test/run_security_regression_tests.sh` (repo root) -- **364 passed, 0 failed** -- byte-identical to the pre-Rev3 baseline, confirming no backend behavior changed.

## Diff scope confirmation

`git diff --stat 12220fa18e9159f41f8ba1e828a08ff22141d7fa` shows changes in exactly 2 files: `mobile-expo/app/(app)/practice/index.tsx` and `mobile-expo/test/PracticeHub.test.tsx`, plus this report. Nothing under `portal/`, `shared/`, `test/run_security_regression_tests.sh`, or `test/sql/` changed.

## Explicit confirmations (Rev3)

- **No backend file was modified, no migration applied, no Edge Function deployed, no production Supabase state touched.** The backend regression suite's unchanged 364/0 result is direct evidence.
- **No deployment occurred** -- Supabase, TestFlight, and the App Store are all untouched.
- **No merge to `main` occurred.** All work remains on `claude/sprint-1b-practice-expansion`.
- **Physical-device testing remains pending** -- everything above is Jest/simulator/source-level validation only.
- **Every Rev1/Rev2 fix and guarantee is preserved**: initial active-pointer lookup gate, session-matched compare-and-clear, cleanup-before-completion rendering, `invalid_question_set` machine-code preservation and permanent-recovery classification, generic 5xx remains transient, weak-area runtime validation (including `evidence_score` 0..1 bounds), storage-shape hardening, user-scoped storage, Daily Drill independence, the v119 contract, restart-with-saved-ratings-and-fresh-Reveal, double-Start and double-Complete debouncing, and completion/readiness behavior -- none of these were touched in this revision, and the full regression suite continuing to pass at 223/223 is direct evidence.

**SPRINT 1B.1 REV3 FOCUS-RACE FIX READY — AWAITING SOURCE REVIEW**
