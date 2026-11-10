# City Page Editorial Standard

Applies to every `site/flight-training-*.html` page (and any future
location-targeted page). Written during the Phase 2 local-SEO pass after
Phase 1 fixed the sitewide factual/structural issues (stale dates, a
fabricated ZIP, the Hutto/Taylor/combined-page duplication). This document
is the standard those fixes should be held to going forward — read it
before adding, rewriting, or approving a city page.

The one-line test for whether a page is done: **a prospective student from
that city would learn something true and useful here that they couldn't
get from a generic page with the city name swapped in.** If the answer is
no, the page needs more work or shouldn't exist as its own URL.

---

## 1. Purpose — decide this before writing a word

Every retained page needs a reason to exist that isn't "we wanted a page
for this city." State it explicitly as the first thing you decide, and let
everything else follow from it. Apex currently has three kinds of purpose:

- **Primary proposed location** (Taylor): the actual, specific place the
  planned T74 operation would be. One page only — don't split it.
- **Nearby prospective market** (Hutto, Round Rock, Pflugerville,
  Georgetown, etc.): explains why someone there might care about the
  primary location, without ever implying Apex operates in their city.
- **Regional hub** (Austin via the homepage / `service-areas.html`): no
  dedicated page needed if the hub already covers it — don't create one
  just to "have Austin covered."

If a city doesn't cleanly fit one of these, don't force it into a page.
Flag it for the consolidation review in section 10 instead.

## 2. Geographic accuracy — the non-negotiable part

- **Never imply Apex operates somewhere it doesn't.** Apex has no physical
  training location today, anywhere. The only proposed in-person location
  is Taylor Municipal Airport (T74), and even that is pending airport
  approval, parking, and aircraft arrangements — always say so.
- If a page mentions a real nearby airport the city's pilots actually use
  (KGTU, KEDC, etc.), **explicitly disclaim any Apex connection to it** in
  the same breath you name it. Don't let the airport's name do unintended
  work implying Apex is there.
- Say the city's relationship to Taylor plainly: is this the primary
  location, or a market that would commute to it? Never blur the two.

## 3. Local research — use real sources, cite them, keep a register

Acceptable sources: FAA airport data (5010 records) and Chart
Supplements, official airport or municipal/county sites, and reputable
aviation-data aggregators cross-checked against at least one other source
(airport facts especially — frequencies, runway data, and based-aircraft
counts vary across sources and go stale; note the discrepancy or hedge
rather than pick one number and assert it as fact).

**Never invent:** travel times, airport facilities/services not
independently confirmed, flight-school partnerships, local demand
statistics, student testimonials, instructor experience at a specific
airport, or training/graduation results. If you can't verify a claim,
omit it or mark it as approximate — don't round it into something that
reads as fact.

Keep a short, informal source register for factual local claims (a list of
what you cited and where, even just a comment at the top of the content
block) so a future editor can re-verify instead of re-researching from
scratch. The Phase 2 pass used Wikipedia/AirNav/FltPlan/SkyVector-sourced
facts cross-checked against each other for T74, KGTU, and KEDC — see the
Phase 2 validation report for the specific figures and caveats.

Do not copy long passages from any source — paraphrase, and always note
where a source itself flagged its own data as outdated or inconsistent.

## 4. Content originality — the doorway-page test

A city page fails this standard if you could regenerate it for a
different city by swapping the name and nothing else would need to
change. Every retained page needs:

- At least one fact or angle that's actually specific to that city or its
  geography (a real nearby airport, a real local growth driver, a real
  commuting reality — not a generic "growing suburb" line).
- Its own CFI-perspective educational angle, distinct from every other
  page's angle. Don't run the same "lesson frequency" section on five
  pages with the city name changed — if a topic genuinely applies
  everywhere, link to one authoritative page/post instead of duplicating
  it (see `blog-flying-austin-class-c-airspace-guide.html` and
  `blog-instrument-currency-vs-instrument-proficiency.html` for two
  examples already linked this way from Pflugerville and Georgetown).
- Its own FAQ questions, written for that city's actual situation — not
  the same four questions re-skinned.

Never manufacture uniqueness through synonym substitution or padding.
Fewer, better-differentiated pages beat more pages that all read the
same.

## 5. Service availability — say what's real, every time

Every page must distinguish, explicitly and often:

- **Available now**: Apex Advantage virtual education, checkride
  preparation, mock oral exams, and 1-on-1 online ground instruction
  ($55/hour).
- **Planned, not yet available**: in-person Part 61 aircraft training at
  the proposed Taylor (T74) location, targeting March 2027, subject to
  airport approval and aircraft arrangements. Service cards for planned
  offerings carry a "Planned — Pending Airport Approval" badge; never
  present them as bookable.

Never use present-tense verbs ("Apex Aviation offers/brings/fills/closes
that gap...") for the in-person operation. Use conditional language
("is planning," "would," "proposed") consistently, including in body
copy — not just the hero, where it's easiest to get right and easiest to
contradict two paragraphs later.

## 6. SEO structure

- One `<title>`, descriptive and specific to the page's actual purpose
  (not a copy-pasted template with only the city swapped).
- One meta description per page, written to reflect what's actually true
  on that specific page — not a reused sentence with the city name
  substituted.
- Exactly one `<h1>`, matching the page's stated purpose from section 1.
- Logical H2/H3 hierarchy — headings should work as a standalone outline
  of the page.
- Natural language, not keyword-stuffed city-name repetition.
- A correct, self-referencing canonical tag.
- JSON-LD: reuse the single canonical `Organization`/`LocalBusiness` node
  (`@id: https://apexaviationtx.com/#organization`) — never invent a
  separate `LocalBusiness` per city, never add an address field you can't
  verify, never add `aggregateRating`, reviews, or opening-hours markup
  that doesn't reflect reality. `areaServed` may vary per page.
- Don't add FAQ or review structured data markup "for rich results" —
  visible FAQ content is fine and encouraged; fabricated schema isn't.

## 7. Internal linking

- Every nearby-market page links to the Taylor (T74) page as the
  authoritative source for proposed-location detail — don't duplicate
  pricing or approval-status detail that already lives there.
- Link contextually (inline, tied to a specific claim or topic) more than
  via big undifferentiated blocks of city-name links. The "Nearby Areas"
  pill row is fine as a secondary navigation aid, not as the primary way
  pages connect to each other.
- Add a short "Related Resources" block linking to the specific programs,
  pricing, instructor, and blog pages actually relevant to that page's
  angle — not a generic link dump repeated identically everywhere.

## 8. Conversion CTAs

- For current/available services: direct, specific CTAs ("Book an Online
  Ground Lesson," "Explore Apex Advantage").
- For the planned operation: "Join the Flight Training Interest List" —
  never "Book a Flight" or "Start Flight Lessons Today" before anything is
  operational.
- Reuse the existing Formspree + `captureWaitlistLead` + GA4
  `landing_page_lead_submitted` pipeline. Don't build a second, parallel
  lead-capture system for a new page — give the new form a distinct
  `_source`/`sourceLabel` and GA4 `landing_page` value instead.
- Fire the submission-success analytics event only after a confirmed
  Formspree success — never on click, never on an invalid/incomplete
  submission.

## 9. Trust signals and imagery

- Use real Apex branding and the one approved instructor photo
  (`assets/images/mock-oral/andrew-hero.jpg`) consistently; don't
  introduce a new photo without confirming it's an authorized, real Apex
  or Andrew photo.
- Never depict a specific aircraft, airport ramp, or facility as Apex's
  own unless it verifiably is — a stock photo of "an airplane" implying
  it's Apex's planned PA-28, or a photo of T74/KGTU/KEDC implying Apex
  operates there, is exactly the kind of misleading trust signal this
  standard exists to prevent.
- Keep `alt` text descriptive and accurate; don't add decorative stock
  imagery that doesn't earn its place.

## 10. When a page doesn't meet this standard

If a city genuinely can't support a page that passes section 4's
originality test with real, verifiable local information, don't pad it to
look different — flag it in the recommendation matrix (see the Phase 2
validation report's Deliverable C) as a **consolidation candidate** or
**needs performance data**, and leave page-count decisions to a pass that
has real Search Console/GA4 numbers to act on. Never delete or redirect a
page on template-similarity grounds alone.
