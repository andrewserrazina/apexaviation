# CLAUDE.md

# Apex Aviation / Apex Advantage Engineering Guardrails
Version 1.0
Last Updated: September 2026

This file supplements `AGENTS.md`. If instructions conflict, follow the more specific rule for the task at hand and preserve existing production behavior unless the user explicitly requests a change.

## Core operating rule

Audit first. Change the smallest safe surface. Preserve existing architecture, analytics, billing, attribution, entitlements, accessibility, and mobile behavior unless the task explicitly requires otherwise.

Do not treat a request as permission for a broad redesign or refactor.

## Production-critical systems

Treat these as high-risk and require explicit reasoning before edits:

- Stripe checkout, products, prices, webhooks, refunds, and fulfillment
- Supabase migrations, RPCs, triggers, functions, and RLS
- Authentication and account creation
- Paid-content entitlements and access control
- Analytics identity, attribution, and purchase tracking
- Ground School scheduling, capacity, registration, and recordings
- Checkride Prep ownership and unlock logic

For these systems:

- inspect the existing implementation before editing
- preserve idempotency
- avoid duplicate sources of truth
- do not move security-sensitive logic to the client
- do not silently weaken validation, RLS, or authorization
- do not fabricate or backfill analytics events merely to improve dashboards

## Git workflow

- Never develop directly on `main`.
- Use one feature branch per meaningful task.
- Prefer clear branch names such as `fix/portal-activation-tracking` or `feat/readiness-prep-bridge`.
- Keep commits focused and explain WHY in commit messages.
- Open a pull request before merge.
- Do not merge a PR solely because tests pass; verify product/business behavior too.

## Pull request requirements

Every PR should explain:

1. Objective / business problem
2. Root cause, when fixing a bug
3. Files changed
4. Database / migration impact
5. Analytics impact
6. Stripe / billing / entitlement impact
7. Tests run
8. Manual QA required
9. Deployment order, if any
10. Known limitations / follow-up risks

For UI changes, include screenshots when practical.

## Supabase

- Use migrations for schema changes.
- Never modify production data to make a feature appear fixed.
- Preserve RLS unless the requested task explicitly requires a policy change.
- Prefer existing canonical tables, columns, RPCs, and functions over creating parallel structures.
- Check `DATABASE_CHANGES.md` and recent migrations before adding new schema.
- When a migration depends on a prior migration, document that dependency.
- If a production migration may fail partway through, design for transactional safety and explain recovery.

## Stripe

- Webhook fulfillment is the source of truth for paid access.
- Success-page query parameters are not sufficient to grant paid access.
- Preserve webhook idempotency and existing deduplication behavior.
- Do not create new Stripe products/prices when the existing checkout architecture intentionally uses inline `price_data`, unless explicitly requested.
- Do not change prices, coupons, refund behavior, or product classification without explicit instruction.
- When touching billing, identify every affected purchase path and test each path separately.

## Analytics

Before adding or renaming an event, inspect:

- `ANALYTICS_EVENT_DICTIONARY.md`
- `ANALYTICS_EVENT_MAP.md`
- `ANALYTICS_MAINTENANCE_NOTES.md`
- event allowlists in code

Rules:

- reuse existing events where semantics already match
- do not create near-duplicate events
- preserve UTM capture and attribution
- preserve shared anonymous identity / profile identity mapping
- do not redefine activation, conversion, or readiness merely to improve KPI values
- document cohort vs same-period semantics for funnel changes
- purchase/revenue reporting must reconcile to real Stripe state, including refunds where supported

## Product scope

Do not add speculative features while solving a focused task.

Avoid:

- second recommendation engines
- duplicate onboarding systems
- duplicate booking flows
- duplicate analytics pipelines
- duplicate entitlement flags
- new admin surfaces when an existing one can be extended cleanly

If a reusable existing system can satisfy the request, extend it instead of creating a parallel implementation.

## Content and aviation accuracy

Follow `AGENTS.md` and source-of-truth documents.

Do not:

- rewrite instructor-authored aviation content unless explicitly asked
- invent FAA guidance, regulations, endorsements, checkride expectations, or product claims
- fabricate question counts, pass rates, testimonials, availability, seat counts, or instructor credentials
- promise checkride success

When content accuracy matters, preserve the supplied source material and flag unsupported gaps rather than filling them from assumption.

## Apex brand / UX

Follow the existing Apex visual system and production UI patterns.

Core colors currently include:

- Navy: `#0B1F3A`
- Gold: `#F4B400`
- White: `#FFFFFF`

Do not introduce a new visual language for a scoped engineering task.

Preserve:

- responsive behavior
- keyboard accessibility
- focus states
- semantic controls
- mobile usability

Avoid generic AI/SaaS styling and excessive animation.

## Testing expectations

Run the strongest tests available for the touched surface, which may include:

- build
- lint
- typecheck
- unit tests
- static JavaScript syntax checks
- migration validation
- Edge Function type checks
- accessibility checks
- responsive/manual browser QA

Do not claim a live production test occurred if live access was unavailable.

Always provide a manual QA checklist when production integrations cannot be exercised locally.

## Completion standard

Before saying a task is complete, confirm:

- requested behavior is actually implemented
- unrelated behavior was not changed
- no new source of truth was introduced unnecessarily
- analytics changes are documented
- billing/entitlement impact is explicit
- migrations are identified and ordered
- tests were run and reported truthfully
- known limitations are disclosed

## Final principle

The goal is not to make the codebase look more sophisticated.

The goal is to make Apex safer, easier to operate, easier to measure, and better for pilots while preserving business-critical production behavior.
