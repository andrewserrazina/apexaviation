# Sprint 1 — Mobile Vertical Slice

Status: In progress
Branch: `claude/sprint-1-mobile-vertical-slice`

## Goal

Build the first end-to-end native Apex Advantage mobile experience:

1. Sign in with an existing Apex account.
2. Restore the session securely on app relaunch.
3. Load server-authoritative mobile bootstrap data.
4. Show Today’s Drill as the primary home action.
5. Start a drill/practice session.
6. Reveal the model answer only through the reviewed `mobile-practice` reveal contract.
7. Self-rate and complete the session.
8. Refresh XP/readiness/bootstrap data after completion.
9. Confirm the same progress is visible on the existing web experience.

## Product guardrails

- This is a native Expo/React Native app, not another web wrapper.
- Do not replace or modify the existing `mobile/` Capacitor wrapper during Sprint 1.
- Create the Expo application in a new top-level directory, preferably `mobile-expo/` unless repository constraints justify another name.
- Reuse the production Supabase project and the six reviewed `mobile-*` Edge Functions.
- The phone must not reproduce entitlement, readiness, XP, ACS-selection, or practice-completion business logic locally.
- Use `shared/mobile-dto/index.ts` as the wire-contract reference; if the deployed Edge Function response differs, the deployed function is authoritative and the DTO must be corrected deliberately.
- Readiness is a training indicator, never a pass probability.
- Do not add native purchase flows or external purchase CTAs in Sprint 1.
- No database migrations or production Edge Function changes are authorized for the initial vertical slice unless a genuine integration defect is found and separately reviewed.

## Sprint 1A — Vertical Slice

### Foundation

- Expo + React Native + TypeScript.
- iOS and Android from one codebase.
- Environment-safe Supabase URL/publishable-key configuration.
- Secure session persistence appropriate for React Native/Expo.
- Stale-refresh-token recovery equivalent in behavior to the reviewed web fixes.
- Small reusable design-token layer using the existing Apex brand.

### Navigation

Initial navigation should support the long-term information architecture without implementing every destination yet:

- Home
- Practice
- ACS
- Oral
- Library

Unimplemented destinations may render an intentional “coming in a later Sprint 1 milestone” placeholder, but the first vertical slice must fully implement Home → Today’s Drill → Practice completion.

### Home

Consume `mobile-bootstrap` and render:

- learner name/training context
- XP/rank/streak summary
- readiness summary with evidence level and reason/limitation handling
- Today’s Drill card
- weak-area summary

Do not infer certificate type, aircraft class, ACS version, entitlements, readiness, or weak areas on-device.

### Drill / Practice

Use the reviewed production contracts:

- `mobile-daily-drill`
- `mobile-practice` start
- `mobile-practice` reveal
- `mobile-practice` complete

Required UX loop:

Question → learner answers mentally/out loud → Reveal → learner self-rates → Next → Complete → refreshed home/readiness/XP.

The client must not expose `model_answer` before the reveal call.

### Definition of Sprint 1A done

A real existing Apex account can:

1. Sign in on an iOS/Android development build.
2. See its real server-side training context and entitlements.
3. Open Today’s Drill.
4. Complete a real practice session.
5. See XP/readiness/home data refresh.
6. Relaunch the app and restore the valid session.
7. See the resulting shared progress reflected in the existing web experience.

## Testing expectations

Before Sprint 1A is considered complete:

- TypeScript passes.
- Lint passes.
- Unit/component tests cover auth-state restoration, stale-token handling, bootstrap rendering, reveal-before-rate flow, completion retry handling, and API error states.
- Expo project starts successfully.
- iOS simulator/device path validated when available.
- Android emulator/device path validated when available.
- No secrets committed.
- No raw service-role credentials in the app.
- No customer data used for destructive testing.

## Stop conditions

Stop and report instead of improvising if:

- a deployed mobile API contract differs materially from `shared/mobile-dto/index.ts`;
- the app would require service-role credentials;
- an entitlement/readiness/XP rule would need to be duplicated on-device;
- a database migration or Edge Function production change appears necessary;
- the existing `mobile/` Capacitor wrapper would need destructive modification;
- a purchase-flow requirement appears before native billing policy is deliberately designed.

## Not in Sprint 1A

- App Store / Play Store submission
- native purchases
- voice AI oral
- full ACS explorer
- full study-pack renderer
- push-notification campaigns
- offline-first content sync
- broad visual-polish pass

Those follow after the vertical slice is stable.
