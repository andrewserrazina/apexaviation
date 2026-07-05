# Content Operations (Phase 4)

Resolves `IMPLEMENTATION_PLAN.md` Phase 4 and `LAUNCH_READINESS_REPORT.md`
Issue #7 (referrals have no admin workflow).

---

## What was missing

Phase 1 moved the DPE question library out of a public static JS file and
into real tables (`dpe_categories`/`dpe_questions`), locked to
admin-`SELECT`-only — that was the prerequisite for a CMS to even be
possible (you can't build an admin editor over hardcoded JS), but the v5
migration's own comment already flagged that the actual write access
("a future admin CMS") was deferred. Ask Andrew and testimonial moderation
already existed and worked (`renderAdminAskInbox`/
`renderAdminTestimonialInbox`); referrals had no admin action UI at
all — `portal_referrals.status` could only ever move from `pending` via a
direct database edit.

## What shipped

### `portal/supabase-portal-schema-v9.sql`

- **DPE content CMS write access**: `dpe_categories`/`dpe_questions` get a
  combined `for all` admin policy (via the `is_admin()` helper added in
  v8), replacing the view-only policy from v5.
- **Referral admin workflow, and a real gap found while building it**: the
  existing `"Users manage their own referrals"` policy
  (`auth.uid() = referrer_id`) plus the v5 `lock_referral_status` trigger
  correctly stop a referrer from self-approving their own referral — but
  there was never a policy letting an **admin** update a referral that
  isn't their own row either. Concretely: **nobody, admin included, could
  ever move a referral from `pending` to `signed_up`/`rewarded` through
  the normal RLS-protected client** — only a direct service-role/dashboard
  edit could. Fixed with a new `"Admins can manage all referrals"` policy.
  Verified against a real local Postgres instance: a referrer still can't
  self-approve (unchanged), and an admin can now move a referral through
  both status transitions.

### `site/portal.js` — DPE Question Library (Content Management)

New card in the existing vanilla admin dashboard (`site/portal.html`'s
`#section-admin`, the same surface Ask Andrew/testimonial/referral
moderation already live in — no new page, no React CRM involvement,
matching how those already work):

- A category bar (9 buttons, one per `dpe_categories` row) plus an inline
  form for that category's own `label`/`section_label`/`intro`.
- A question list scoped to the active category: each row shows the
  question text, an "Edit" button (expands the same field set the
  question actually has — model answer, common mistakes, DPE-evaluating
  note, ACS reference, real-world application, the scenario-training
  flag, and sort order) and a "Delete" button (with a confirm prompt).
- "+ Add Question" opens the same form blank, generates a collision-safe
  id (`<category>-custom-<timestamp>`, distinct from the seeded
  `<category>-<n>` scheme), and inserts.

Creating brand-new categories is deliberately out of scope — the 9
categories map to fixed ACS knowledge areas from the checkride oral exam
standard, not something that needs ad-hoc expansion — only their text
fields are editable.

Content edits take effect for members the next time they load the portal
(`get-premium-content` serves the current table state on each call; there's
no live-push to an already-open session, same as every other
admin-edits-data-a-member-reads pattern already in this app).

### `site/portal.js` — Referral status actions

`renderAdminReferralList` now shows a "Mark Signed Up" / "Mark Rewarded"
button matching each referral's current status (nothing renders once a
referral reaches `rewarded` — that's the end state).

### A second bug found via testing, unrelated to the CMS itself

Building the CMS's live-write actions surfaced a **pre-existing race
condition** in the admin dashboard, not introduced by this pass:
`loadAdminDashboard()` (an ~11-query `Promise.all`) was being triggered
**twice** on every admin session — once eagerly the moment
`renderAdminIfApplicable()` ran during login, and again independently the
moment the admin actually clicked into the "Admin Analytics" section
(`showSection('admin')` already called it too). For a purely read-only
dashboard this was just wasteful (every admin login fired the same query
batch twice for no reason); now that the dashboard supports live writes
(this phase's CMS edits and referral actions), a stale second load
resolving after a write was already in flight could silently clobber it
or duplicate rows in the rendered list — reproduced while testing the
"add question" flow. Fixed by removing the eager call — the dashboard now
loads once, lazily, on-visit, the same pattern `loadGroundSchool()`
already used.

---

## Tests run

### Against a real local Postgres 16 instance (`supabase-portal-schema-v9.sql`)

| # | Test | Result |
|---|---|---|
| 1 | Admin can `INSERT` a new DPE question | ✅ PASS |
| 2 | Admin can `UPDATE` an existing DPE question | ✅ PASS |
| 3 | Admin can `DELETE` a DPE question | ✅ PASS |
| 4 | A student (non-admin) cannot write to `dpe_questions` at all | ✅ PASS — blocked |
| 5 | A referrer still cannot self-approve their own referral (existing lock trigger, unchanged) | ✅ PASS |
| 6 | Admin can move a referral `pending → signed_up → rewarded` | ✅ PASS |

### Against a mocked Supabase client via Playwright (`site/portal.js`)

- Referral list renders the correct next-action button per status, and
  advancing a referral updates its status label and swaps/removes the
  button correctly (`pending → signed_up → rewarded`, button disappears
  at `rewarded`).
- CMS category bar renders all seeded categories; selecting one populates
  the category-info form with its real `label`/`section_label`/`intro`.
- Question list scoped to the active category renders correctly; editing
  a question, adding a new one, and deleting one all reflect immediately
  and correctly in the rendered list with no duplication and no console
  errors, after fixing the double-dashboard-load race described above
  (an earlier test run surfaced an apparent duplicate row that traced
  back to that race, not a bug in the CMS logic itself — confirmed by
  fixing the race and re-running).
- Switching categories correctly scopes the question list to the newly
  selected category, including the empty state for a category with no
  questions yet.

---

## Known limitations / deliberate scope decisions

- **No "create new category" UI** — see above; the 9 categories are fixed
  ACS knowledge areas.
- **`quick_reference_sheets` and `portal_lessons` remain admin-view-only**,
  not part of this CMS — `IMPLEMENTATION_PLAN.md` Phase 4 scoped the CMS
  to `dpe_questions`/`dpe_categories` specifically; editing the 7 quick
  reference sheets or the 2 lesson documents would need their own editor
  (they're richer `jsonb` structures — reference-sheet rows, lesson
  parts — not a good fit for the same flat-field form) and is left for a
  future pass if it's actually needed.
- **New questions default `scenario_order` to `null`** — if an admin flags
  a newly-created question as "include in Scenario Training" without also
  setting an explicit order, it sorts inconsistently within the Scenario
  Training Center relative to other scenario questions (a display-order
  quirk, not a data-loss or access-control issue). Not fixed in this pass;
  flagged for whoever builds this next, since it would need its own
  ordering UI to do properly.
