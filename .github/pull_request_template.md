## Objective

What business, product, or engineering problem does this PR solve?

## Root Cause

If this is a bug fix, what specifically caused the problem?

## Changes

### Files changed
- 

### Database / migrations
- None / describe migration(s), dependencies, and execution order

### Edge Functions / backend
- None / describe

### UI / UX
- None / describe

## Analytics Impact

- Events added:
- Events changed:
- Events removed:
- Attribution / identity impact:
- Funnel / cohort semantics impact:

If none, state: `No analytics changes.`

## Stripe / Billing / Entitlement Impact

- Checkout changes:
- Webhook changes:
- Product / price changes:
- Entitlement changes:
- Idempotency considerations:
- Refund implications:

If none, state: `No Stripe, billing, or entitlement changes.`

## Security / Access Control

- RLS changes:
- Auth changes:
- Admin permission changes:
- Public/private data exposure changes:

If none, state: `No security or access-control changes.`

## Tests Performed

- [ ] Build
- [ ] Lint
- [ ] Typecheck
- [ ] Unit/integration tests
- [ ] Static JS / syntax checks
- [ ] Migration validation
- [ ] Edge Function checks
- [ ] Mobile QA
- [ ] Desktop QA
- [ ] Accessibility / keyboard QA

Commands / results:

```text

```

## Manual QA Required

1. 
2. 
3. 

## Deployment Order

1. 
2. 
3. 

If no special order is required, state that explicitly.

## Known Limitations / Follow-up Risks

- 

## Screenshots

Include before/after screenshots for user-facing changes when practical.

## Final Safety Check

- [ ] I audited the existing implementation before adding a parallel system.
- [ ] I did not modify unrelated product behavior.
- [ ] I preserved Stripe/webhook idempotency where applicable.
- [ ] I preserved RLS/auth protections where applicable.
- [ ] I preserved UTM/analytics identity and attribution behavior where applicable.
- [ ] I did not fabricate analytics data, aviation content, product claims, availability, or business metrics.
- [ ] I documented every migration and production-impacting change.
