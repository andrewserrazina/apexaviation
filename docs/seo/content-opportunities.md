# Content Opportunities — 2026-11-16

Per the brief: "prioritize one genuinely helpful, nonduplicative page/article per intent group, only after confirming the existing site doesn't already cover it." **Nothing in this document is published.** These are proposals only — outlines and constraints for the owner to approve, reject, or hand off to a writer. No new `.html` file was created from this document.

Two of the five brief-listed topics turned out, on checking, to already be covered by existing pages — the overlap check below explains why those two are **not** proposed as new articles, in favor of strengthening what's already there. One topic (complex aircraft checkout) is excluded because the service isn't verifiably offered. That leaves one genuine new-content proposal (below) plus one "verify, don't blindly update" note on an existing post.

## Topic 1 — Instrument checkride / oral-exam preparation in Austin (NEW CONTENT — proposed)

- **Search intent**: a student finishing instrument training wants to know what the instrument *oral exam* specifically covers and how to prepare, in or near Austin.
- **Primary query**: `instrument checkride preparation austin` (38 impressions, position 10.58 — [GSC-HISTORICAL]).
- **Secondary queries**: `instrument rating austin` (42, 11.9), `instrument training near austin` (33, 13.48).
- **Target canonical URL**: `/blog-instrument-checkride-oral-prep-austin` (slug placeholder — final slug TBD at write time, must be checked for uniqueness before creation, same as every other post this session).
- **Audience**: instrument students in the final weeks before their checkride, most likely training elsewhere (not necessarily Apex) and searching generically.
- **Existing-page overlap check**: `checkride-prep.html` (the paid system) explicitly states instrument content is "in development" — it is **not live**, so this would not duplicate a paid product's own marketing claims. `instrument-rating-training.html` covers the training *pathway*, not oral-exam content specifically. `blog-ifr-currency-austin.html` and `blog-instrument-currency-vs-instrument-proficiency.html` cover *currency/proficiency*, a different intent (see Topic 2). **No existing page covers instrument oral-exam preparation specifically — genuine gap.**
- **Source/evidence requirements**: Andrew (CFI/CFII) writes or reviews this directly, same as every other blog post this session — ACS-grounded (Instrument Rating ACS, not invented), and must not claim or imply the paid Checkride Prep system covers instrument content, since it doesn't yet.
- **Outline** (draft, for review — not content, a shape):
  1. What the instrument oral actually tests (ACS areas, not "secret questions")
  2. How it differs from the private pilot oral
  3. 3-4 real example topic areas (not fabricated "DPE favorite questions" — only areas, unless Andrew supplies real example questions)
  4. How to structure your own study in the weeks before
  5. CTA: Apex Advantage Private Instruction (live now, serves every certificate level including instrument) — **not** a Checkride Prep CTA, since that product doesn't cover instrument yet
- **Internal link targets**: from `instrument-rating-training.html`, `blog-ifr-currency-austin.html`, `blog-instrument-currency-vs-instrument-proficiency.html`, and `programs.html`'s instrument section.
- **CTA**: "Book a Private Instruction session" → `apex-advantage-private-instruction` (real, live, accurately scoped).
- **Proposed SEO title**: "What's on the Instrument Checkride Oral Exam? | Apex Aviation"
- **Proposed meta description**: "What the instrument rating oral exam actually tests, how it differs from the private pilot oral, and how to prepare — from an Austin CFII." (138 chars)

## Topic 2 — Instrument proficiency / currency training in Austin (ALREADY COVERED — no new article)

- **Query**: `instrument proficiency training austin` (38 impressions, position 17.55 — [GSC-HISTORICAL]).
- **Existing-page overlap check**: `blog-ifr-currency-austin.html` ("How Austin Pilots Stay IFR Current") and `blog-instrument-currency-vs-instrument-proficiency.html` already cover this intent directly and thoroughly — the 66 HIT rule, currency-vs-proficiency distinction, AATD credit toward currency, practical strategies. Writing a third article on the same intent would be the exact "content volume instead of content cluster" the brief warns against.
- **Recommendation instead**: this query's weak position (17.55, worse than Topic 1 and 3's queries) is more plausibly a ranking-strength problem than a coverage gap. Proposed, not yet done: add 2-3 more inbound internal links to `blog-ifr-currency-austin.html` from `instrument-rating-training.html` and `pricing.html` (its IPC-adjacent content), and consider whether the post's title should more literally match the query phrase ("...Austin" already present; "proficiency training" vs. the post's current framing around "currency" could be reconciled with one added sentence/heading, not a rewrite). No file changed in this pass — flagged for a future, smaller PR.

## Topic 3 — Instrument ground training / instrument rating pathways (ALREADY COVERED — strengthen existing page, don't fork it)

- **Queries**: `instrument ground training austin` (33, 16.94), `instrument rating austin` (42, 11.9) — [GSC-HISTORICAL].
- **Existing-page overlap check**: `instrument-rating-training.html` **is** the page for this intent — it already covers Part 61 requirements, lesson structure, and (per the technical audit) already has the "Private Instruction · Live Now" real-service callout. A new separate article competing with the service page itself for the identical query would risk cannibalization, not incremental reach.
- **Recommendation instead**: the meta-description fix already applied (see `implementation-plan.md` P1) directly targets this query cluster. The next, not-yet-done step: add a short FAQ section to `instrument-rating-training.html` itself, phrased in the visitor's own words ("Can I start instrument training in Austin now?", "What does instrument ground training involve?", "When does in-aircraft Austin training open?") with `FAQPage` schema — the same pattern already used successfully on `programs.html`/`pricing.html` in the prior SEO pass. Not implemented in this pass (it's a real content addition, not a safe metadata-only change, and the brief's own P1 instructions ask for this "only if verified by site content" — the answers would need Andrew's sign-off on exact wording before publishing).

## Topic 4 — Complex aircraft checkout and endorsements (EXCLUDED — not verified as offered)

- **Queries**: transition training (19 impressions, position 13.26), complex checkout (19, 16.16) — [GSC-HISTORICAL].
- **Finding**: checked `fleet.html` and `programs.html` for any mention of complex, high-performance, retractable-gear, constant-speed-prop, or tailwheel training — **zero matches**. The planned aircraft (Piper PA-28, per `pricing.html`/`instrument-rating-training.html`) is a fixed-gear, fixed-pitch-prop trainer and cannot be used for a complex endorsement by definition.
- **Per the brief's explicit instruction** ("only if truly offered") — **this is not proposed.** If Apex adds a complex/high-performance aircraft to the fleet in the future, this becomes a real opportunity worth revisiting.

## Topic 5 — Simulator-hours post: FAA-sourced update (VERIFY BEFORE TOUCHING — not updated in this pass)

- **Existing page**: `blog-how-many-simulator-hours-count-toward-instrument-rating.html` — already strong (6.48 average position, 4% CTR per the GSC export).
- **What was checked**: read the post's regulatory claims in full. It cites 14 CFR §61.65(i) (20-hour AATD credit, out of 40 total instrument hours, 15 of which must be dual) and is already explicit and honest that Apex itself does not operate a simulator or credit AATD time for its own students — a deliberate, disclosed choice, not a gap.
- **Why no update was made**: a web search for the current §61.65(i) text surfaced a secondary source referencing an "effective January 21, 2025" revision and an "AC 61-136B" advisory circular, but could not retrieve the authoritative eCFR text to confirm whether anything the post currently states has actually changed. Editing a cited FAA regulation on an unconfirmed secondary source would risk exactly the "fabricated regulatory assertion" the brief prohibits.
- **Recommendation**: Andrew (CFI/CFII) or another qualified reviewer check the live eCFR text for §61.65(i) and AC 61-136B directly before any edit is made to this post's regulatory claims. If confirmed unchanged, no action needed. If changed, the fix is a small, targeted factual correction — not a rewrite.
