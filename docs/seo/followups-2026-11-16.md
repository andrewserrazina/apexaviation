# SEO Plan Follow-ups — 2026-11-16

Resolves the 3 items from `implementation-plan.md`'s approval-needed list that were explicitly picked up for action this round: the instrument-rating-training.html FAQ, the §61.65(i) regulatory recheck, and the brand-ambiguity / CTR-disparity research. Does **not** touch the `www` redirect or the new instrument-checkride article (still pending separate approval).

## 1. FAQ addition to `instrument-rating-training.html` — done, committed, not merged

Added a 5-question `faq-section`/`faq-item` block (matching the existing pattern already live on `programs.html`) plus a matching `FAQPage` JSON-LD block. Every answer restates a fact already verified elsewhere in this plan or already present on the page itself — no new claim:

1. "Can I start instrument training in Austin now?" — live-now private instruction vs. March-2027-target in-aircraft, same distinction already on the page.
2. "What does instrument ground training with Apex involve?" — restates the page's own 4-stage syllabus section.
3. "How much does virtual instrument ground instruction cost?" — $55/hr, same figure already quoted on-page.
4. "Does the Checkride Prep system cover the instrument checkride?" — restates `checkride-prep.html`'s own "in development" disclosure (the same fact that justified the internal link added in PR #321).
5. "When will in-aircraft instrument training open in Austin?" — restates the existing "targeting March 2027, subject to approval" framing, explicit that it's a target, not a confirmed date.

No pricing, availability, or regulatory claim here is new — every sentence maps to something already live on the site. Verified via Playwright: 5 FAQ items render, accordion toggles (`aria-expanded` flips on click, reusing the existing generic `script.js` handler — no JS changes needed), both JSON-LD blocks (`FAQPage` + the existing `Course` block) parse correctly, 0 console errors, confirmed on both desktop and mobile (390×844) viewports.

Per your instruction, this is committed to a PR and **not merged** — same unpublished-until-approved pattern used for the "Go-Around" blog post (PR #319) before it was wired live.

## 2. §61.65(i) regulatory recheck — confirmed accurate, no edit made

You supplied the current regulation text directly:

> Use of an aviation training device. A maximum of 10 hours of instrument time received in a basic aviation training device or a maximum of 20 hours of instrument time received in an advanced aviation training device may be credited for the instrument time requirements of this section if—
> (1) The device is approved and authorized by the FAA;
> (2) An authorized instructor provides the instrument time in the device; and
> (3) The FAA approved the instrument training and instrument tasks performed in the device.

Compared against `blog-how-many-simulator-hours-count-toward-instrument-rating.html`'s claim: "a pilot... may log up to **20 hours**... in an Aviation Training Device... provided that device meets the FAA's **AATD** (Advanced Aviation Training Device) qualification standard."

**Result: the post's figure is correct.** 20 hours is exactly the AATD-tier allowance in the text you supplied; the post never claims the 20-hour figure applies to a basic ATD (BATD), so there's no conflict with the 10-hour BATD tier. The post's "What Qualifies as an AATD?" section ("not every sim counts... meets defined fidelity standards") and "provided it's logged with an authorized instructor and covers the appropriate training tasks" already cover conditions (1)–(3) in substance, even though it doesn't cite them as three enumerated FAA conditions.

**No edit made.** The one thing the post doesn't mention at all is the BATD/10-hour tier — not an inaccuracy (silence isn't a false claim), but if you'd like it added for completeness (e.g. "A lower-fidelity basic ATD (BATD) caps at 10 hours instead"), that's a one-line, low-risk addition I can make on request. Flagged here, not applied.

## 3. Brand ambiguity and CTR-disparity research — findings, no action implied

### Brand ambiguity: material, not negligible

Other "Apex"-named aviation training businesses exist, including in Texas:

- **Apex USA LLC** (Georgetown, TX) — offers PPL/CPL/ATPL training programs. Same state, similar positioning to apexaviationtx.com.
- **Apex Helicopters** (Arcola, TX, near Houston) — helicopter flight training, different segment but same brand word + same state.
- **Apex Flight Academy / Apex Jet Academy** — primarily Fort Lauderdale, FL; some pages reference a possible future Austin-area location (date unclear, ~2028 in one source) — unverified, but worth being aware of if real.
- A few other low-quality/placeholder-looking pages surfaced in search (e.g. `apex-flight-academy.pages.dev`) that don't look like established, verifiable businesses — noted but not weighted heavily.

**Assessment:** real, not a false alarm. Apex USA LLC alone — same state, similar certificate-level positioning — is enough that a generic "apex aviation" or "apex pilot training texas" search could plausibly surface a different company, meaning not all of the 409 branded-query impressions in the GSC baseline are necessarily intent-matched to apexaviationtx.com specifically.

**No action taken or recommended here** — per the brief's own instruction not to target or disambiguate against another business's brand without first confirming real intent-mismatch from GSC's own query-level data (which this session doesn't have API access to pull). If you want, a future pass could look at whether the site's own `Organization` schema or `about.html` copy should more explicitly include "Austin, Texas" near the business name to help disambiguate in snippets — that would be a self-description improvement, not a competitive-targeting move, but it's a separate, deliberately not-yet-proposed change.

### Desktop/mobile CTR/position disparity: explainable by normal mechanisms, not a bug

No single cause; most likely several ordinary effects stacking:

- **Query-mix averaging** (well-documented, probably the primary driver): desktop typically ranks for a longer, weaker-matching tail of queries than mobile, which drags its *average* position down — an artifact of what gets averaged, not a penalty.
- **Local-intent skew on mobile** (well-documented): mobile search skews more local/nearby, and Google's local-relevance weighting tends to favor local-business mobile rankings for geo-intent queries — directly relevant to an Austin-specific flight school.
- **Position-specific mobile CTR advantage**: independent industry data (a 2021 CTR study) shows mobile CTR beating desktop CTR at positions 3–10 broadly, regardless of site.
- **AI Overviews reducing desktop CTR disproportionately** (2026 industry trend, not verified for this specific site): plausible contributor, can't be confirmed without CrUX/GSC-API access.

**Assessment:** this looks like normal, explainable behavior rather than a technical defect on this site — **no fix is indicated.** One practical note for the P3 measurement plan: there's a documented GSC data-logging anomaly around April 2026; worth checking whether any future comparison window straddles that date before reading too much into a period-over-period device-split change.

## Status

| Item | Outcome |
|---|---|
| FAQ + FAQPage schema on `instrument-rating-training.html` | Done — committed to a new branch/PR, not merged |
| §61.65(i) citation | Confirmed accurate as-is — no edit made (optional BATD-mention addition flagged, not applied) |
| Brand ambiguity | Researched, documented — no action taken (your own instruction: don't target another brand without confirmed intent-mismatch) |
| CTR disparity | Researched, documented — assessed as explainable, not a bug; no fix proposed |

Still outstanding from the original approval-needed list, untouched by this round: the `www` → non-`www` redirect (Cloudflare DNS, outside this repo) and the proposed new instrument-checkride-prep article (outline only, not written).
