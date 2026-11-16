# Implementation Plan — 2026-11-16

Status key: **Done** (committed on branch `seo/gsc-action-plan-2026-11-16`, not merged/deployed), **Proposed** (not implemented — needs owner approval before any work), **Needs investigation** (open question, no fix proposed yet).

## P0 — Technical SEO

| Task | Status | Files | Effort | Risk | Validation done | Rollback |
|---|---|---|---|---|---|---|
| Re-verify `.html`↔extensionless, trailing-slash, http→https redirect behavior live | Done | — (read-only) | Low | None | Real `curl` requests against production for 6 pages, all confirmed 308/301 to canonical form | N/A, no change made |
| `www` vs non-`www` duplicate host | **Needs investigation / Proposed fix only** | Outside this repo (Cloudflare zone/DNS) | Medium | Medium — touches production routing at the host level | Confirmed live via `curl`: both hosts serve identical 200 content, canonical tag present and correct on both | N/A, nothing implemented |
| Sitemap/robots.txt health | Done (re-verified, no change needed) | — | Low | None | Live `curl` of `robots.txt` and `sitemap.xml`; 0 `.html` URLs in sitemap, 74 clean entries | N/A |
| Structured-data accuracy spot-check (Course/Organization, Product/Offer) | Done (re-verified, no change needed) | — | Low | None | Read all relevant JSON-LD blocks in full; prices/descriptions match live page copy | N/A |

## P1 — Optimize existing high-intent pages

| Task | Status | Files | Effort | Risk | Validation done | Rollback |
|---|---|---|---|---|---|---|
| `/instrument-rating-training` meta description + og/twitter description: lead with the real "live now" service instead of "Targeting March 2027" | **Done** | `site/instrument-rating-training.html` | Low | Low — text-only, no new claims (grounded in the page's own existing "Private Instruction · Live Now" section) | Playwright render check, confirmed new `<meta name="description">` content, 0 console/network errors | `git revert`, or restore prior `<meta>` lines (given in diff) |
| `/private-pilot-training` meta description + og/twitter description: same pattern | **Done** | `site/private-pilot-training.html` | Low | Low, same reasoning | Same | Same |
| Internal link: `checkride-prep.html` → `instrument-rating-training.html` (the one of 4 requested source pages that was missing it) | **Done** | `site/checkride-prep.html` | Low | Low — accurately scoped (points to the training page, not implying the paid Checkride Prep system covers instrument content) | Playwright: link renders, `href` correct, text accurate | Remove the added `<a>`/text, one line |
| `instrument-rating-training.html` FAQ section + `FAQPage` schema targeting real query phrasing | **Proposed, not implemented** | would be `site/instrument-rating-training.html` | Medium | Low-Medium — new visible content needs Andrew's sign-off on exact wording before publishing (not a metadata-only change) | — | — |
| `blog-ifr-currency-austin.html`: additional inbound internal links from `instrument-rating-training.html`/`pricing.html` | **Proposed, not implemented** | would touch 2-3 files | Low | Low | — | — |
| Homepage/About: audit title/meta/Organization consistency | **Done (audit only, no change)** | — | Low | N/A | Confirmed homepage canonical, title, and `EducationalOrganization` schema (added in an earlier session pass) are already consistent across `www` and non-`www` responses | N/A |
| Investigate "Apex Aviation" brand-adjacent query ambiguity (other similarly-named schools) | **Needs investigation** | — | — | — | Not investigated this pass, per the brief's own caution against targeting another business's brand without confirming intent first | — |
| Desktop vs. mobile CTR/position disparity | **Needs investigation** | — | — | — | Flagged, not diagnosed — no CWV/CrUX data available in this session | — |

## P2 — Content cluster

See `content-opportunities.md` in full. Summary of dispositions:

| Topic | Disposition |
|---|---|
| Instrument checkride/oral prep (Austin) | **New article proposed** — outline only, not written, not published |
| Instrument proficiency/currency training (Austin) | **Already covered** by 2 existing posts — recommend strengthening links/title, not a new article |
| Instrument ground training / IR pathways (Austin) | **Already covered** by `instrument-rating-training.html` itself — recommend an FAQ addition to that page (see P1), not a competing new article |
| Complex aircraft checkout/endorsements | **Excluded** — not a verifiably offered service (no complex/high-performance aircraft in the fleet or on any service page) |
| Simulator-hours post FAA-sourced update | **Not touched** — current regulatory citation (14 CFR §61.65(i)) could not be independently reverified against the authoritative eCFR text this session; flagged for Andrew (CFI/CFII) to confirm before any edit |

No new page was created or published from this plan.

## P3 — Measurement and reporting

| Task | Status | Notes |
|---|---|---|
| Baseline capture | **Done** | `gsc-baseline-2026-11-16.md`, transcribed faithfully from the supplied export with all original caveats preserved |
| 28-day / 56-day comparison plan | **Proposed process, not yet run (too early — 0 days have elapsed since this baseline)** | Re-pull the same GSC page/query filters at +28 and +56 days from 2026-11-16; compare **daily rates**, not raw totals, given the unequal-length-period lesson from this baseline; specifically re-check `/instrument-rating-training` and `/private-pilot-training` CTR against this baseline's 0.30%/0.53% |
| Guardrails for future changes | **Documented, not yet needed to invoke** | No unintended 404s/redirect chains, no accidental `noindex`, no loss of currently-indexed routes, no metadata regressions, no fabricated claims — re-run the same live-redirect and sitemap checks from `technical-audit.md` §1/§3 before and after any future change |
| Conversion tracking | **Not available this pass** | No evidence of GA4-to-GSC or analytics-to-booking conversion linkage was reviewed in this pass; out of scope for this specific brief |

## Explicit list of actions needing owner approval before any further work

1. **`www` → non-`www` host redirect** — requires Cloudflare zone/DNS-level configuration outside this repository. Not implemented. (`technical-audit.md` §2)
2. **FAQ content additions** to `instrument-rating-training.html` (and the linked strengthening of `blog-ifr-currency-austin.html`) — real new visible content, needs Andrew's wording sign-off before it's written, let alone published. (P1 table above, `content-opportunities.md` Topics 2-3)
3. **New article**: instrument checkride/oral-exam prep — outline proposed in `content-opportunities.md` Topic 1; needs approval to write, then a separate approval to publish (same two-step process used for every other blog post this session).
4. **Simulator-hours post regulatory re-verification** — needs Andrew (or another CFI/CFII) to confirm current §61.65(i)/AC 61-136B text before any edit; not something this session can authoritatively verify alone.
5. **Desktop/mobile CTR disparity and brand-query ambiguity** — both flagged as open questions needing a human decision on whether/how to investigate further; no fix proposed because no diagnosis exists yet.

Nothing above was deployed, published, or pushed to a production-affecting state beyond what this plan's own safe patch (P1, items 1-3) already commits to a branch for review.
