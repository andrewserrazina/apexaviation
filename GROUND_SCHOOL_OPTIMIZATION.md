# Ground School Optimization (Phase 6)

Resolves `IMPLEMENTATION_PLAN.md` Phase 6.

---

## What was actually missing

Contrary to the original 7-phase ask's framing, most of "ground school
optimization" already existed and worked: attendance tracking, CSV
export, manual registrant add, waitlist promotion, and bulk email are all
already live in `GroundSchedule.jsx` (the React CRM). The audit found
exactly two real gaps:

1. **No student-facing session history.** `ground_registrations.profile_id`
   is populated by the Stripe webhook (matched by email) or an admin's
   manual add, and `"Students can view their own registrations"`
   (`supabase-portal-schema-v6.sql`, from the ground-school RLS pass) has
   made this readable since that migration ran — but nothing in the
   member portal ever rendered it back to the student. A student who paid
   for a session had no way to see it again inside their own account.
2. **No post-attendance follow-up email.** After a session, nothing ever
   sent a follow-up — genuinely unbuilt, not a bug.

## What shipped

### `site/portal.html` / `site/portal.js` — "My Ground School Sessions"

A new card in Account Management (same page Phase 2's Billing History
card lives on — both are "your own history" content, natural neighbors):
lists every session the signed-in member has registered for, sorted by
session date descending (soonest upcoming or most recent past first),
each row showing the session title, date/location, and a status badge —
`Registered`, `Waitlisted`, `Checked In`, `Attended`, or `No Show`. Built
on `ground_registrations.select('*, session:ground_sessions(*)').eq
('profile_id', member.id)` — no new RLS needed, the v6 migration already
covers this exact access pattern.

### `portal/supabase/functions/send-lifecycle-emails/index.ts` — post-attendance follow-up

Extends the existing Phase 3 scheduled function (rather than building a
new one — this is squarely the same "server-side scheduled email
reconciliation" concern that function already owns) with a new routine
that iterates `ground_registrations` directly (not `profiles` — a walk-in
registrant with no matching portal account still has a real email and
should still get this, same as the Stripe webhook's existing registration
confirmation emails):

- Fires for any registration where `attendance_status = 'completed'`
  (i.e. actually checked out, not just checked in or a no-show), bounded
  to the last 45 days to keep the query from rescanning an ever-growing
  full history on every daily run.
- Dedup key includes the specific registration id
  (`ground_followup_<registration_id>`), not just the profile, so a
  member who attends multiple sessions over time gets one follow-up per
  session attended, not just once ever.

**A deliberate scope decision on the email content**: the original ask's
wording ("replay/resources/portal CTA") implies a session recording link.
Ground school is live, instructor-led, in-person — there is no
recording/replay system anywhere in this codebase, and promising one
would be shipping a broken link. The follow-up email instead links to
(a) the Ground School Scheduling page, to book another session while it's
fresh, and (b) the member's own portal generally. It's deliberately
generic rather than personalized to unlock status (would need an extra
`profiles` lookup per registration for a nudge that reads fine either
way).

---

## Tests run

- `portal/supabase/functions/send-lifecycle-emails/index.ts` —
  syntax-checked with `esbuild` after the addition (this sandbox has no
  Deno runtime or live Supabase project to execute the actual query
  against). The embedded-resource join syntax used
  (`select('id, email, profile_id, checked_out_at,
  session:ground_sessions(title)')`) is the identical
  Supabase/PostgREST pattern already proven working in `Attend.jsx`,
  `GroundSchedule.jsx`, and this same phase's own "My Sessions" query —
  not a new, unverified pattern.
- "My Ground School Sessions" — verified via Playwright against a mocked
  Supabase client with 4 fixture registrations (upcoming/registered,
  upcoming/waitlisted, past/attended, past/no-show): all four rendered
  with the correct title, date, location, and status label, correctly
  sorted by session date descending, and the empty state correctly shows
  the "browse upcoming sessions" prompt when a member has no
  registrations at all. Zero console errors in both cases.

## Known limitations

- The post-attendance follow-up email's actual delivery is unverified
  end-to-end (no live Supabase project or Resend account reachable from
  this sandbox) — same caveat as every other email type
  `RETENTION_SYSTEM.md` already documents for this function. It ships
  alongside the rest of that function's routines, so it inherits the same
  manual deploy/cron requirements already documented there — no separate
  deployment step needed beyond redeploying `send-lifecycle-emails`.
- No recording/replay link, by design — see above.
