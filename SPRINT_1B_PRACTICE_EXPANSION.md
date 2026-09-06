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

1. **Stage 1 (this branch, this document)** -- audit the current `mobile-practice` contract against the two known-suspect behaviors named in the kickoff (a silent fallback to unrelated general questions when a targeted ACS-task start has zero mapped content, and the absence of an authenticated resume action), then, if confirmed, prepare a narrowly-scoped v119 backend contract hardening: fail-closed targeted start, a new authenticated `resume` action, and question-set integrity validation on resume. **Source-controlled only** -- no deployment, no native UI work. See `SPRINT_1B_V119_PRACTICE_CONTRACT_REPORT.md` for the full audit findings and implementation detail once Stage 1 completes.
2. **Stage 2+ (future, not started)** -- once v119 is reviewed and deployed, build the native ad-hoc Practice UI in `mobile-expo/` on top of it: an ACS-task picker, a session-size choice, the resume-on-relaunch flow using the new `resume` action, and the Practice tab's "more practice modes coming" placeholder finally becoming real.

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
- The "Remove Saved Session" recovery action is offered for `not_found`/`forbidden` resume errors only; v119's `invalid_question_set` failure mode (a genuinely corrupt stored question set) currently surfaces as a generic `server`-kind error indistinguishable from a transient infra failure through the existing error-normalization pipeline, so it is conservatively treated as retry-only rather than immediately offering local-clear recovery. This is a documented, deliberate choice (see `classifyResumeError`'s comment in `useAdHocPracticeSession.ts`), not an oversight.
- No mobile analytics events were added for any new Practice Hub or ad-hoc session interaction, since no existing analytics helper exists in `mobile-expo/` to extend -- flagged per the kickoff's instruction rather than building a new subsystem to fill the gap.
- Cross-device unfinished-session discovery, session abandonment, and a historical practice browser remain unimplemented, as explicitly scoped out of this stage.

## Explicit confirmations

- **No backend change occurred.** No migration was written or applied, no Edge Function was modified or deployed, no RPC was added or altered, and no production Supabase state was touched at any point in this stage. The backend regression suite's unchanged 364/0 result is direct evidence of this.
- **No merge to `main` occurred.** All work remains on `claude/sprint-1b-practice-expansion`.
- **No TestFlight/App Store build was submitted, and no physical-device testing has occurred.** Everything above is Jest/simulator/source-level validation only.

**SPRINT 1B.1 NATIVE PRACTICE EXPANSION READY — AWAITING SOURCE REVIEW**
