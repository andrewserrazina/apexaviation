# Ground School RLS Audit — `ground_sessions` / `ground_registrations`

Resolves Critical Issue #2 from `LAUNCH_READINESS_REPORT.md`. These two
tables have no `CREATE TABLE` anywhere in this repo (created directly in
the Supabase dashboard), so this audit was done against their **actual
live state**, queried directly from the Supabase SQL Editor via
`inspect-ground-school-rls.sql`, not guessed at from application code.

---

## Before state (verified live, not assumed)

### Columns (as reported live)

`ground_sessions`: `id` uuid PK, `title` text NOT NULL, `description` text,
`location` text, `scheduled_at` timestamptz NOT NULL, `duration_minutes`
integer NOT NULL default 90, `max_students` integer NOT NULL default 20,
`created_at` timestamptz default now(), `meet_link` text, `category` text
default 'general'.

`ground_registrations`: `id` uuid PK default gen_random_uuid(),
`session_id` uuid nullable, `full_name` text NOT NULL, `email` text NOT
NULL, `registered_at` timestamptz default now(), `check_in_token` uuid
default gen_random_uuid(), `check_out_token` uuid default
gen_random_uuid(), `checked_in_at` timestamptz, `checked_out_at`
timestamptz, `attendance_status` text default 'registered',
`is_waitlisted` boolean default false, `waitlist_position` integer,
`profile_id` uuid, `stripe_session_id` text, `amount_cents` integer,
`payment_status` text NOT NULL default 'unpaid'.

Both tables: `rls_enabled = true`, `rls_forced = false`.

### Policies found (live, before this migration)

`ground_sessions` — both correct, left unchanged:
- `"Anyone can view ground sessions"` — SELECT — `using (true)`
- `"Admins can manage ground sessions"` — ALL — admin-role check

`ground_registrations` — **all four replaced, all four provided
effectively no real protection**:

| Policy | Command | Qual / Check | Actual effect |
|---|---|---|---|
| `"Anyone can register"` | INSERT | `with_check = true` | Any caller could insert **any** column values, including `payment_status='paid'`, `stripe_session_id`, `amount_cents` — a direct Stripe bypass. |
| `"Public can read own registration by token"` | SELECT | `qual = true` | The "by token" was never enforced — RLS filters rows but has no way to compare a policy condition against a value the client merely *typed into its WHERE clause*. This let anyone run `select * from ground_registrations` and read every registrant's name, email, and payment data in one query. |
| `"Public can update attendance by token"` | UPDATE | `using/check = true` | Same flaw — anyone could update any row's any column, not just attendance fields. |
| `"Admins can view all registrations"` | SELECT only | admin-role check | No admin INSERT/UPDATE/DELETE policy existed at all; admin writes in `GroundSchedule.jsx` only worked because the three public policies above incidentally also covered admins. |

---

## After state (this migration: `portal/supabase-portal-schema-v6.sql`)

`ground_sessions`: unchanged, re-declared idempotently.

`ground_registrations`, new policy set:

1. **`"Admins can manage all registrations"`** (ALL) — `exists (select 1
   from profiles where id = auth.uid() and role = 'admin')` on both
   `using` and `with check`. Gives admins the full read/write access they
   were previously getting only incidentally.
2. **`"Students can view their own registrations"`** (SELECT) — `auth.uid()
   = profile_id`. Also unblocks the "My Sessions" view noted as a gap in
   `LAUNCH_READINESS_REPORT.md` Issue #8.
3. **No direct public INSERT/SELECT/UPDATE policy.** Public
   self-registration and token-based check-in/out are handled entirely by
   three new `SECURITY DEFINER` RPCs instead (see below) — this is a
   deliberate design change from the original plan of a `with_check`-only
   INSERT policy, made after empirical testing (see "What testing caught"
   below) proved that approach doesn't actually work end-to-end.

New RPCs, all `SECURITY DEFINER`, granted to `anon, authenticated`:

- **`register_for_ground_school(p_session_id, p_full_name, p_email)`** —
  replaces the direct INSERT policy. Computes waitlist placement
  server-side (same rule the client used: confirmed registrants ≥
  `max_students` → waitlist), inserts the row, and returns it directly.
  Rejects duplicate `(session_id, email)` with a friendly error instead of
  a raw constraint-violation message.
- **`get_ground_registration_by_token(p_token)`** — read-only lookup by
  check-in or check-out token. Returns only what the check-in page
  displays (name, timestamps, session title/time/location) — never email
  or payment fields.
- **`record_ground_attendance_by_token(p_token, p_type)`** — looks up the
  registration by token server-side (never trusts a client-supplied row
  id), and performs the actual check-in/check-out write. Reports
  `already_recorded` / `needs_checkin_first` so the client stays a thin
  renderer of server-decided state, matching `Attend.jsx`'s existing state
  machine.

Client changes to match:
- `portal/src/pages/GroundSchedule.jsx` — `handleRegister()` now calls
  `.rpc('register_for_ground_school', …).single()` instead of a direct
  insert followed by a separate `.select()`. `handleManualAdd()` (the
  admin path) is unchanged — it's already covered by the admin ALL policy.
- `portal/src/pages/Attend.jsx` — now calls
  `.rpc('record_ground_attendance_by_token', { p_token: token, p_type:
  type })` once on mount instead of a direct `select` + conditional
  `update` against the table.

---

## What testing caught (this is why direct testing mattered, not just review)

Everything above was verified against a real local Postgres 16 instance —
a harness replicating the exact live schema, a stub `auth.uid()`, and
`anon`/`authenticated`/`service_role` Postgres roles (`service_role` has
`BYPASSRLS`, matching Supabase) — not just read by eye. This caught two
real bugs that code review alone missed:

1. **`INSERT ... RETURNING` needs a matching SELECT policy.** The
   original design was a `with_check`-only INSERT policy allowing public
   registration. A bare `insert` as `anon` succeeded, but
   `GroundSchedule.jsx`'s real flow follows the insert with a separate
   `.select()` to fetch the new row for the confirmation email — and
   Postgres RLS evaluates `RETURNING`/follow-up `SELECT`s against SELECT
   policies too. Anon has no SELECT policy (correctly), so that follow-up
   would have silently returned no data and the confirmation/waitlist
   email would never have sent, with no visible error (the code's `if
   (newReg)` guard swallows it). Fixed by replacing the INSERT policy
   entirely with the `register_for_ground_school` RPC, which returns the
   row directly and needs no client-side SELECT at all.
2. **Ambiguous column references inside `record_ground_attendance_by_token`.**
   `RETURNS TABLE (id uuid, checked_in_at timestamptz, checked_out_at
   timestamptz, …)` implicitly creates PL/pgSQL variables sharing those
   names. The function's own `UPDATE … WHERE id = v_id` and `SET
   checked_in_at = … ELSE checked_in_at END` bare references collided with
   those implicit variables (`ERROR: column reference "id"/"checked_in_at"
   is ambiguous`), which would have made every real check-in/check-out
   attempt fail. Fixed by table-qualifying every such reference
   (`ground_registrations.id`, `ground_registrations.checked_in_at`, etc.).

---

## Tests run (against a real Postgres 16 instance, fixtures: 1 admin, 2
students, 1 session, 1 paid registration linked to student 1, 1 unlinked
walk-in registration)

| # | Test | Result |
|---|---|---|
| 1 | anon can browse `ground_sessions` (public browsing preserved) | ✅ PASS — 1 row visible |
| 2 | anon `SELECT` on `ground_registrations` returns zero rows | ✅ PASS — 0 rows |
| 3 | anon direct `INSERT` (no policy left at all) is rejected | ✅ PASS — blocked |
| 4 | anon cannot insert a forged already-`paid` registration | ✅ PASS — blocked |
| 5 | anon cannot insert a forged already-attended registration | ✅ PASS — blocked |
| 6 | anon cannot `UPDATE` an existing registration directly | ✅ PASS — 0 rows updated |
| 7 | authenticated student sees only their own registration | ✅ PASS — 1 row, own record only |
| 8 | a different authenticated student sees nothing | ✅ PASS — 0 rows |
| 9 | admin sees and can manage all registrations (read + update) | ✅ PASS — 2 rows visible, update succeeded |
| 10 | `service_role` (Stripe webhook) can insert/update freely | ✅ PASS — update and insert both succeeded, bypassing RLS as expected |
| 11 | token-based check-in via RPC as anon, including repeat-call `already_recorded` | ✅ PASS — first call checks in and returns the row; second call reports `already_recorded = true` |
| 12 | anon lookup with a wrong/random token returns zero rows | ✅ PASS — 0 rows |
| 13 | anon self-registers via `register_for_ground_school` RPC and gets the row back directly | ✅ PASS |
| 14 | that same anon caller still cannot `SELECT` the row directly afterward | ✅ PASS — 0 rows, RPC is the only read path |
| 15 | duplicate registration (same session + email) via the RPC is rejected with a friendly error, not a raw constraint error | ✅ PASS |

All 15 scenarios pass cleanly, covering every access pattern the task
required: public session browsing, public registration, token-based
check-in/out, student-own-record isolation, admin full access, and
service-role/webhook bypass.

---

## Remaining risks / deferred items

- **`ground_sessions.meet_link` is visible to anyone via the public
  `"Anyone can view ground sessions"` SELECT policy**, including people
  who never registered or paid. This was flagged but deliberately left
  unchanged because the task explicitly requires preserving public session
  browsing, and splitting "browsable session info" from "meet_link, only
  for registrants" would require either a view or a second table — a
  larger change than this pass's scope. Worth a follow-up if unregistered
  meeting-link access becomes an actual problem.
- **`get_ground_registration_by_token` and `record_ground_attendance_by_token`
  don't rate-limit token lookups.** Tokens are random UUIDs (effectively
  unguessable), so this is low risk, but there's no application-level
  throttling if someone tried to brute-force them.
- This migration was verified against a hand-built local Postgres 16
  replica of the live schema, not the actual Supabase project — the
  schema, RLS policies, and constraints were transcribed exactly from the
  live query results, but applying `supabase-portal-schema-v6.sql` to the
  real project and re-running a smoke test (real signup, real check-in
  link click) is still recommended before/at launch.
