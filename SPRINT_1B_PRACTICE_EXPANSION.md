# Sprint 1B -- Practice Expansion

Status: **Stage 1 (v119 backend contract preparation) in progress. No native UI work has begun. No deployment has occurred.**

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
