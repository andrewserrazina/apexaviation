# Apex Aviation Marketing Site — Offerings Matrix, Compliance Audit & CRO Pass

Date: 2026-10-20

## 1. Authoritative Offerings Matrix

Every price below is sourced from the live Supabase project (`wqzfhcjsfzwrimvsudxy`) — DB tables/RPCs or the Edge Function constant backing the actual Stripe checkout — not from marketing copy. Where no live checkout exists, that's stated explicitly.

| Offering | Current Price | Source of Truth | Availability | Format | Booking/Purchase URL | Audience | Status |
|---|---|---|---|---|---|---|---|
| Apex Advantage free account | Free | N/A (no checkout) | Live | Self-serve signup | `portal-login.html?view=signup` | All pilots | **Live now** |
| Checkride Prep (Private Pilot) | **$29**, one-time, permanent | `supabase-portal-schema-v158-checkride-prep-permanent-29.sql` (`get_checkride_prep_pricing()`, `v_price := 2900`), matches `create-checkout-session`'s fallback constant exactly | Live | Self-paced digital unlock | `checkride-prep.html` | Private Pilot checkride candidates | **Live now** |
| Private Instruction (1-on-1) | **$55/hour**, flat, every certificate level | `PRIVATE_INSTRUCTION_RATE_CENTS = 5500` in `create-checkout-session/index.ts`; `private_instruction_availability`/`bookings` tables (v161) | Live | Live 1-on-1 video, self-serve slot booking | `apex-advantage-private-instruction.html` | Private/Instrument/Commercial, any stage | **Live now** (replaced the discontinued group Ground School, Oct 2026) |
| Mock Oral (Private Pilot) | **$129** base / **$179** with recheck | `mock_oral_products` table, live query: `pp_mock_oral` = 12900¢, `pp_mock_oral_recheck` = 17900¢ (both `active = true`); a third tier `pp_checkride_ready` ($229) exists but `active = false`, not offered | Live | Live 1-on-1 video, 120 min | `apex-advantage-mock-oral.html` | Private Pilot checkride candidates | **Live now** |
| Group Ground School (per-session) | ~~$25/session~~ | N/A — discontinued | Discontinued | — | Public registration page now redirects (`apex-advantage-private-pilot.html`) | — | **Fully discontinued.** See §3 below — this audit found and closed several places where new registration was still live despite yesterday's rollout. |
| Group Ground School (full pack) | ~~$400~~ | N/A — discontinued | Discontinued | — | — | — | **Fully discontinued** (same fix) |
| Future Austin flight training (Private/Instrument/Commercial certificates) | Not yet priced publicly | None (pre-launch) | Planned, opening January 2027 | In-person + AATD simulator | Waitlist only (`home.html#waitlist`) | Prospective Austin-area students | **Future — waitlist only**, no live checkout |
| Simulator (self-directed AATD time) | **$90/hr** (stated marketing figure, no DB/checkout backing) | Marketing copy only — no `simulator_products` table or Stripe price exists; this is a published rate, not a verified live price | Planned, opening January 2027 | Self-directed sim time | Waitlist / inquiry (`fleet.html`, `contact.html`) | Future Austin students, aircraft owners | **Future — not bookable**, rate is a stated plan, not a confirmed live price |
| IPC Package (future) | **$225** (stated) | Marketing copy only, same caveat as above | Planned, Jan 2027 | Pre-brief + AATD + debrief | Waitlist | Instrument-rated pilots | **Future — not bookable** |
| Flight Review package (future) | **$150** (stated) | Marketing copy only, same caveat | Planned, Jan 2027 | Ground-training hour + sim scenario work (flight-training hour is separate, done in an aircraft) | Waitlist | Certificated pilots due for a flight review | **Future — not bookable** |

## 2. FAA Regulatory Claim Corrections (Phase 2 / Priority 0B)

Two claims were found to be overbroad and were corrected. Both concerned the not-yet-open Austin AATD simulator facility.

**`site/fleet.html`** (two instances) and **`site/pricing.html`** (one instance) previously stated that a complete Instrument Proficiency Check *or* a complete Flight Review could be done "100% in the AATD" / "entirely in the AATD" / "fully satisfies FAA requirements," citing 14 CFR §61.57(d) and §61.56.

- **§61.57(d) (IPC):** 61.57(d) does permit IPC tasks in an approved aviation training device, but only under that specific device's own FAA Letter of Authorization — which cannot exist yet for equipment that hasn't been installed or inspected (the facility opens January 2027). Corrected to: IPC tasks "can be completed in an approved AATD, subject to that specific simulator's FAA Letter of Authorization — finalized once the Austin facility opens."
- **§61.56 (Flight Review):** a flight review's required "flight training" hour is understood industry-wide to require time in an actual aircraft (or a full-flight simulator under an approved Part 142 program) — §61.56, unlike §61.109(k)/§61.65(i)/§61.129(i), contains no device-credit provision for the flight-training portion. Corrected to state plainly that the AATD covers the flight review's ground-training hour; the flight-training hour still requires an aircraft.

Also softened "FAA-approved" → "FAA-qualified" in two places (`fleet.html`'s schema.org description, `commercial-pilot-training.html`'s hero sub) for consistency with how the rest of the site correctly describes AATD status — "qualified" + device-specific LOA is the accurate framing, not a blanket "approved."

Ten `flight-training-*.html` city pages (Austin-area simulator pages — a different set from the ~160 `ground-school-*`/Private Instruction SEO pages) made the same "satisfy your flight review requirement with a sim session" claim in a Biennial Flight Review bullet; all ten were corrected to the same accurate framing (ground-training hour in the sim, flight-training hour in an aircraft).

**These are my own corrections, informed by FAA regulatory knowledge, not an independently-verified legal opinion.** Per the brief's own instruction, I'm flagging this explicitly for instructor/legal review rather than presenting it as verified. The regulatory substance (what counts as credit vs. what's merely conducted in a simulator) is the kind of claim that should get a second set of eyes — ideally Andrew's own CFI/AGI judgment or legal counsel — before being treated as final.

## 3. Critical Finding: Group Ground School Was Still Live Internally

Yesterday's Private Instruction rollout closed every **public marketing** path to the discontinued group Ground School ($25/session, $400/pack) — new pages, nav, footers, city pages. This audit found that the **member portal itself** (`site/portal.html` + `site/portal-stable.js`, not the admin CRM app) still had a fully live, unconditional path to new registration, reachable by any member (including one who'd signed up seconds earlier):

- A nav entry with no gating (unlike the adjacent "ACS Lessons" item, which has `data-gated="true"`), leading to a section whose header read "Register for a session... pay online and you're confirmed instantly," plus a live $400-pack upsell button.
- The public signup page (`portal-login.html`)'s default copy and four lead-magnet-specific variants telling every new visitor they could "book live ground school sessions ($25/session)."
- Five separate dashboard upsell widgets/task-checklist entries actively recommending a *new* $25 class or the $400 pack, keyed off a member's engagement history.
- A Refer-a-Friend reward ("a free Ground School session per referral") that is no longer redeemable through any UI path.
- A permanent Account-page info row stating "Ground School: $25/session, pay at the door."

**Fix applied** (per your explicit direction: *close new sales, preserve existing-member access*):

- The nav entry now starts hidden and only unhides for a member with real existing history (a registration, a recording, or the pack) — `hasGroundSchoolHistory()`/`renderGroundSchoolNavIfApplicable()` in `portal-stable.js`, mirroring the existing Module Workbook nav pattern.
- A member with no history who hits `#ground-school` directly (bookmark, typed hash) is bounced to the dashboard — same guard pattern used elsewhere in this file (`enforceGroundSchoolAccess()` + a `showSection()` guard).
- The section itself now only shows existing-access cards (confirmed registrations, recordings, pack progress). The browse-and-register UI (cards/calendar/week views, the $400 unlock button) is still in the DOM — so none of the surrounding rendering code had to be touched or risk breaking — but is wrapped in a permanently-hidden container, so no one can ever see or click it.
- All five dashboard upsell paths now point at Private Instruction instead.
- The Refer-a-Friend dashboard banner is now permanently hidden (its reward can't be redeemed through any reachable UI); the Account-page card's copy no longer promises a reward it can't deliver, and a member with a real unspent reward is told to email Andrew directly rather than pointed at a dead flow.
- Public signup-page copy (badge, subhead, 4 lead-magnet variants, success-screen text) now says Private Instruction instead of Ground School.
- The stale Account-page "$25/session, pay at the door" row now reads "Private Instruction — $55/hour, booked online."

**Left alone (confirmed already unreachable, no live path creates them):** the `?offer=ground-school-pack` box on `portal-login.html` and the `?registered=1` guest-purchase-confirmation redirect handler — both already orphaned since the only page that fed them was converted to a redirect yesterday, and no remaining UI can create a new `$25`/`$400` purchase to feed them now either. Backend tables (`scheduled_ground_classes`, `ground_sessions`, the `ground-school-registration` checkout purpose) are untouched, consistent with "this is an advertising/access change, not a backend decommission."

All 462 existing tests still pass; no migration or Edge Function changes were needed for any of this (pure front-end gating).

## 4. Other Fixes Applied

- **Pricing page gap:** Mock Oral ($129/$179) was missing entirely from `pricing.html`'s "available now" section despite being a live product with its own landing page — added.
- **Four lead-magnet pages** (`radio-calls.html`, `spin-awareness.html`, `weight-balance.html`, `dpe-questions.html`) still listed "live ground school registration" as a free-signup perk — updated to Private Instruction.
- **Six flagship pages** (`about.html`, `blog-post.html`, `instructors.html`, `private-pilot-training.html`, `commercial-pilot-training.html`, `instrument-rating-training.html`) and one footer link (`apex-advantage-mock-oral.html`) had live $25/class CTA banners or stale footer links missed by yesterday's sweep — fixed.
- **Homepage (`home.html`):** removed a duplicate "Apex Advantage" card that repeated content already covered in the dedicated "Live Today" section; retitled the remaining section to cleanly separate "available now" from "coming to Austin" (per the brief's explicit hierarchy); fixed a Simulator Sessions card that was badged "Opening Jan 2027" yet had active "Book a Session, $90/hr" language — now consistently framed as a planned rate with a waitlist-appropriate CTA; tightened the hero subheadline, which was repeating the badge/stats row almost verbatim.
- **Checkride Prep landing page (`checkride-prep.html`):** the tested, live hero headline was left untouched (replacing a working, previously-A/B-tested headline on a revenue page without new data to justify it isn't a good trade). Instead, added a new Mock Oral cross-sell section at checkout, incorporating the brief's suggested "don't let checkride day be your first mock oral" framing as a genuine, additive conversion improvement, with its own dedicated analytics event.

## 5. Residual Items Flagged, Not Changed

- **`jobs.html`'s "Ground Instructor" job posting** still describes hiring for fixed-schedule group sessions. Rewriting it into a Private Instruction hiring posting means inventing compensation/schedule details that are a staffing decision, not a copy fix.
- **The Refer-a-Friend reward's underlying mechanism** (`redeem_referral_reward()` RPC) is still hard-wired to the legacy `ground_sessions` path. Repointing the reward at Private Instruction needs a backend/RPC change, not just UI copy — flagged for a product decision.
- **Regulatory claim corrections (§2 above)** should get a second look from Andrew or counsel before being treated as final, per the brief's own instruction not to present AI-derived regulatory interpretation as verified.

## 6. Verification

- Full test suite: 462/462 passing (no regressions from any of today's changes).
- `node --check` / HTML parse validation on every modified `.js`/`.html` file.
- Repo-wide re-grep for `$25`, stale "ground school registration/session" language, and "100%/entirely/fully satisfies" regulatory phrasing — clean outside the explicitly-noted residual items above.
