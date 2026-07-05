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
