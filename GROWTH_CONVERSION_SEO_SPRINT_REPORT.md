# Apex Aviation — Website Growth, Conversion & Launch-Readiness Sprint

Branch: `growth-conversion-seo-sprint-2026-11` (isolated; not merged or pushed to production). No PR opened. No production payment data altered. No real emails sent to real recipients. No live prices changed. No unconfirmed airport authorization advertised.

Date: 2026-11-26

---

## 1. Summary

This sprint audited apexaviationtx.com (93 static pages + its Supabase-backed Operations Portal) against five conversion funnels, content/pricing consistency, technical SEO, mobile performance/accessibility, and analytics coverage, then implemented every high-confidence fix the audit surfaced. The single highest-impact finding was a 2.1MB logo image rendered at 40px tall on every page, which was the dominant cause of two catastrophic mobile LCP outliers (19.0s and 14.3s) — fixed and verified to bring the worst page's LCP down to 3.1s. A real content/mechanism defect was also found and fixed: four separate pages described booking as an email-first, no-prepayment process, while the two actual live booking pages (Mock Oral, Private Instruction) use instant self-service calendars with required Stripe prepayment.

All fixes are implemented, tested (1519/1519 vitest tests pass, lint and build clean), and committed to this branch. Nothing has been merged, pushed, or deployed.

---

## 2. Audit methodology

- Two background research agents ran in parallel with full codebase context: one swept every public page (plus JSON-LD structured data, not just visible HTML) for business-fact inconsistencies; the other ran Lighthouse (desktop + mobile) and manual Playwright DOM checks across 6 representative pages for technical SEO, accessibility, and performance.
- I personally verified every live price (Mock Oral, Private Instruction, Checkride Prep) against the actual Supabase database and Stripe-facing Edge Function code — not against the brief's own stated figures — before trusting any pricing claim.
- I ran a real synthetic signup through the live `create-free-account` Edge Function with throwaway test data, confirmed the resulting profile and analytics event were correct, then deleted both test rows immediately.
- Every fix was re-verified: full vitest suite (1519 tests), `npm run lint`, `npm run build`, and Playwright screenshot/console checks across 9 touched pages at desktop and mobile widths.

---

## 3. Issues found and resolved (ranked by business impact)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Sitewide 2.1MB navbar logo (displayed at 40px) causing severe mobile LCP (19.0s / 14.3s on two pages) and contributing to `checkride-prep.html`'s CLS of 0.188 | **Critical** | **Fixed** |
| 2 | 4 pages (`pricing.html`, `index.html`, `about.html`, `contact.html`) described booking as an email-first, no-prepayment process; the real Mock Oral and Private Instruction pages use instant self-service calendar + required Stripe checkout | **High — broken customer expectation at point of purchase** | **Fixed** |
| 3 | `flight-time-building-austin.html` was a real orphan page: absent from `sitemap.xml`, zero internal inbound links from anywhere on the site | **High — invisible to search engines and visitors** | **Fixed** |
| 4 | `<main>` landmark missing (accessibility regression) on `checkride-prep.html`, `blog-private-pilot-checkride-readiness.html`, `flight-training-taylor.html`; no skip-link either | **Medium** | **Fixed** |
| 5 | `prefers-reduced-motion` had no CSS-side rule anywhere sitewide (JS-side guard existed, CSS did not) | **Medium** | **Fixed** |
| 6 | Mobile hamburger button: 32×24px (under 44×44 touch-target minimum) and never toggled `aria-expanded` | **Medium** | **Fixed** |
| 7 | Stale FAQ voice: `pricing.html`'s "Why isn't there a flight simulator?" answer still carried the retired "costs we'd rather not pass on to students" framing (JSON-LD + visible), missed by the earlier messaging-overhaul's plain-text grep sweep | **Medium** | **Fixed** |
| 8 | A pre-existing test (`groundSchoolClosureVerification.test.js`) was fragile: it used `indexOf` on a string that also appears in JSON-LD, so it was checking the wrong occurrence for the $179 recheck price | **Low (test bug, not a content bug)** | **Fixed** |
| 9 | `index.html` had 4 identical non-descriptive "Learn More" links to 4 different destinations (Lighthouse `link-text` failure); `index.html`/`checkride-prep.html` meta descriptions were 273/212 characters (over SERP display length) | **Low** | **Fixed** |
| 10 | 3 content images on `checkride-prep.html` had `alt=""` | **Low** | **Investigated: 2 of 3 are legitimately decorative** (rotated background page-stack behind the real cover art; the same screenshots have full descriptive alt text elsewhere on the same page where they're actually explained) — not a real defect. The 3rd (an instructor headshot inline with his name) got descriptive alt text added anyway. |
| 11 | No CI — a 1519-test vitest suite existed but nothing ran it automatically on push/PR | **Process gap** | **Fixed**: added `.github/workflows/portal-ci.yml` (lint + test + build on push/PR to `main`); confirmed `npm run lint` exits 0 despite its existing warnings, so this won't produce false-failing builds |

### Checked and found to be NOT a defect (false positives ruled out)
- "January 2027" stale-date claims: zero matches sitewide.
- Simulator/Redbird/AATD claims presented as current offerings: all instances are either correctly negated or regulatory-education content with explicit third-party framing.
- Proposed-vs-confirmed aircraft/airport language: consistently hedged everywhere ("proposed," "pending," "not confirmed").
- Founding-member benefit claims: consistent everywhere (priority scheduling + first-year locked-in rate; no conflicting discount percentage anywhere).
- Pricing for the 4 named products: fully consistent and DB-verified (see §4).
- Inactive $229 "Checkride Ready Bundle" product: confirmed not advertised on any page.
- Instructor credentials and flight-hour statistics: consistent sitewide.
- `robots.txt` and `404.html`: both correct, no changes needed.

---

## 4. Live pricing verification (Phase 6 / Phase 2 cross-check)

Verified directly against the Supabase database and Stripe-facing Edge Function code — not assumed from the brief:

| Product | Live price | Source of truth | Site display |
|---|---|---|---|
| Checkride Prep | $29.00 (standard tier, 0 founding seats remaining) | `get_checkride_prep_pricing()` RPC, called server-side in `create-checkout-session` | Matches |
| Mock Oral (base) | $129.00 | `mock_oral_products` table, `pp_mock_oral`, `active: true` | Matches |
| Mock Oral + Recheck | $179.00 | `mock_oral_products` table, `pp_mock_oral_recheck`, `active: true` | Matches |
| Private Instruction | $55.00/hr (flat) | Hardcoded `PRIVATE_INSTRUCTION_RATE_CENTS` constant in `create-checkout-session` (not DB-driven, unlike the other two — an architectural inconsistency worth noting but not a bug, since there's only one flat rate to maintain) | Matches |
| "Checkride Ready Bundle" | $229.00, `active: false` | `mock_oral_products` table | Not advertised anywhere — correctly dormant |

No price discrepancies found. No prices were changed.

---

## 5. Funnel verification (Phase 3)

- **Free portal registration**: Ran a real synthetic signup against `create-free-account` with a throwaway `@example-apexqa.test` address. Confirmed the profile was created correctly (`checkride_timing` captured, `checkride_prep_unlocked` defaulted false) and that the `activation_email_1_sent` analytics event fired. Cleaned up both rows immediately. **Working correctly.**
- **Readiness assessment**: Code-level verified — it calls the same `create-free-account` function (already live-tested above) via a well-documented, carefully error-handled gate flow with identity stitching. **Working correctly.**
- **Mock Oral / Private Instruction booking**: Confirmed via code audit (atomic conditional-UPDATE booking claim inside `stripe-webhook`, non-atomic early UX check before Stripe redirect, DB-driven pricing) and via the content-consistency sweep (Fork A), which independently confirmed both live product pages actually implement instant self-service calendar + Stripe checkout. Not re-tested with a live Stripe session in this pass, to avoid creating unnecessary production checkout-session/Stripe artifacts beyond what the existing 1519-test suite and this sprint's code audit already cover.
- **Checkride Prep purchase**: Price and purpose-handling logic verified in code and against the live DB (see §4). Not re-tested live for the same reason as above.

---

## 6. Mobile performance before/after

Measured with Lighthouse (mobile, throttled), `checkride-prep.html` — the single worst-performing page found:

| Metric | Before | After | Change |
|---|---|---|---|
| Largest Contentful Paint | 19.0 s | 3.1 s | **−84%** |
| Cumulative Layout Shift | 0.188 | 0.0004 | **effectively eliminated** |

The fix: replaced the 2.1MB, 1536×1024 `apexwhite.png` (used as the navbar/footer logo on all 85 pages, displayed at 26–42px tall) with a purpose-built 240×160, 64-color-quantized PNG at 2.4KB — visually identical at display size — and added explicit `width`/`height` attributes to every logo `<img>` tag that was missing them (the direct cause of the CLS). The original full-resolution file is untouched and still used for `og:image`, `twitter:image`, and JSON-LD `logo` fields, where its larger size is appropriate.

Other mobile/accessibility fixes applied: `<main>` landmark + skip-link restored on 3 pages where it had regressed; sitewide `prefers-reduced-motion` CSS rule added; mobile hamburger button enlarged to the 44×44px touch-target minimum and now correctly toggles `aria-expanded`.

---

## 7. Technical SEO

- Fixed the one real orphan page (`flight-time-building-austin.html`): added to `sitemap.xml`, added two genuine contextual internal links (from `commercial-pilot-training.html` and `instrument-rating-training.html`, both topically relevant since the page is about instrument/commercial time-building).
- Shortened 2 over-length meta descriptions (`index.html` 273→155 chars, `checkride-prep.html` 212→146 chars).
- Fixed 4 identical non-descriptive "Learn More" links on `index.html` (now each names its real destination).
- Canonical tags, JSON-LD validity, heading `<h1>` uniqueness, `robots.txt`, and `404.html` were all already correct — no changes needed.
- Did not create any new local-SEO landing pages this sprint — the existing 28-city-page network was judged sufficient and mass-generating more would risk the thin-content pattern the brief explicitly warned against.

---

## 8. Analytics coverage

Confirmed via the live synthetic signup test (§5) that `activation_email_1_sent` fires correctly and is attributed to the right profile. Did not attempt to verify GA4/Meta Pixel dashboards directly (no read access to those external consoles in this environment) — this is a genuine coverage gap in this report, not a claim that those integrations were checked and found fine.

---

## 9. Remaining launch-readiness risks (not fixed this sprint — flagged for awareness)

- **Architectural inconsistency**: Private Instruction pricing is a hardcoded constant while Mock Oral pricing is DB-driven. Not a bug today (one flat rate), but if Private Instruction ever needs tiered pricing, it'll need the same DB-driven treatment Mock Oral already has.
- **GA4/Meta Pixel dashboard verification**: not independently confirmed this sprint (see §8).
- Several other large images (`SimBay.png`, `Lobby.png`, `ClassroomMockup.png`, `ApexPrivate.png`, all 1.6–2.2MB) exist in `site/images/` but were not confirmed to be causing LCP issues on any tested page — worth a follow-up sweep if any page using them shows up slow.
- Heading-hierarchy skips (h2→h4, no h3) remain on 4 pages (`index.html`, `fleet.html`, `blog-private-pilot-checkride-readiness.html`, `flight-time-building-austin.html`) and a couple of lower-priority contrast/`link-in-text-block` WCAG AA items remain on 2 pages (`flight-time-building-austin.html`, `flight-training-taylor.html`) — deferred as lower-impact than the items fixed this sprint.
- Lighthouse's `best-practices` score plateau (77 across every page tested) traces to third-party cookies set by Microsoft Clarity and the Meta Pixel — a product/tooling decision, not a first-party code defect.

---

## 10. Verification performed

- `npx vitest run` (portal): **1519/1519 tests pass**, including the newly fixed orphan-page and Mock Oral pricing tests.
- `npm run lint`: clean (pre-existing warnings only, no errors; confirmed exit code 0 before adding it to CI).
- `npm run build`: succeeds.
- Playwright: console/network-error check and horizontal-overflow check across 9 touched pages at desktop (1440px) and mobile (390px) widths — all clean except one expected Microsoft Clarity CORS warning (an artifact of testing from `localhost` instead of the real production origin, not a production defect).
- Visual spot-checks of the new logo on both a standard page and the heaviest custom-markup page (`checkride-prep.html`) confirm it renders crisp and correctly at every size used sitewide.

---

## 11. Clean commit and deployment plan

All changes are committed on `growth-conversion-seo-sprint-2026-11`, branched from `origin/main`. Per the brief's explicit instructions, **this branch has not been pushed, and no PR has been opened or will be, without your explicit go-ahead.** Suggested next step once you're ready: push the branch, open a PR summarizing the changes above, and deploy via the existing Cloudflare Pages auto-deploy on merge — the same process used for every prior sprint in this repo.
