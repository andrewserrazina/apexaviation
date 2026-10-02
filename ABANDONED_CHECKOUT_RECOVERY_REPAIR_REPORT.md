# Abandoned Checkout Recovery — Repair Report

Status: **implemented and tested, not deployed, not committed.** Nothing in this
report has been applied to production. No emails have been sent.

---

## Root Cause

**The scheduler is not the problem.** `pg_cron` job `id=1` fires `net.http_post`
against `send-lifecycle-emails` every single day at `13:00 UTC` with the correct
URL and the correct `Authorization: Bearer <lifecycle_cron_secret>` header.
`cron.job_run_details` shows **15 consecutive `succeeded` runs** from Sep 17
through Oct 1, with zero failures. The SQL eligibility window inside
`processAbandonedCheckouts()` (`created_at` between 1 hour and 7 days old,
`completed_at IS NULL`, `recovery_email_sent_at IS NULL`) is also correct — I
hand-verified it against the real `created_at` timestamps of all three affected
rows and confirmed each one fell inside that window on every run since the day
after it was created.

**The actual defect:** the function's per-row loop had exactly one conditional
skip —

```ts
if (profile?.email_marketing_opt_out) continue
```

— and that skip left **zero trace anywhere**: not in the function's own
`results` counters, not in any table, not in a log anyone would see. A row
behind this skip is rediscovered by the SELECT on every future cron run and
silently passed over again, forever, with nothing to distinguish "about to be
sent next run" from "permanently stuck." That is the exact shape of the
Sep 27/28/30 defect: the SELECT found those three rows on 4+ consecutive
daily runs each, and nothing ever happened to them.

By process of elimination within the function's own logic — I traced every
branch of the old `processAbandonedCheckouts` — `email_marketing_opt_out`
being `true` on these three profiles is the only code path that produces
"selected every day, sent never, no error logged, forever." I was **not able
to directly confirm** `profiles.email_marketing_opt_out` for these three
specific accounts: this session's Supabase tool gates any direct query
against the `profiles` table behind an approval step that did not complete
after several attempts (confirmed to be a `profiles`-specific gate, not a
general outage — `checkout_session_attempts`, `cron.job`, and
`cron.job_run_details` queries all worked normally throughout). **Recommend
you spot-check `email_marketing_opt_out` for the three profile IDs below in
the Supabase dashboard** to close this out with certainty; either way, the
structural defect (silent skip, zero observability, no entitlement
suppression) is confirmed by reading the code and is fixed below regardless
of which exact condition triggered it for these three rows.

```
Sep 27: profile_id 800583e7-15db-4846-af9a-aa366b74b3b1  (justinlbbh2020@gmail.com)
Sep 28: profile_id ef882b39-6b2c-4140-b08a-6cd69e817690  (nesto2002@gmail.com)
Sep 30: profile_id 786f462c-4444-4b3d-bfff-790e11d7b145  (sb7314@gmail.com)
```

A second, independent, confirmed-by-reading-the-code defect was found in the
same investigation: the "mark before send" claim —

```ts
const { error: markError } = await supabase
  .from('checkout_session_attempts')
  .update({ recovery_email_sent_at: new Date().toISOString() })
  .eq('id', attempt.id)
  .is('recovery_email_sent_at', null)
if (markError) { ...continue }
await sendEmail(...)
```

— never checked **how many rows the UPDATE actually affected**. Supabase
returns `error: null` whether the UPDATE matched one row or zero, so two
overlapping executions racing on the same attempt would both see no error and
both send — the "atomic claim" wasn't actually atomic without a row-count
check. Low real-world likelihood today (the cron is single, once-daily), but
explicitly required by the brief and fixed below regardless.

---

## Existing Recovery Architecture

- `checkout_session_attempts` — one row per Stripe Checkout Session created
  (`create-checkout-session`), logged regardless of purpose.
  `stripe-webhook` stamps `completed_at` when Stripe confirms the charge.
- `processAbandonedCheckouts()` (send-lifecycle-emails) — first-touch
  recovery, 1 hour–7 days old, Checkride Prep / Ground School / Mock Oral.
- `processAbandonedCheckoutsFollowup()` — second touch, Checkride-Prep-only,
  48 hours after the first email, with live pricing/urgency.
- Cron: `pg_cron` job `id=1`, `0 13 * * *` (once daily, 13:00 UTC), calling
  the function via `pg_net.http_post`.
- No entitlement/purchase re-verification existed anywhere in this path
  before this repair.
- No suppression-reason tracking existed; a skip was indistinguishable from
  "not yet processed."
- The recovery CTA already links back to `portal-login.html?dest=checkride-prep`
  (an authenticated surface where a fresh Checkout Session gets created at
  click time), **not** an expired Stripe URL — this part was already correct
  and is unchanged. It carried **no UTM parameters at all**, unlike every
  other lifecycle email's CTA in this file.

## Production Evidence Explained

| Date | What happened | Why no recovery email |
|---|---|---|
| Sep 20 | Recovered correctly — `recovery_email_sent_at` set same day | Not opted out / not entitled — the happy path |
| Sep 27 | Checkout created 15:18 UTC, well past first eligibility window by next day's 13:00 run | Selected on 4+ consecutive runs, never sent — matches the silent-skip signature exactly |
| Sep 28 | Signup → activation email → checkout started 4 min later, never completed | Same signature |
| Sep 30 | Same pattern | Same signature |

## Changes Made

| File | Change |
|---|---|
| `portal/supabase-portal-schema-v152-abandoned-checkout-recovery-repair.sql` | **New.** Adds `recovery_suppressed_at` / `recovery_suppressed_reason` to `checkout_session_attempts`, plus a partial index. Not applied to production. |
| `portal/supabase/functions/send-lifecycle-emails/index.ts` | Rewrote `processAbandonedCheckouts()` and `processAbandonedCheckoutsFollowup()`: pure eligibility/suppression decision function, entitlement re-check before every send, atomic claim with row-count verification, suppression recorded (not silently skipped), UTM-tagged CTA links, new analytics events, new observability counters. |
| `portal/supabase/functions/stripe-webhook/index.ts` | Fires `checkout_recovered` when a completing Checkout Session's `checkout_session_attempts` row carries `utm_campaign=abandoned_checkout`. |
| `site/portal-stable.js` | New click-tracking IIFE for `checkout_recovery_1_clicked` / `checkout_recovery_2_clicked`, mirroring the existing `activation_email_N_clicked` pattern exactly. |
| `site/analytics-events.js` | Documents the 3 new server-side-only events; adds the 2 new client-side event names to `EVENT_ALLOWLIST`. |
| `portal/test/abandonedCheckoutRecovery.test.js` | **New.** 31 tests. |
| `portal/test/emailLifecycle.test.js` | Updated 3 pre-existing tests that asserted on the old implementation shape. |

Not changed: Stripe/payment architecture, authentication, account creation,
the $29 price, the cron schedule/frequency, `ABANDONED_CHECKOUT_MIN_HOURS`
(1) or `ABANDONED_CHECKOUT_FOLLOWUP_HOURS` (48).

## Eligibility Rules

`decideAbandonedCheckoutAction(attempt, profile)` — pure function, no I/O:

1. No email on the attempt → **suppress** (`missing_email`)
2. Purpose not in `{unlock-checkride-prep, signup-and-unlock-checkride-prep,
   ground-school-registration, book-mock-oral}` → **skip** (nothing written —
   not this job's concern)
3. `profile.email_marketing_opt_out` → **suppress** (`marketing_opt_out`)
4. Checkride Prep purpose **and** `profile.checkride_prep_unlocked` →
   **suppress** (`already_entitled`)
5. Otherwise → **send**

A **suppress** decision is written once to
`recovery_suppressed_at`/`recovery_suppressed_reason`, atomically (claim
pattern below), which removes the row from all future eligibility SELECTs —
turning the old silent-forever-skip into a one-time, auditable terminal
state.

## Purchase Suppression

`hasCheckridePrepEntitlement(supabase, profileId)` reads the **authoritative**
`profiles.checkride_prep_unlocked` flag — set by `stripe-webhook`'s
`handleUnlockCheckridePrep()` for *every* completed Checkride Prep purchase,
regardless of which `checkout_session_attempts` row (if any) initiated it.
This directly covers "purchased through a different Checkout Session" —
there is no second, independent "purchase history" signal to check beyond
this one flag, since the webhook sets it and inserts the
`portal_access_purchases` row in the same transaction.

Checked **twice** per Checkride Prep attempt: once in the up-front decision
(cheap, from the profile already fetched for the name), and again
**immediately before claiming the row for sending** — closing the window
where a purchase completes between the initial read and the send. This is a
best-effort re-check (not a two-phase commit against Stripe), appropriate for
the size of the actual race window (milliseconds, within one sequential
function run).

## Concurrency / Idempotency

Every terminal-state write (`recovery_email_sent_at`,
`recovery_email_2_sent_at`, `recovery_suppressed_at`) now follows the same
pattern:

```ts
const { data: claimed } = await supabase
  .from('checkout_session_attempts')
  .update({ <column>: new Date().toISOString() })
  .eq('id', attempt.id)
  .is('<column>', null)
  .select('id')
if (!claimed || !claimed.length) continue // lost the race, not an error
```

Postgres evaluates the `WHERE ... AND <column> IS NULL` and applies the
`UPDATE` as one atomic statement — whichever caller's statement commits first
is the only one whose `WHERE` clause still matches for the loser, so
`.select('id')` returning an empty array is a reliable, race-safe signal that
someone else already claimed this row. This is proven in
`abandonedCheckoutRecovery.test.js`'s simulated-concurrency tests and
verified against the real source via static assertion (the old
error-only check is gone everywhere).

A genuine send failure (the email provider itself erroring) is caught
**separately**, after the claim has already committed — the row is not
retried automatically (same "mark before send" tradeoff this file already
uses everywhere else: a rare skipped send beats a duplicate), but it is now
loudly counted in `results.abandoned_checkout_send_failures` and
`results.errors`, never silently treated as success.

## Recovery Timing

**Not changed.** `ABANDONED_CHECKOUT_MIN_HOURS = 1` and
`ABANDONED_CHECKOUT_FOLLOWUP_HOURS = 48` were already named constants, not
magic numbers, and already roughly match the requested "1–3h then +24h"
intent. One honest finding, documented in code and here rather than silently
acted on: because the cron runs **once daily at 13:00 UTC** rather than
hourly, the real-world delay before an eligible row is first picked up is
"whatever's left until the next 13:00 UTC" — anywhere from just over 1 hour
up to ~24 hours after abandonment, not a tight 1–3 hour window. This was
never the cause of the reported defect (the three rows were never sent at
all, not merely late), and changing cron frequency is an infrastructure
decision outside this repair's scope — flagged for your separate decision,
not changed.

## Analytics

**Existing, discovered via audit** (not duplicated):
`mock_oral_page_view`-style page views are unrelated; for this funnel:
`checkout_abandoned` (already existed, server-side), `checkout_started`,
`purchase_completed`. No existing `checkout_recovery_*`/`checkout_recovered`
events existed before this repair.

**Added:**

| Event | Fired from | Server/client |
|---|---|---|
| `checkout_recovery_1_sent` | `processAbandonedCheckouts`, on a successful send | Server |
| `checkout_recovery_2_sent` | `processAbandonedCheckoutsFollowup`, on a successful send | Server |
| `checkout_recovery_1_clicked` | portal-stable.js, `utm_campaign=abandoned_checkout&utm_content=recovery_1` detected on load | Client (`apexTrack`) |
| `checkout_recovery_2_clicked` | Same, `recovery_2` | Client (`apexTrack`) |
| `checkout_recovered` | stripe-webhook, **only** when the completing session's own attempt row carries `utm_campaign=abandoned_checkout` | Server |

`checkout_recovered` fires on `completed_at` being stamped (a real,
Stripe-confirmed charge) — never on a click — satisfying "represents an
actual purchase attributable to recovery, NOT an email click." Properties
are `{ purpose, recovery_sequence | recovery_content }` only — no email,
name, or other PII.

## UTM Attribution Through the Funnel

Both recovery emails now link via `abandonedCheckoutCtaUrl(recoveryStage)`:

```
https://apexaviationtx.com/portal-login.html?dest=checkride-prep
  &utm_source=email&utm_medium=email&utm_campaign=abandoned_checkout&utm_content=recovery_1
```

This reuses infrastructure already proven in this exact codebase this
session: `analytics-events.js`'s `utmProps()` captures fresh `utm_*` params
into `localStorage` on any page load; `portal-login.html` forwards them to
`portal.html` on both the already-signed-in and sign-in-then-redirect paths;
the dashboard's "Unlock Now" button already calls
`create-checkout-session` with `utm: window.apexGetUtm()`; and
`logCheckoutAttempt()` persists that UTM onto the **new** checkout session's
own `checkout_session_attempts` row. `stripe-webhook` then reads that same
row's `utm_campaign` to decide whether to fire `checkout_recovered`. No new
attribution plumbing was built — this was the one email CTA in the file that
had never been wired into plumbing everything else already uses.

## Email Changes

Both templates were audited, not rewritten. No new false claims added
("payment failed," "card declined," etc. do not and did not appear). Only
change: the CTA `href` now carries UTM parameters (see above). Copy,
branding, and structure are otherwise byte-for-byte unchanged.

## Tests Added

`portal/test/abandonedCheckoutRecovery.test.js` — 31 tests:

- `decideAbandonedCheckoutAction()` exhaustively (eligible→send, no-profile
  guest→send, opted-out→suppress, already-entitled Checkride Prep→suppress,
  already-entitled on Ground School/Mock Oral→**not** suppressed, opt-out
  takes priority over entitlement, unsupported purpose→skip, missing
  email→suppress) — covers brief tests #1–5, #11, #12.
- `abandonedCheckoutCtaUrl()` UTM correctness, and that both templates
  actually call it (not a bare link) — tests #13, #14.
- Atomic-claim source assertions on all three claim sites (`.select('id')` +
  row-count check present; old error-only check gone) — tests #6–9.
- Entitlement re-verified immediately before every send, in both functions.
- Eligibility SELECTs exclude already-suppressed rows.
- Observability: all 5 new counters pre-declared; candidates counted before
  any decision.
- `checkout_recovered` fires only on the real UTM-gated condition, attached
  to the real `completed_at` stamp, with no PII.
- Recovery-email click tracking mirrors the established pattern.
- Per-attempt error isolation (one bad row doesn't stop the queue) — test #17.
- Simulated concurrent claim — two racing claims on one row, only the first
  succeeds, proving the exact guarantee real concurrent Postgres statements
  provide — test #10.

Two genuinely hard-to-unit-test items were covered by static source
assertion rather than live execution (consistent with this test file's
established approach for this exact Deno Edge Function, which can't be
imported directly under Vitest): the real atomic UPDATE behavior (Postgres's
own guarantee, not re-implementable in-process) and the full async
`processAbandonedCheckouts` end-to-end flow (would require a complete
Supabase client mock beyond this repair's scope — the pure decision function
extraction is what makes the actual *logic* fully unit-testable instead).

## Full Test Results

```
Test Files  17 passed (17)
     Tests  252 passed (252)
```

(221 pre-existing + 31 new, zero regressions. Also ran `node --check` on
every modified `.ts`/`.js` file — all pass.)

## Migration Requirements

`portal/supabase-portal-schema-v152-abandoned-checkout-recovery-repair.sql`
must be applied **before** the repaired edge function is deployed (the
function writes to `recovery_suppressed_at`/`recovery_suppressed_reason`,
which don't exist yet). **Not applied** — your call, per "do not modify
production data."

## Deployment Steps (when you're ready — not done)

1. Apply `supabase-portal-schema-v152-abandoned-checkout-recovery-repair.sql`.
2. Deploy `send-lifecycle-emails` (whole-file replace, per this repo's
   established single-file edge function deploy).
3. Deploy `stripe-webhook`.
4. Deploy the static site (`site/portal-stable.js`, `site/analytics-events.js`).
5. No `create-checkout-session` changes needed — the UTM plumbing it
   requires already existed.

## Post-Deployment Verification

- Next day's 13:00 UTC cron run: check the function's JSON response for
  `abandoned_checkout_candidates > 0` with a sane split across
  `abandoned_checkout` (sent) / `abandoned_checkout_suppressed_opt_out` /
  `abandoned_checkout_suppressed_entitled` / `abandoned_checkout_send_failures`
  — if `candidates` is ever > 0 with all four other counters staying at 0
  for several days running, that's the exact signature of today's defect
  recurring under a new, not-yet-handled condition, and should be
  investigated immediately rather than assumed fine.
- Spot-check `email_marketing_opt_out` for the three Sep 27/28/30 profile
  IDs in the dashboard, to close the loop on the unconfirmed part of the
  root cause.
- Confirm `recovery_suppressed_reason` values appearing in
  `checkout_session_attempts` match the expected reason strings.
- Confirm `checkout_recovery_1_sent`/`_2_sent`/`checkout_recovered` are
  landing in `analytics_events` with the expected properties.

## Historical Checkout Dry Run

**No emails were sent as part of this investigation or this report.**

I could not execute a live dry run against production myself: this session's
Supabase tool requires an approval step for any direct `profiles` query that
did not complete after several attempts (confirmed specific to `profiles` —
every other table queried normally throughout this investigation). Run this
exact query yourself (read-only, safe) to get the authoritative answer for
all three:

```sql
select
  csa.id as checkout_id,
  csa.created_at,
  csa.purpose,
  csa.amount_cents,
  p.email_marketing_opt_out,
  p.checkride_prep_unlocked,
  case
    when p.email_marketing_opt_out then 'marketing_opt_out'
    when p.checkride_prep_unlocked then 'already_entitled'
    else null
  end as would_be_suppression_reason
from checkout_session_attempts csa
left join profiles p on p.id = csa.profile_id
where csa.id in (
  'fe18fd48-b97c-4637-adbb-c66467b754e2', -- Sep 27
  'bbec9305-2f73-426a-9219-ebf42151c80b', -- Sep 28
  '0c60068a-9b95-4c22-8d74-436e09949f14'  -- Sep 30
)
order by csa.created_at;
```

**Everything I *can* confirm without that one blocked check:** all three
rows are still `completed_at IS NULL`, still inside the 7-day eligibility
window (today is Oct 1 — Sep 27 is day 4 of 7), and would reach the
`decideAbandonedCheckoutAction()` decision point under the repaired logic.
If `would_be_suppression_reason` comes back `NULL` for a given row (i.e.
not opted out, not entitled), that row **would qualify for Recovery #1**
under the new logic the next time the cron runs after deployment. If it
comes back `marketing_opt_out` or `already_entitled`, that row would be
suppressed with an auditable reason instead — in either case, per your own
instruction, **no email goes out from this report or this patch** — that's
a separate decision for you to make after reviewing this.

## Remaining Risks

1. **Unconfirmed exact trigger for Sep 27/28/30.** Strongly implicated by
   process of elimination (see Root Cause), not independently verified due
   to the tool-approval gate above. Low risk to the fix itself either way —
   the structural defect is confirmed by code inspection regardless of
   which exact condition caused it for these three rows.
2. **Cron cadence (once daily, not hourly)** means the real first-touch
   delay is 1–24h, not a tight 1–3h window. Documented, not changed — a
   product decision if tighter timing matters.
3. **Entitlement re-check is best-effort, not transactional.** A purchase
   completing in the exact milliseconds between the final check and the
   claim UPDATE (not between runs — within one single execution) could
   theoretically still slip through. Extremely narrow window; a full
   fix would require locking the profile row across both operations, which
   felt like overbuilding for a window this size.
4. **Ground School and Mock Oral recoveries have no entitlement-suppression
   check**, only Checkride Prep does — because `checkride_prep_unlocked` is
   the only product with a simple authoritative flag already on `profiles`.
   A Ground School pack purchase or a confirmed Mock Oral booking completed
   through a different session would not suppress that product's recovery
   email today. Flagged as a known gap, not silently left unmentioned.
5. **This report and diff have not been reviewed by you yet.** Per your
   explicit instruction, nothing is deployed and no historical checkout has
   been emailed.
