# Database Changes — Phase 1 (Premium Content Security)

Migration file: `portal/supabase-portal-schema-v5.sql`. Run after
`supabase-portal-schema-v2.sql`, `-v2.sql`, and
`portal/supabase-portal-schema-v4.sql` are already applied.

## New tables

All four are `enable row level security` with **one policy each**: admins
can `select`. No insert/update/delete policy for anyone but the
service-role key (used by `get-premium-content`, which bypasses RLS
entirely). This is intentional — nothing should ever write to these tables
from a client, and nothing should ever read them directly except through
the gated Edge Function or a future admin CMS.

| Table | Columns | Notes |
|---|---|---|
| `dpe_categories` | `id` (PK, text), `label`, `section_label`, `intro`, `sort_order` | 9 rows seeded |
| `dpe_questions` | `id` (PK, text), `category` (FK → `dpe_categories.id`), `question`, `model_answer`, `common_mistakes`, `dpe_evaluating`, `acs_reference`, `real_world_application`, `is_scenario` (bool), `scenario_order` (nullable int), `sort_order`, `created_at` | 72 rows seeded. `is_scenario`/`scenario_order` replace the old client-side `SCENARIO_IDS` array — the 10 scenario-training questions are just a flagged subset of the same 72, exactly as they were in `site/portal.js` (`SCENARIOS` was literally `.map()`ed from `DPE_DATA` there; nothing conceptually changed, just where the flag lives) |
| `quick_reference_sheets` | `id` (PK, text), `title`, `subtitle`, `rows` (jsonb — array of `[letter, term, description]` triples), `sort_order` | 7 rows seeded (ARROW, A TOMATO FLAMES, AV1ATES, IMSAFE, PAVE, CARE, NWKRAFT) |
| `portal_lessons` | `id` (PK, text), `title`, `meta`, `parts` (jsonb — rich content blocks: heading/body/list/table/tip), `sort_order` | 2 rows seeded (Framework, Checkride Day Prep). The 9 "per-category lessons" referenced in the UI aren't separate content — they're navigation links into the DPE library filtered by category, so no additional rows needed |

**Seed data provenance:** extracted programmatically from
`site/portal.js` (not retyped by hand) via a Node script that evaluated
the exact literal blocks and serialized them to SQL, to eliminate
transcription risk across 72 questions of technical aviation content.
Verified: row counts match exactly (72/9/7/2), all JSONB blobs parse as
valid JSON, and every question's fields were spot-checked against the
source file.

## RLS hardening — 3 new trigger functions

Closes a privilege-escalation gap found during the audit: the existing
`"Users manage their own X" for all using (auth.uid() = owner)` policies on
these three tables don't restrict *which columns* the owner can change.

| Table | Trigger | Locks |
|---|---|---|
| `portal_referrals` | `trg_lock_referral_status` → `lock_referral_status()` | `status` |
| `portal_testimonials` | `trg_lock_testimonial_status` → `lock_testimonial_status()` | `status` |
| `portal_question_discussions` | `trg_lock_question_discussion_moderation` → `lock_question_discussion_moderation()` | `status`, `answer`, `answered_at` |

Each trigger is `before update`, `security definer`: if the acting user is
not an admin (checked via the same `profiles.role = 'admin'` pattern used
everywhere else in this schema), the protected column(s) are silently
reset to their `OLD` value regardless of what the `UPDATE` statement tried
to set. Everything else about these tables — insert, select policies,
updates to non-protected columns (e.g. editing testimonial `content` while
still pending) — is unchanged. `portal_checkride_results`' equivalent
`passed` self-report was **not** touched; that one is intentionally
self-reported per its existing design (feeds the honor-system "I Passed"
flow), not a moderation queue.

## Not changed in this migration (flagged for manual verification)

`ground_sessions` and `ground_registrations` have **no `CREATE TABLE` in
any committed SQL file** in this repo — `portal/supabase-portal-schema-v4.sql`
already documents this ("created by the CRM's GroundSchedule.jsx flow").
Their current RLS state cannot be determined from this codebase. Given:

- Both tables are queried from **two public, unauthenticated routes**
  (`/ground-schedule` — public registration form; `/attend/:type/:token` —
  token-based check-in), confirmed via `portal/src/App.jsx`.
- `ground_registrations` now holds PII (`full_name`, `email`) and, since
  the freemium-rework pass, payment data (`stripe_session_id`,
  `amount_cents`, `payment_status`).

**Before launch, check in the Supabase dashboard:** Table Editor →
`ground_registrations` / `ground_sessions` → confirm whether RLS is
enabled, and if so, what policies exist. Two possible states, two
different next steps:

- **RLS is currently disabled** (likely, given nothing in the repo enables
  it) — this means the anon key can currently read/write these tables
  without restriction. This is the more urgent of the two possible states
  to close, since PII and payment status are exposed. Enabling RLS
  without policies "fails closed" — everything stops working, including
  the public registration form and check-in links — so policies need to
  be added in the same transaction as enabling RLS, not after.
- **RLS is already enabled with some policies** — pull the exact policy
  definitions (`select * from pg_policies where tablename in
  ('ground_sessions','ground_registrations')`) before changing anything,
  so the check-in/registration flow that works today doesn't break.

I did not write blind `enable row level security` + policy statements for
these two tables in this pass, because getting it wrong in either direction
(too permissive: doesn't fix anything; too restrictive: breaks the
public check-in links, which have no other auth mechanism) isn't
correctable without being able to test against the real data — and this
sandbox has no live Supabase access. This is the single highest-priority
manual step before launch; see `LAUNCH_READINESS_REPORT.md`.
