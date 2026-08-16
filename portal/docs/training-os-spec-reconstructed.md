# Apex Advantage Training Operating System — Spec (Reconstructed)

> **Status: RECONSTRUCTED, NOT THE ORIGINAL DOCUMENT.**
>
> The real "Apex Advantage Training Operating System" spec was never
> committed to this repository — no file with that content exists anywhere
> in git history, including deleted files. `portal/docs/training-plan-architecture.md`
> (written during the "Design Training Plan architecture" pass) cites it
> repeatedly by section number ("spec section 5," "spec section 8," etc.) as
> if it were an existing outside document, which strongly suggests a prior
> session drafted the spec itself during that pass and never saved it as a
> file — so it only ever existed in that session's own working context and
> was lost once the session ended.
>
> This document reconstructs everything that can be reliably inferred from
> those citations and from what was actually built against them. Every claim
> below is either a close paraphrase/quote from `training-plan-architecture.md`
> (cited inline) or explicitly marked as an inference. **Section numbers with
> no surviving citation are listed as unknown at the bottom — do not treat
> their absence here as "nothing was planned," only as "nothing survived."**
> If the original document turns up (Drive, Notion, an old chat export), it
> should replace this file entirely rather than being merged into it.

## Known section contents

### Section 5 — Per-Module Companion Pages

> "Per-module companion pages (spec section 5) — 20 individual member-facing
> pages/panels with before/live/after-class checklists." *(architecture doc §9)*

20 pages/panels, one per Ground School module, each structured around a
before/live/after-class checklist. Guided Notes (section 8) is described as
living *inside* this companion page, not as a standalone feature — "Build the
per-module companion page UI (spec section 5) that Guided Notes lives inside."
*(architecture doc §6)*

Status as of the last pass: the data layer this needs — module↔content
mapping (`GS_MODULE_CONTENT_MAP`), the entitlement check (`hasModuleAccess`),
and next-class lookup (`upcomingRegisteredClass`) — is built. The UI itself
is not.

### Section 8 — Guided Notes

Required structure per module, quoted directly: "objectives / key concepts /
fill-in areas / scenario prompts / Checkride Corner / review questions."
*(architecture doc §6)*

This maps almost exactly onto the "Student Workbook Template" structure
already documented in `PrivateCurriculum.md` (Deliverable 4), which is likely
either the same source material or a close sibling of it:

1. Module Cover Page
2. Learning Objectives (checkbox self-mastery per objective)
3. Guided Notes Section (structured fill-in-the-blank, never fully blank or fully pre-filled)
4. Key Concepts and Definitions (glossary + "in my own words" line)
5. Scenario Workshop Worksheet
6. Checkride Corner Notes (questions printed with space for live answers + a Confident/Needs Review self-rating column)
7. Knowledge Check Questions (5–8 short-answer/scenario, deliberately not multiple choice)

**As of this pass:** the in-app Guided Notes feature (`GUIDED_NOTES_MODULES`
in `site/portal-stable.js`) has one free-text synthesis prompt per Knowledge
Session section for all 20 modules — a real subset of the spec'd structure
(closest to items 3–4 above), but missing the checkbox objectives, the
fill-in-the-blank format, the Checkride Corner section, and the Knowledge
Check questions. It remains admin-only (gated by the `guided_notes` RLS
policy in `supabase-portal-schema-v14.sql`) until that fuller structure
exists — "shipping the flip without content would be worse than not shipping
it." *(architecture doc §6)*

### Section 10 — Post-Class Review Screen

> "...not a dedicated post-class review screen (spec section 10) with its
> own recommended-next-steps CTA." *(architecture doc §9)*

A screen shown after a class, with its own CTA recommending what to do next.
Not built; only the pre-class banner (section 11) exists.

### Section 11 — Pre-Class Flow / Dashboard Banner

> "...this pass adds the elevated 'class starts soon' banner + join-class
> task inside the Training Plan card (spec section 11)..." *(architecture doc §9)*

This piece **is built**: an elevated banner in the Training Plan dashboard
card when a registered class starts within 24 hours, with a "Join the class"
task that outranks every other Training Plan priority.

### Section 15 — Instructor Dashboard

> "Instructor dashboard (spec section 15) — not started; explicitly optional
> in the spec." *(architecture doc §9)*

No other detail survives. Explicitly marked optional by the spec itself, so
its absence isn't a gap in the same sense as the others.

### Section 18 — Achievements

> "...spec section 18 confirms adding these requires only a JS change
> (`ACHIEVEMENT_DEFS` in `site/portal-stable.js` is a hardcoded catalog
> evaluated client-side, no migration needed)..." *(architecture doc §9)*

Calls for new Ground School milestone and Training Plan streak achievements.
Not added yet, deliberately — "to avoid badge inflation without a clear
signal for what's meaningful."

### Section 19 — Notification Event Catalog

> "Notification event catalog (spec section 19) — no infrastructure for this
> exists yet (confirmed: no push/cron system found in this codebase)."
> *(architecture doc §9)*

No further detail survives. Not designed in detail during the last pass
beyond noting that a persisted `training_plan_snapshots` table (see the
computed-vs-persisted tradeoff below) would be the natural hook if this gets
built later.

### Section 20 — Analytics Events

> "...none of the new `training_plan_*` / `module_companion_*` /
> `guided_notes_*` events were added yet. House convention requires adding
> each to `EVENT_ALLOWLIST` in `site/analytics-events.js`..." *(architecture doc §9)*

Calls for analytics events on the new Training Plan, module companion page,
and Guided Notes surfaces. Deferred until those UI surfaces (companion
pages, live Guided Notes) actually exist to fire them.

## Cross-cutting content (not tied to one numbered section)

**Training Plan priority order.** The architecture doc states this
implements "the spec's exact priority order" and then gives it in full — so
this is effectively verbatim spec content, fully preserved:

1. Upcoming registered Ground School class within 24 hours (elevates a
   pre-class banner + "Join the class" task, outranks everything else)
2. Not-unlocked state → unlock-prompt task list
3. Checkride within 14 days + a weak category → both surface together in
   the "why" explanation
4. Weakest ACS category → review task
5. An unstudied scenario *within that weak category specifically* (not just
   any scenario, per spec) → task
6. Today's oral-exam question, if unstudied
7. AI DPE Practice, if the member's last session is ≥7 days old or doesn't exist
8. Otherwise, a lighter DPE Rapid Fire suggestion
9. "All ACS areas complete" / caught-up state, when no weak category remains

**Dashboard mockup constraint:** the Training Plan task list is capped at 4
items, described as matching "the spec's mockup" — implying the spec
included an actual visual mockup of this card. The mockup itself doesn't
survive, only this one constraint from it.

**Architecture principle (quoted):** "If a new table is not necessary and
the plan can be generated dynamically from existing progress state, prefer
the simpler architecture." — used to justify computing the Training Plan
live on every render rather than persisting it to a `daily_tasks` table.

**Training Report constraints:** the spec explicitly instructs not to
"expose sensitive account data" on the report, and "allowed either" a
downloadable/printable report or a shareable link — implementation chose
downloadable/printable for the smaller security surface.

## Sections with no surviving information

The spec is confirmed to run at least through section 20, given for a
"Training Operating System" that also required the companion-page and
Guided Notes work above. No citation survives at all for sections **1, 2, 3,
4, 6, 7, 9, 12, 13, 14, 16, 17** — meaning nothing is known about what those
covered, not that they were empty or unplanned. Given the numbered
neighbors, plausible (unconfirmed) guesses for some of these:

- Something in 1–4 likely covers the Training Plan/dashboard card itself
  (mockup, priority order) referenced elsewhere without its own section cite.
- Something in 12–14 likely covers whatever comes between the post-class
  review screen (10) and the instructor dashboard (15).
- 16–17 are unaccounted for between achievements (18) and instructor
  dashboard (15).

These are guesses only and are not asserted as fact anywhere above.

## What would actually resolve this

Find the real document — check Google Drive, Notion, or any chat/export
from around when `training-plan-architecture.md` was first written
(commit `a7482d8`). If found, it should fully replace this file rather than
be reconciled with it, since this reconstruction is necessarily incomplete
and partially speculative.
