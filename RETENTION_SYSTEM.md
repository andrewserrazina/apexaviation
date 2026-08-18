# Retention System — Server-Side Reconciliation (Phase 3)

Resolves `IMPLEMENTATION_PLAN.md` Phase 3 and `LAUNCH_READINESS_REPORT.md`
Issue #4 (no server-side reconciliation for lifecycle emails) and Issue #5
(`portal_email_log` not actually logging all email types).

---

## What was broken

Readiness-milestone (25/50/75/90%), first-question, Checkride-Mode-complete,
and weak-area emails all exist and fire correctly — but **only from the
browser**, triggered inside `checkLifecycleMilestones()`/
`checkWeakAreaEmail()` on page load. A member who crosses a milestone
without the portal tab open at the right moment simply never gets that
email — there's no server-side job checking for missed triggers.

Two email types referenced in the product plan don't exist in any form:
- **7-day inactivity nudge** — the only reference to this anywhere in the
  codebase was a stale comment in `site/portal.js` claiming it lived in "a
  separate scheduled Edge Function in the apexadvantage repo." That repo
  was merged into this monorepo (see root `README.md`), and no
  `portal-inactivity-nudge` function exists anywhere in
  `portal/supabase/functions/`. **This could mean one of two things: the
  function was never migrated during the merge and is dead, or it's still
  deployed directly in the Supabase project (like `ground_sessions`/
  `ground_registrations` turned out to be, per `GROUND_SCHOOL_RLS_AUDIT.md`)
  and simply isn't tracked in this repo. This sandbox cannot check the
  Supabase Edge Functions list — see "Action required" below.**
- **Checkride countdown (30/14/7/3/1 days out)** — `portal_checkride_date`
  and `renderCheckrideCountdown()` already exist and display the countdown
  in the UI, but nothing ever emailed based on it.

`portal_email_log`'s schema comment describes it as the dedup log for
*all* lifecycle emails; in practice only the weak-area nudge ever wrote to
it — the other four dedupe against `portal_events` instead, so a query
against `portal_email_log` has always shown an incomplete picture.

## What shipped

### `portal/supabase-portal-schema-v8.sql`

- **`profiles.portal_last_active_at`** (new column) — the signal the
  inactivity nudge needs. Nothing existing tracks "when did this member
  last open the portal" on its own: `portal_study_activity` only records
  days with ≥5 seconds of active tab time (a study-engagement signal, not
  a visit signal) and would miss a member who opens the portal but
  doesn't linger. `site/portal.js` now writes this once per session load.
- **A pre-existing bug found and fixed while wiring the above up, not
  introduced by it**: `profiles` had no "members can update their own
  row" policy at all — only `"Admins can update profiles"` existed. This
  means the Account Management "Save Changes" form
  (`full_name`/`certificate_status`) has been **silently doing nothing**
  for every non-admin member since it was built: the update matches zero
  rows under RLS, Postgrest returns no error either way, and the client's
  success toast fires unconditionally regardless of whether anything
  actually saved. Fixed with a new `"Members can update their own
  profile"` policy, locked down by a `before update` trigger
  (`lock_profile_privileged_columns`) so a student can only ever change
  their own `full_name`/`certificate_status`/`medical_expiry`/
  `portal_last_active_at` — `role`, `checkride_prep_unlocked`, `email`,
  and `created_at` silently revert to their old value on any non-admin
  update, the same column-lock pattern already used for
  `portal_referrals`/`portal_testimonials`/`portal_question_discussions`
  in the v5 migration.
- **A second pre-existing bug found via the same testing**: adding that
  new policy and testing it against a real Postgres instance immediately
  surfaced `ERROR: infinite recursion detected in policy for relation
  "profiles"` — and confirmed via a follow-up test that this reproduces on
  the **original, unmodified** schema alone, with no v8 changes involved.
  `"Admins can view all profiles"` and `"Admins can update profiles"` both
  check admin-ness via `exists (select 1 from public.profiles where id =
  auth.uid() and role = 'admin')` — an inline subquery on the *same table*
  the policy protects. Every other table in this schema uses that
  identical pattern safely (querying `profiles` from another table's
  policy doesn't recurse), but a policy *on* `profiles` querying `profiles`
  again means evaluating the subquery's scan requires re-applying
  `profiles`' own `SELECT` policies — including this same one — which
  Postgres correctly refuses as unbounded. In production today, this means
  **any admin session doing a plain `select * from profiles` through the
  regular (non-service-role) client — e.g. the CRM's admin user list —
  would hit a hard error**, not just an incomplete result. Fixed by moving
  the admin check into a `SECURITY DEFINER` function (`is_admin(uuid)`),
  which runs as the function owner and so isn't subject to the calling
  session's RLS, breaking the cycle. Verified fixed against a real
  Postgres instance (see Tests below).

### `portal/supabase/functions/send-lifecycle-emails/index.ts` (new)

A single scheduled Edge Function, run with the service-role key, that
recomputes every lifecycle-email condition server-side once per profile:

| Email type | Applies to | Dedup |
|---|---|---|
| `first_question_completed` | Unlocked members | `portal_events` flag (shared with client) |
| `readiness_25`/`50`/`75`/`90` | Unlocked members | `portal_events` flag (shared with client) |
| `checkride_mode_completed_email` | Unlocked members | `portal_events` flag (shared with client) |
| `weak_area_<category>` | Unlocked members | `portal_email_log`, re-sent after 14 days (matches `sendThrottledEmail`'s existing behavior) |
| `inactivity_7day` | **All** members, locked or unlocked | `portal_email_log`, re-sent after 30 days |
| `checkride_countdown_<30\|14\|7\|3\|1>` | Members with a `portal_checkride_date` set | `portal_email_log`, one-time per day-mark |

The readiness score, per-category ACS coverage, and study-streak
computations are a line-for-line port of `computeReadiness()`/
`categoryPct()`/`computeStreaks()` from `site/portal.js` — same weights
(30% questions / 20% scenarios / 25% ACS coverage / 15% streak-consistency
/ 10% study-time), same thresholds — verified by hand-checking the formula
against fixture data (see Tests below) rather than assumed correct by
inspection.

For the four milestone types that already had a client-side path, this
function writes to **both** `portal_events` (the flag `portal.js` already
checks, so neither side ever double-sends the other's work) and
`portal_email_log` (completing the audit trail). `site/portal.js`'s
`checkLifecycleMilestones()` now does the same on its side (a small
`logEmailSent()` call added alongside each existing send) — so going
forward, `portal_email_log` is a complete record of all six + the two new
types regardless of which side actually sent it, closing Issue #5.

### `site/portal.js`

- Writes `profiles.portal_last_active_at = now()` once per session load.
- `checkLifecycleMilestones()` now also logs to `portal_email_log` for the
  four milestone types (see above).
- The stale "separate Edge Function in the apexadvantage repo" comment is
  corrected to describe the actual current design.

---

## Action required before this is live (cannot be done from this sandbox)

1. **Run `portal/supabase-portal-schema-v8.sql`** in the Supabase SQL
   editor.
2. **Check the Supabase Edge Functions list for an existing
   `portal-inactivity-nudge` (or similarly named) function.** If one is
   still deployed from before the repo merge, disable or delete it before
   deploying `send-lifecycle-emails` — otherwise members could get
   double-nudged by two independent inactivity jobs that don't know about
   each other.
3. **Deploy the new function**: `supabase functions deploy
   send-lifecycle-emails` (run from inside `portal/`).
4. **Set secrets**: `RESEND_API_KEY`/`FROM_EMAIL` are already required by
   `send-email` and reused here (this function calls `send-email`, it
   doesn't call Resend directly). Optionally set
   `LIFECYCLE_CRON_SECRET` to any random string — if set, the function
   rejects any request whose `Authorization` header doesn't match, so the
   function's public URL alone isn't enough to trigger a mass-email run.
5. **Schedule it to run daily.** Two ways to do this in Supabase, pick
   whichever this project's plan supports:
   - **Dashboard scheduled functions** (if available on the project's
     plan): Edge Functions → `send-lifecycle-emails` → add a cron
     schedule, e.g. `0 13 * * *` (13:00 UTC / 8am Central).
   - **`pg_cron` + `pg_net`** (works on any plan): in the SQL editor,
     ```sql
     select cron.schedule(
       'send-lifecycle-emails-daily',
       '0 13 * * *',
       $$
       select net.http_post(
         url := 'https://<project-ref>.supabase.co/functions/v1/send-lifecycle-emails',
         headers := jsonb_build_object('Authorization', 'Bearer <LIFECYCLE_CRON_SECRET value>'),
         body := '{}'::jsonb
       );
       $$
     );
     ```
6. **Manually trigger one run** after deploying (`curl -X POST
   .../functions/v1/send-lifecycle-emails -H "Authorization: Bearer
   <secret>"`) against real data and check the JSON response's per-type
   counts and `errors` array before trusting the schedule.

---

## Tests run (against a real local Postgres 16 instance)

| # | Test | Result |
|---|---|---|
| 1 | Admin can `SELECT` all profiles (pre-existing recursion bug) | ✅ PASS after fix — previously reproduced `ERROR: infinite recursion detected in policy for relation "profiles"` on the **unmodified original schema alone** |
| 2 | Student can update their own safe columns (`full_name`, `certificate_status`, `portal_last_active_at`) | ✅ PASS |
| 3 | Student cannot self-escalate `role`, flip `checkride_prep_unlocked`, or change `email` | ✅ PASS — all three silently reverted to their old values |
| 4 | Student cannot update a different student's row | ✅ PASS — 0 rows affected |
| 5 | Admin can update `role`/`checkride_prep_unlocked` on any row | ✅ PASS |
| 6 | Anon has zero access to `profiles` | ✅ PASS |

Readiness-score formula and checkride-countdown day-math were verified
separately by extracting the exact same arithmetic into standalone
scripts and hand-checking the result against fixture data with a known
expected score/day count (not run against Postgres, since these are pure
JS/TS computations with no SQL involved) — both matched exactly.

**Not verified** (requires a live Supabase project + deployed function,
neither reachable from this sandbox): an actual scheduled run against
real member data, actual Resend delivery, and whether a legacy
`portal-inactivity-nudge` function is still live (see Action Required #2
above — this is the single highest-priority manual check before
deploying, to avoid double-sends).

---

---

## Phase 4 — Recovery Sortie notification + deployment blocker fix (this session)

This phase started from a direct product ask: get more members actively
using the portal and protect their study streaks. Two findings shaped the
work:

1. **`send-lifecycle-emails` was never deployable.** `portal/supabase/
   config.toml` had entries for every other scheduled/webhook-driven
   function (`stripe-webhook`, `andrewos-metrics`, …) but was missing
   `[functions.send-lifecycle-emails]`. Without it, `supabase functions
   deploy send-lifecycle-emails` would deploy with the platform default
   (`verify_jwt = true`), and every scheduled `pg_net` call — which
   carries no Supabase session, only the `LIFECYCLE_CRON_SECRET` header
   this function checks in its own code — would 401 before any of the
   function's code ran. **Fixed**: added the missing block with
   `verify_jwt = false`, matching the `andrewos-metrics` pattern.
2. **The Recovery Sortie system (schema v48) had zero notification
   path.** `run_streak_maintenance()` offers a same-day "answer 3
   questions before midnight to save your streak" Sortie the moment a
   member's streak breaks and they have no banked freeze left — but
   nothing ever told the member it existed. It was pure DB state,
   invisible unless they happened to open the portal that exact day.
   This is the single most direct, time-boxed lever for "preserve their
   study streaks" the codebase had — and it was silently doing nothing.

### `portal/supabase/functions/send-lifecycle-emails/index.ts`

- **`emailTemplateRecoverySortie(firstName)`** — new template, same
  visual style as the existing templates.
- **`processRecoverySortieNotifications(supabase, results)`** — new
  batch processor, run once per cron tick immediately after the
  `run_streak_maintenance` RPC call (so a Sortie offered in that same
  run is emailed immediately, not on the next day's tick). Queries
  `recovery_sorties` for rows that are unused and unexpired, dedupes via
  `portal_email_log` keyed on the sortie's own id (`recovery_sortie_
  <sortie.id>` — same one-time-per-instance pattern as
  `ground_followup_<registration_id>`), and sends the email.
- New `results.recovery_sortie_notified` counter in the JSON response.

### `portal/supabase/config.toml`

- Added `[functions.send-lifecycle-emails]` with `verify_jwt = false`.

Verified by bundling the function with esbuild (no live Deno/Supabase
runtime available in this sandbox) — confirms the TypeScript is
syntactically valid and the new function/template wire in correctly, not
that it behaves correctly against a live database.

### Still required before this goes live (cannot be done from this sandbox)

All of the original "Action required" steps above still apply and have
**not** been completed — this phase did not deploy or schedule anything,
only fixed the code and the config that were blocking deployment. In
particular:

- Deploy the function: `supabase functions deploy send-lifecycle-emails`
  (from inside `portal/`) — this also picks up the `config.toml` fix.
- Schedule it — `portal/supabase/functions/send-lifecycle-emails/
  schedule.sql` has the exact, ready-to-run `pg_cron`/`pg_net` script
  (via Supabase Vault, not a hardcoded secret) once the placeholders are
  filled in.
- Manually trigger one run after deploying and check the JSON response's
  `recovery_sortie_notified` count and `errors` array before trusting
  the schedule — there is currently no test data anywhere confirming a
  real `recovery_sorties` row + `profiles` join returns what this code
  expects.

---

## Known limitations / deliberate approximations

- **Streak "today" reference**: `computeReadiness()`'s current-streak
  calculation uses the member's browser-local date client-side, but this
  job runs on a UTC schedule. Since every threshold this affects is a
  one-time dedup flag (never re-triggered), the only possible effect is a
  milestone email firing up to a day earlier/later than the client would
  have computed it — never a duplicate or a missed send.
- **Inactivity signal**: `portal_last_active_at` is updated once per
  portal session load, not on every interaction — a deliberate choice to
  keep it to one cheap write per visit rather than a click-tracking
  beacon. A member who never opens a NEW session (i.e. never revisits)
  will correctly nudge at 7 days; a member who keeps one browser tab open
  continuously without reloading won't refresh the timestamp, which is an
  accepted edge case, not a bug — same tradeoff the existing
  `portal_study_activity` signal already makes.
- **`WEAK_AREA_CONTENT` is duplicated** between `site/portal.js` and
  `send-lifecycle-emails/index.ts` (no shared module between the two
  runtimes today). If the copy ever changes, both need updating — flagged
  in a comment at the top of each.

## New Member Activation sequence (this session)

Personalized activation emails on signup — Email #1 (immediate, personal
note from Andrew) plus Emails #2/#3/#4 (~24h/~72h/~7d, only while the
member hasn't done anything meaningful yet). Full design reasoning is in
each file's own comments (`create-free-account/index.ts`,
`send-lifecycle-emails/index.ts`'s `processNewMemberActivation`); this
section is just the deployment checklist.

### Action required before this is live

- **`NEW_MEMBER_ACTIVATION_SINCE` must be set** (Supabase Edge Function
  secret on `send-lifecycle-emails`, an ISO timestamp) or Emails #2-4
  never send to anyone — this is the deliberate guard against backfilling
  every historical member into a "new signup" sequence. Set it to the
  actual deploy date/time. Email #1 has no such gate (it only ever fires
  inline at genuine signup, in `create-free-account`), so it starts
  working the moment that function is redeployed.
- Optional: `NEW_MEMBER_ACTIVATION_BACKFILL_DAYS` (integer, default `0`)
  to also catch signups from just before the cutover.
- Deploy `send-email`, `create-free-account`, and `send-lifecycle-emails`
  (`supabase functions deploy <name>` from inside `portal/`) — all three
  changed this session.
- Run `supabase-portal-schema-v72.sql` (admin activation-funnel KPIs) in
  the SQL editor, after v71.
- Same manual cron/schedule requirement as every other lifecycle email in
  this file — nothing new here, just riding the existing daily job.
- **Not verified against a live Supabase project** — same caveat as every
  other phase in this file. Verified: all three edge functions bundle
  cleanly (`esbuild`), the new admin RPC (`get_activation_email_kpis`)
  against a local Postgres 16 instance with hand-checked synthetic data
  (5 profiles covering the 24h/7d/email-assisted/window-boundary cases,
  every returned number matched the independently hand-computed
  expectation), and the full deep-link URL chain (activation email →
  `portal-login.html` → sign-in → `portal.html#hash`, and the
  logged-out-click-through-login path) with a standalone Node script
  replicating each file's exact string-building logic against 9 test
  cases. Not verified: an actual Resend send with `reply_to` set, an
  actual `auth.admin.generateLink` recovery-link round trip, or the
  cron picking this up in production.

## Activation sequence — pre-deployment hardening pass (this session)

Three things fixed before this goes live, none of them a redesign:

**1. Account creation could be delayed/failed by an email-provider
problem.** Before this pass, `create-free-account` awaited the
`send-email` invocation directly, inline, with no timeout and no
try/catch isolating it from the outer request handler. Two real risks:
a slow/hung Resend call held up the whole signup response (the account
was already created, but the client just... waited), and an actual
thrown exception from `supabase.functions.invoke()` (a network-level
failure, not a Resend error response) would have propagated to the
top-level `catch` and returned a `500` to the client — even though the
account genuinely existed. After: the send is wrapped in its own
never-throws function, raced against a 5-second timeout so the common
case (Resend responds in under a second) still reports an accurate
`emailSent` value synchronously, and a slow/hung call falls back to an
optimistic response while the real send keeps running via
`EdgeRuntime.waitUntil()` where the runtime supports it (checked at
runtime, not assumed). Account creation itself was never gated on the
email either way, before or after — this fix is entirely about
signup *latency* and the exception-escape bug, not account durability,
which was already correct.

**2. Email #1 had no cron catch-up.** If the synchronous attempt at
signup never got confirmed (Resend down, response timed out, container
torn down mid-`waitUntil`), nothing would ever retry it — the member's
account would exist with no way in beyond "Forgot Password," and no
signal anywhere that this had happened for that member specifically
(beyond a `console.error` log line). `processActivationEmail1CatchUp`
(`send-lifecycle-emails/index.ts`) now runs every cron cycle, sends the
same email with a freshly generated magic link to anyone eligible whose
`activation_email_1` milestone was never confirmed, and stays silent
for anyone it already was. One known, documented tradeoff: a lead-magnet
signup's specific `?dest=` (e.g. `checkride-prep.html`'s own link)
wasn't persisted anywhere, so a catch-up send always routes to the
dashboard rather than the original resource — acceptable for a rare
recovery path, not worth a new column. Building this also surfaced a
real bug in the idempotency flag itself: the first draft only marked
`activation_email_1` as confirmed-delivered for the generic
activation-copy branch, not the lead-magnet welcome-email branch — so a
*successful* lead-magnet send would still have looked unconfirmed to
the catch-up path, which would then have wrongly layered a second,
differently-worded welcome email on top of a perfectly fine first one.
Fixed by marking the flag for both branches, while keeping the
`analytics_events` funnel-tracking insert restricted to the generic
copy only (so the activation funnel's own numbers stay uncontaminated
by the structurally different lead-magnet emails).

**3. Activation analytics used only-ever-first activity, but had no
guard against activity that predates signup.** `get_activation_email_
kpis()`'s `first_activity` CTE already computed a genuine `min()` (first,
never most recent) — that part was correct from the start. What it
lacked was a check that a candidate "first activity" row actually
occurred on or after `profiles.created_at`. A data artifact (bad
backfill, re-used id, historical import) producing an activity row
dated before signup would have silently produced a negative Time to
First Value and a false `activated_24h = true`. Fixed by joining
`first_activity` against the cohort and filtering `occurred_at >=
created_at`. Verified against local Postgres with a synthetic profile
carrying exactly this shape (a stale pre-signup row plus a real
post-signup one) — the stale row was correctly ignored and the real one
correctly used, so `activated_24h` came out `false` as it should have
(the real activity was 30 hours out, past the 24h window) rather than
trivially `true` off the negative interval.

Also split the single `email_assisted_activation_rate_pct` into two
separate numbers — `email_clicked_before_activation_rate_pct` (the
member clicked an activation email before their first meaningful
activity) and `email_sent_before_activation_rate_pct` (the email was
merely sent before, no click required) — so a reader can't mistake the
weaker "it was sent first" fact for the stronger "they actually engaged
with it first" one. Both compare event timestamps to `first_activity_at`
directly; neither implies causation on its own.

**Known related gap, not fixed in this pass (out of this pass's file
scope):** `get_retention_kpis()` (`supabase-portal-schema-v69.sql`) has
the identical missing guard in its own `first_activity` CTE — its
`time_to_first_value_median_minutes` and D1/D7/D30 retention figures
could theoretically be skewed by the same kind of stale pre-signup
activity row. Worth the same fix in a future pass; not touched here
since v69.sql wasn't part of this hardening pass's listed files and
changing it wasn't requested.

### Activation analytics — definitions

Documented explicitly per this pass's own request not to leave any of
these ambiguous:

- **`first_meaningful_activity_at`** — not a stored column, computed
  fresh each query: the earliest timestamp among a profile's qualifying
  activity rows (`portal_question_progress` answered/completed,
  `portal_scenario_progress` completed, any `portal_practice_attempts`
  row, any `ai_dpe_sessions` row — the retention sprint's own
  established "meaningful activity" definition, unchanged) that occurred
  on or after `profiles.created_at`.
- **Time to First Value** = `first_meaningful_activity_at -
  profiles.created_at`, median across the cohort. Uses the FIRST
  qualifying activity, never the most recent — `daysSinceLastMeaningfulActivity()`
  (used operationally, to gate whether the activation *email sequence*
  should keep running for a given profile) is a different, deliberately
  simpler question ("has this person ever done anything meaningful,
  as of right now") and is never used for this analytics calculation.
- **24h Activation Rate** = (profiles whose `first_meaningful_activity_at`
  falls within 24 hours of `created_at`) / (profiles in the cohort),
  as a percentage.
- **7d Activation Rate** = same, within 7 days.
- **D1 / D7 / D30 Retention** (`get_retention_kpis()`, v69.sql) is a
  **separate concept from activation**, not a synonym: retention checks
  whether a profile has a qualifying activity day *exactly* on
  signup-date + N (calendar-day granularity, requires still being active
  N days out), while activation checks whether *any* qualifying activity
  happened *within* a continuous window starting at signup (time-based,
  about how fast the first value moment happens, not whether it recurs
  later). A profile can activate on day 0 and never register a D7
  retention day; a profile can miss the 24h/7d activation window and
  still show up for D30 retention later. The two numbers are allowed to
  disagree — that's not a bug, they're measuring different things.
- **Email-sent-before-activation** / **email-clicked-before-activation**
  — both defined above. Neither implies the email *caused* the
  activation; they describe event ordering only. Report them separately,
  never blended into one "email-assisted" number.

## Lifecycle email preferences — required next infrastructure task

No consent/unsubscribe system exists anywhere in this codebase, for any
lifecycle email — not something introduced by the activation sequence,
a pre-existing gap across the whole lifecycle system that this pass
surfaces rather than fixes (implementing one is explicitly out of scope
here; this section exists so it isn't lost).

**Every lifecycle/transactional email type currently sent**, and a
rough transactional-vs-marketing read (not a legal classification — this
product has none on record, and this document isn't creating one):

| Email | Source | Character |
|---|---|---|
| Account welcome / password-set | `create-free-account` | Transactional — required for account access |
| New Member Activation #1-4 | `create-free-account`, `send-lifecycle-emails` | Mixed — #1 doubles as account access; #2-4 are engagement nudges |
| `inactivity_7day` | `send-lifecycle-emails` | Marketing-like — re-engagement |
| `reactivation_inactive` | `send-lifecycle-emails` | Marketing-like — re-engagement |
| `weekly_progress` | `send-lifecycle-emails` | Informational/engagement |
| First-question / readiness-milestone / Checkride-Mode-complete | `send-lifecycle-emails`, client-side | Engagement/congratulatory |
| `weak_area_<category>` | `send-lifecycle-emails` | Marketing-like — content recommendation |
| `checkride_countdown_<N>` | `send-lifecycle-emails` | Transactional-ish — tied to a date the member set |
| `checkride_upsell_day<N>` | `send-lifecycle-emails` | **Marketing — direct sales pitch** |
| `ground_followup_<id>` | `send-lifecycle-emails` | Marketing-like — soft upsell |
| `abandoned_checkout_<id>` | `send-lifecycle-emails` | Marketing — cart recovery |
| Readiness Assessment day1/3/6 | `send-lifecycle-emails` | **Marketing — lead-nurture sales sequence** |
| `recovery_sortie_<id>` | `send-lifecycle-emails` | Transactional-ish — tied to the member's own account state |
| Stripe purchase confirmations | `stripe-webhook` | Transactional |

**Current suppression mechanisms** — all of them are *deduplication*
(never send the exact same milestone/day twice) or *throttling* (don't
re-send this type more than once every N days), via `portal_email_log`
and `portal_events`. None of them are *consent* mechanisms — there is
no way for a member to say "stop sending me X" and have it respected.
The only thing close to an opt-out anywhere in this system is simply
not having an email on file, which isn't a real mechanism.

**Why this needs addressing before lifecycle email volume grows
further:** several of the types above (`checkride_upsell_day<N>`,
Readiness Assessment day1/3/6, `abandoned_checkout`) are genuinely
promotional in substance, sent automatically, with no user-facing way
to reduce or stop them short of the member emailing in and asking a
human to intervene manually. This is a legal/trust exposure that scales
with send volume and email-type count — both of which have grown this
session (the activation sequence adds up to 4 more touchpoints per new
member) and will keep growing with any future lifecycle work. The
recommended next infrastructure task is a real preferences/unsubscribe
system: a durable per-profile suppression flag (or per-category flags,
if the product wants granularity), a one-click unsubscribe link on
every non-strictly-transactional send, and every `sendEmail()` call
site in `send-lifecycle-emails/index.ts` (plus `create-free-account`'s
own) checking it before sending. Not built here — this section is the
handoff.

## Production deployment plan — New Member Activation sequence

Ordered by actual dependency, not "deploy normally":

1. **SQL migration** — run `supabase-portal-schema-v72.sql` in the
   Supabase SQL editor (after v71, if not already applied). Idempotent:
   it's a single `create or replace function` plus one `grant`, safe to
   re-run. Verify immediately after: `select get_activation_email_kpis();`
   as an admin user should return a JSON object with `new_signups`,
   `activation_rate_24h_pct`, etc. — not an error.
2. **Edge Functions** — deploy in this order (each is independent of
   the others at deploy time, but `send-email` should land first since
   the other two invoke it):
   - `supabase functions deploy send-email`
   - `supabase functions deploy create-free-account`
   - `supabase functions deploy send-lifecycle-emails`
3. **Environment variables** — set before (or immediately after) step 2,
   but Emails #2-4 and the Email #1 catch-up are inert until this is
   done:

   | Variable | Required? | Format | Example |
   |---|---|---|---|
   | `NEW_MEMBER_ACTIVATION_SINCE` | **Required** for Emails #2-4 and Email #1 catch-up | ISO 8601 timestamp | `2026-08-18T00:00:00Z` |
   | `NEW_MEMBER_ACTIVATION_BACKFILL_DAYS` | Optional (default `0`) | integer, days | `2` |
   | `RESEND_API_KEY` | Required (pre-existing) | secret, not printed here | — |
   | `FROM_EMAIL` | Optional (pre-existing, defaults to `Apex Advantage <noreply@apexaviationtx.com>`) | `Name <email>` | — |
   | `SITE_ORIGIN` | Optional (pre-existing, defaults to `https://apexaviationtx.com`) | URL, no trailing slash | — |
   | `LIFECYCLE_CRON_SECRET` | Recommended (pre-existing) | secret, not printed here | — |

   `NEW_MEMBER_ACTIVATION_SINCE` unset means the sequence is **entirely
   disabled** for Emails #2-4 and the catch-up path (verified in code —
   `isEligibleForActivationSequence()` returns `false` unconditionally
   when this is unset). Recommended production value: the actual
   deployment timestamp, set at deploy time, so only genuinely new
   signups from that moment forward ever enter the sequence.
4. **Static frontend files** — `portal-login.html`, `portal-reset-
   password.html`, `portal-stable.js`, `analytics-events.js` need to be
   live on the actual site (not just committed) for the deep-link/
   click-tracking fixes to take effect. No build step for these — they
   ship the moment the static files are deployed.
5. **Cron verification** — `send-lifecycle-emails` needs to already be on
   its daily schedule (see "Action required" above from the earlier
   phase in this document — `pg_cron`/`pg_net`, or whatever scheduler is
   actually wired up in the live project; this session has never had
   access to a live Supabase project to confirm the schedule is actually
   installed). Confirm the schedule invokes `send-lifecycle-emails` with
   `Authorization: Bearer <LIFECYCLE_CRON_SECRET>` if that secret is set,
   and check the function's logs after the next scheduled run for the
   `new_member_activation`, `activation_email_1_catchup`, and
   `checkride_upsell` counters in its JSON response — a non-zero
   `errors` array there is the first thing to check if anything looks
   wrong.
6. **Production smoke tests** — see below.

### Cron catch-up test strategy (no waiting days, no touching real users)

Do not backdate a real member's `created_at`. Instead: create one
disposable test profile, then directly `update profiles set created_at
= now() - interval '2 days' where id = '<test-profile-id>'` — same
effect as time actually passing, isolated to a throwaway account. Invoke
`send-lifecycle-emails` manually (with the cron secret header) and
confirm in its JSON response that the relevant counter increments for
that run, then check the test inbox.

### New-signup smoke test

1. Create one real, disposable test account through the actual signup
   form (not the admin panel).
2. Confirm the signup response returns quickly (should be well under
   the 5-second timeout in the common case) and shows success.
3. Confirm Email #1 arrives (check the test inbox).
4. Query `portal_events`/`portal_email_log` for that profile — an
   `activation_email_1` row should exist.
5. Click the email's CTA link and confirm the URL it lands on matches
   what was promised, including the `utm_campaign=new_member_activation`
   /`utm_content=welcome_1` params.
6. Sign out, then click the same link (or a Day-1/3/7 email's link, once
   reachable) again while logged out — confirm it round-trips through
   sign-in and lands back on the intended destination, not a bare
   dashboard.
7. Complete one qualifying meaningful action (e.g. answer the daily
   question) and confirm `daysSinceLastMeaningfulActivity()` (or,
   indirectly, a subsequent cron run) treats the profile as activated —
   no further activation emails should send for it afterward.

### Resend-failure smoke test (staging/local only — never production credentials)

Point `RESEND_API_KEY` at an invalid value in a non-production
environment, or otherwise force `send-email` to fail, then run through
the new-signup smoke test above. Confirm: the account is still created,
the signup response still returns successfully, `emailSent` in the
response is `false` (or the optimistic `true` if it hit the 5s timeout —
both are acceptable outcomes per the design above), and the next cron
run's `activation_email_1_catchup` counter picks it up once the API key
is restored (or a working key is reintroduced), with no duplicate send
once it succeeds.

### KPI smoke test

Using the same local-Postgres approach already used to verify
`get_activation_email_kpis()` during development (see the file's own
verification note above), the four scenarios below were run — not
against production, against a synthetic dataset:

- **Signup → Email #1 → activity 10 minutes later**: `activated_24h =
  true`, `email_sent_before_activation = true`, positive Time to First
  Value of ~10 minutes. Confirmed.
- **Signup → activity immediately → Email #1 afterward**: `activated =
  true`, but `email_clicked_before_activation = false` (no click at all
  in this scenario) and — this is the case worth calling out —
  `email_sent_before_activation` would read `false` too if the send
  timestamp is genuinely after the activity timestamp; the query
  compares real timestamps either way and does not assume Email #1
  always precedes activity just because it usually does.
- **Signup → no activity at all**: `activated = false`, excluded from
  both the 24h and 7d activation counts' numerators, correctly still
  counted in `new_signups`.
- **Signup → activity at 25 hours**: `activated_24h = false`,
  `activated_7d = true`. Confirmed (this is exactly profile C's shape
  in the verification dataset above, at a slightly different offset).
