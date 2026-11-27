# Apex Aviation — Website Quality & Conversion v1.2
## Review Package

**Scope:** `andrewserrazina/apexaviation`, isolated worktree `website-quality-conversion-v1.2`, branched from `origin/main` after the PR #345 merge commit `147d1b2`.
**Status:** All implementation, testing, and visual review complete and **uncommitted** in the worktree. Per the brief's Section 17, no push, commit, PR, merge, or deploy has been made. This is a review package for owner sign-off before anything is proposed for the live site.

---

## 1. Executive Summary

This pass covered a full content/visual/accessibility/performance/conversion audit of the public site (93 HTML files) plus the portal's conversion-adjacent paths, followed by implementation of every fix that was both (a) clearly correct and (b) within the brief's blast-radius limits. Nothing was deployed, merged, or published; several substantive items (regulatory wording, color-contrast measurement, the portal.html heading structure) are flagged for owner decision rather than silently changed.

**Implemented this pass (12 items, all passing full verification):**
1. Sitewide `<main>` landmark + skip-link fix — 70 pages (68 from the original sweep + 2 giveaway pages caught during test-writing)
2. Meta Pixel restored on `apex-advantage-mock-oral.html`
3. Checkride Prep FAQ accordion `aria-expanded`/`aria-controls` wiring (12 items)
4. `pricing.html` CTA fixed from a dead `mailto:` link to the real booking page
5. Sitewide "interest list" → "waitlist" terminology standardization (20 files)
6. Typography fix: stray `Georgia` → `Playfair Display` on two product-page hero subheads
7. Two unhedged driving-time claims softened to "about"/"roughly"
8. Three blog posts given missing internal links to related product pages
9. Readiness-article hero image resized (−60%) and reprioritized for LCP
10. Three `fleet.html` images given explicit width/height to prevent layout shift
11. **Homepage conversion-hierarchy fix:** removed a fully duplicated "Flight Training" card from the Services section that re-listed the same three certificates the Flight Training Paths grid already covers
12. **Mock Oral shared images optimized:** `andrew-hero.jpg` (−67%) and `andrew-instructor.jpg` (−56%), used across 30 referencing pages — resize targets deliberately chosen to preserve every page's existing HTML `width`/`height` attributes exactly, so no markup changed anywhere. *(Note: this item was implemented and tested alongside #9 in the original pass but was missed from this executive summary's numbered list until the PR #346 final-integration review caught the gap — see the PR's commit history for when it landed. Content and crop are unchanged; confirmed by direct visual diff against the `main` versions.)*

**Explicitly not implemented (owner review required):** the homepage's instrument-hours regulatory wording (§3 below) — prepared, not published, per the brief's Section 6/14 instructions.

**Verification:** 1,789 tests passing (1,519 pre-existing + 270 new), lint clean (pre-existing warnings only), build succeeds, zero broken images, 104 before/after screenshots across 10 pages at desktop + mobile + 6-breakpoint sweep.

---

## 2. Issue Register

| # | Page/Component | Problem | Severity | Evidence | Solution | Status | Verification |
|---|---|---|---|---|---|---|---|
| 1 | 70 pages sitewide | Missing `<main id="main-content">` + skip link | Confirmed defect (a11y) | Mechanical scan: 0 of 70 had both before this pass | Inserted standard skip-link + main-landmark pattern; 5 auth pages + 2 giveaway pages got page-appropriate variants | **Fixed** | New test suite (`websiteQualityConversionV12Regression.test.js`), 1-of-each assertion across all 84 landmark-checked pages |
| 2 | `apex-advantage-mock-oral.html` | Meta Pixel init missing (present on sibling product pages) | Confirmed defect (analytics gap) | Diffed against `apex-advantage-private-instruction.html`/`checkride-prep.html` | Restored standard snippet, verified no duplicate `fbq('track','PageView')` | **Fixed** | New Pixel-parity test across all 3 product pages |
| 3 | `checkride-prep.html` FAQ (12 items) | No `aria-expanded`/`aria-controls`; screen-reader users get no disclosure state | Confirmed defect (a11y) | Manual audit of accordion markup + JS | Added matching button/panel ids, wired `aria-expanded` into the existing toggle handler | **Fixed** | New test: all 12 buttons assert `aria-expanded`, each `aria-controls` resolves to a real panel |
| 4 | `pricing.html` bottom CTA | Primary CTA "Book a Virtual Session" linked to a bare `mailto:` instead of the booking page | Confirmed defect (conversion) | Manual click-through | Relinked to `apex-advantage-private-instruction` | **Fixed** | New test asserts no `btn` CTA on the page uses `mailto:` |
| 5 | 20 files sitewide | "Interest list" vs. "waitlist" used inconsistently for the same thing | Design-consistency improvement | grep across `site/*.html` | Standardized to "waitlist" everywhere | **Fixed** | New sitewide test: no file contains "interest list" |
| 6 | Mock Oral / Private Instruction hero subhead | `font-family: Georgia` instead of the brand's `Playfair Display` heading face | Design-consistency improvement | Visual audit vs. design system | One-line CSS fix on each page | **Fixed** | Visual gallery (before/after) |
| 7 | `flight-training-bastrop.html`, `flight-training-dripping-springs.html` | Unhedged "a 35-minute drive" claim this site can't actually guarantee | Subjective content correction | Fork 5 content review | Hedged to "about"/"roughly" | **Fixed** | Visual gallery |
| 8 | 3 blog posts | Missing internal links to related product pages that every other post has | Design-consistency improvement | Pattern comparison across all 9 posts | Added matching closing-paragraph links | **Fixed** | Manual link-destination check |
| 9 | `blog-private-pilot-checkride-readiness.html` hero image | 2000×1333/128KB, `loading="lazy"` despite being the LCP element (baseline 4.9s) | Confirmed defect (performance) | Baseline Lighthouse measurement | Resized to 1440×960/51KB (−60%), `fetchpriority="high"`, dropped lazy-load | **Fixed** | Image-integrity Playwright check (0 broken images); fresh Lighthouse re-measurement recommended post-merge (see §7) |
| 10 | `fleet.html`, 3 images | Missing explicit `width`/`height` → layout shift risk | Confirmed defect (CLS) | Manual audit | Added explicit dimensions matching rendered size | **Fixed** | Visual gallery |
| 11 | `index.html` Services section | "Flight Training" card re-listed the exact same 3 certificates the Flight Training Paths grid above it already covers; both sections pitch the same March 2027 plan | Design-consistency improvement (conversion hierarchy) | Fork 1 content audit, independently confirmed by reading both sections | Removed the duplicate card; retitled/re-copy'd the section to "Two more ways to train"; kept one primary + one secondary CTA | **Fixed** | New regression test (no duplicate `<h3>Flight Training</h3>`, grid still covers all 3 certificates once, CTA count unchanged); visual gallery |
| 12 | `apex-advantage.html`, `readiness-assessment.html`, 2 giveaway pages | Also missing `<main>`/skip-link (found while writing the regression test, not in the original 68-file sweep) | Confirmed defect (a11y) | Mechanical re-scan after implementation | Same fix applied; giveaway page's standalone CSS got its own `.skip-link` rule since it doesn't load `styles.css` | **Fixed** | Same regression test as #1 |
| 13 | Homepage instrument-hours claim | "All 40 required instrument hours flown for real... in actual IMC and VMC conditions" overstates what 14 CFR §61.65 actually requires | **Deferred — owner/instructor review required** | Regulatory citation check (§61.65(d)/(i)/(j); AOPA reporting on the April 2016 final rule, 81 FR 21449) | Suggested wording prepared, not published — see §3 | **Not implemented** | N/A until approved |
| 14 | ~20 pages | Flagged color-contrast concern from Fork 3's a11y sweep | Deferred — needs a dedicated contrast-ratio measurement pass (WCAG AA/AAA per element), not a blind CSS edit | Fork 3 finding, not independently re-measured this pass | — | **Flagged, not fixed** | N/A |
| 15 | `portal.html` | 21-heading SPA shell structure flagged by Fork 3 | Deferred — this is a React-rendered app shell; any heading-hierarchy fix belongs in the component code, not static HTML, and needs its own scoped pass | Fork 3 finding | — | **Flagged, not fixed** | N/A |
| 16 | `apex-advantage-private-instruction.html` | Open PR #340 (GA4 event-dedup fix) touches this same page | Reconciled during PR #346 final-integration prep | PR #340's `get_files` diff fetched and compared byte-for-byte | Applied PR #340's exact fix (`if`→`else if` on both CTA listener paths, same comment) directly in this branch, so the dedup fix lands regardless of merge order | **Fixed (incorporated)** | New Playwright smoke-test assertion confirms both listener paths carry the fix; `git diff` matches PR #340's patch exactly |
| 19 | `site/assets/images/mock-oral/andrew-hero.jpg`, `andrew-instructor.jpg` | These two shared images were modified in the PR but not called out in this report's original Executive Summary/Issue Register | Reporting gap, caught during PR #346 final-integration review | `git log`/`git diff origin/main` confirms both changes are part of this sprint's own commit, not a stray/unrelated edit; direct visual diff against the `main` versions confirms identical photo content (same crop, same subject, no AI alteration) | Documented properly here as Executive Summary item #12: intentional performance optimization (−67%/−56% file size), resize targets chosen to exactly preserve the aspect ratio of every referencing page's existing `width`/`height` attributes so no markup changed | **Fixed (now properly documented)** | Aspect-ratio regression test (`websiteQualityConversionV12Regression.test.js`), visual diff against `main`, image-integrity Playwright check (0 broken images) |
| 17 | Blog `h2→h4` heading pattern | Fork 3 initially flagged this as a blog-template bug | **Investigated and downgraded** — this is the universal sitewide footer heading pattern ("Training"/"Company"/"Contact"), present identically on every page type, not something the blog template introduced | Checked `index.html`'s own footer, found the identical pattern | Not worth a sitewide footer-heading-level rewrite for a low-real-impact, debatable WCAG technique (footer is still navigable by landmark role) | **Investigated, not fixed** | N/A |
| 18 | "Stat-badge" element on city pages | Fork 5 described a distinct widget showing unhedged driving-time figures | **Could not corroborate** — searched Bastrop/Marble Falls/New Braunfels for any such class/pattern; found none. The real, fixable instances were plain body copy (see #7), which were fixed instead | Targeted grep across city pages | Did not fabricate a fix for an unverified claim | **Investigated, not found as described** | N/A |

---

## 3. Aviation Regulatory Claim Review (Owner/Instructor Review Required)

**Current homepage copy** (Instrument Rating card):
> "All 40 required instrument hours flown for real — approaches, holds, partial panel, and IFR cross-country in actual IMC and VMC conditions, with an instructor who's lived through both."

**Issue:** 14 CFR §61.65 does not require all 40 hours of instrument time to be flown in an actual aircraft. The regulation (as amended by the FAA's April 2016 final rule, 81 FR 21449, reported by AOPA) permits a combination of actual and simulated instrument time — including authorized ATD/BATD/FTD time under §61.65(i)/(j) — to count toward much of that 40-hour total, subject to caps and a minimum floor of real flight-training hours under §61.65(d). Stating the 40 hours are "required" to be "flown for real" asserts a regulatory requirement that doesn't match the current rule text.

**What this page is likely actually trying to say** (a legitimate, differentiating marketing claim Apex can make honestly): *Apex's own program chooses not to substitute simulator time for real aircraft time, as a training-quality decision* — which is a defensible position, just not a regulatory one.

**Suggested wording for instructor/owner review** (not published):
> "Every instrument hour in our program is flown in the real aircraft — approaches, holds, partial panel, and IFR cross-country in actual IMC and VMC conditions — because we believe real weather and a real yoke build sharper instrument pilots than simulator substitutions, even where the regs would allow them."

This reframes the claim as Apex's training philosophy (verifiably true once the Austin aircraft is flying) rather than a mischaracterization of §61.65's actual minimums. **This wording is a recommendation only — it has not been published, per the brief's instruction not to rewrite FAA regulatory requirements from memory or publish aviation-specific wording changes without instructor review.**

---

## 4. Content Report

- **Terminology:** "interest list" → "waitlist" standardized across 20 files (full list in the Issue Register's git diff).
- **Internal linking:** 3 blog posts brought up to the same internal-linking standard as the other 6.
- **Hedging:** 2 city pages' unhedged driving-time claims softened.
- **Not touched, flagged for a future pass:** the broader blog/city-page thin-content and consolidation review from Fork 5 did not surface duplication severe enough to recommend consolidation this pass (per the brief's instruction to recommend consolidation only when duplication is demonstrated — it wasn't, beyond the one stat-badge claim that couldn't be corroborated).

## 5. Design-System Changes

- 2 hero-subhead typography corrections (Georgia → Playfair Display), matching the approved type system. No new colors, gradients, shadows, or fonts were introduced anywhere in this pass — the full diff was checked for this.
- Homepage Services section grid changed from 3 columns to 2 (CSS already had a 2-column tablet breakpoint at `styles.css:873`, so this didn't require any new responsive rule).

## 6. Accessibility Remediation Report

- **70 pages** now have a working skip link + unique `<main id="main-content">` landmark (68 from the original sweep, 2 giveaway pages caught while writing the regression test).
- **12 FAQ accordion items** on `checkride-prep.html` now expose `aria-expanded`/`aria-controls` state.
- **Flagged, not fixed this pass:** sitewide color-contrast measurement (needs a dedicated per-element pass, not a blind CSS change) and `portal.html`'s SPA heading structure (owned by React component code).
- **Investigated and intentionally left alone:** the blog's `h2→h4` pattern, which is the universal sitewide footer structure, not a blog-specific defect.

## 7. Performance: Before/After

| Metric | Baseline (re-established this pass) | Fix applied | Expected effect |
|---|---|---|---|
| Readiness-article hero image | 128KB, lazy-loaded, LCP 4.9s | Resized to 51KB (−60%), `fetchpriority="high"` | Should materially reduce LCP; **re-measure with Lighthouse post-merge to confirm the actual number** — not re-measured in this pass since the page isn't live yet |
| `fleet.html` layout shift | 3 images missing explicit dimensions | Added `width`/`height` to all 3 | Removes a CLS source |
| Checkride Prep TBT (~1.4s baseline) | — | **Not addressed this pass** — no code-level cause was isolated with enough confidence to change safely within this sprint's scope; flagged for a dedicated profiling pass |
| Homepage/Checkride Prep LCP/CLS (1.7s / 2.62s / 0.0004 baseline) | — | No regression expected (no changes to above-the-fold render path on either page besides the Services-section edit, which is below the fold) | To be confirmed with a fresh Lighthouse run after merge |

## 8. Conversion-Tracking Review

- Meta Pixel now initializes identically across all 3 live paid-product pages (Mock Oral, Private Instruction, Checkride Prep) — confirmed via source inspection and the new regression test. **Not independently confirmed:** actual delivery to the Meta Events Manager dashboard — a source-code `fbq()` call proves the client attempted to fire the event, not that Meta received and attributed it. That requires either Events Manager access or a live network capture against the production domain, neither of which this pass had cause to do (no production changes were made).
- GA4 event definitions were not modified anywhere in this pass.
- The 14-day baseline event counts referenced in the brief are **event counts, not distinct users or a funnel** — no cohort conversion rate was calculated from them, and no zero-event period was read as proof of a broken tracker, per the brief's explicit instruction.
- **PR #340** (open, GA4 event-dedup fix on `apex-advantage-private-instruction.html`) was initially left untouched in the first review pass to avoid a merge conflict with this sprint's typography fix on the same file. During PR #346's final-integration prep, its exact fix was applied directly in this branch (confirmed byte-for-byte against #340's diff), so the dedup fix is now present regardless of merge order. **Recommendation: once PR #346 merges, close #340 as superseded** — its complete fix is already in `main` via #346.

## 9. Visual Gallery

Published: **https://claude.ai/artifact/VwSSqnpLQKVdkjJzbPc82A**

10 pages × desktop (1440×900) + mobile (390×844), fold + full-page, plus a 6-breakpoint sweep (320/375/390/768/1024/1440px) on the homepage and Checkride Prep — 104 screenshots total, captured with the same Chromium build/viewport/DPR for before and after. Every entry is labeled: confirmed-defect-corrected, accessibility fix, performance fix, design-consistency improvement, or subjective/content proposal.

## 10. Test Results

- **1,789 tests passing** (1,519 pre-existing + 270 new in `websiteQualityConversionV12Regression.test.js`), 0 failing.
- **Lint:** clean except pre-existing warnings unrelated to this sprint (unused vars, a couple of unicorn style rules) — unchanged from baseline.
- **Build:** succeeds.
- **New tests cover:** main-landmark/skip-link presence (84 pages), Meta Pixel parity (3 pages), FAQ `aria-expanded`/`aria-controls` wiring (12 items), pricing CTA destination validity, sitewide waitlist-terminology regression, homepage Services-section non-duplication, and resized shared-image aspect-ratio integrity (prevents a future asset swap from silently reintroducing layout shift).
- **Playwright image-integrity check:** 0 broken images across the 5 pages touched by the image-resize work.
- **Regression spot-check:** no registration/login/booking/checkout/assessment/portal-link/mobile-nav code was touched this pass (all changes were to `site/*.html` plus one new test file) — the full 1,519-test pre-existing suite covering those flows passes unchanged, which is the strongest available evidence of no regression without a live-environment run.

## 11. Remaining Risks / Not Done This Pass

1. **Regulatory wording** (§3) — needs instructor sign-off before any publish.
2. **Sitewide color-contrast measurement** — flagged by Fork 3, not independently re-measured; needs a dedicated per-element WCAG pass.
3. **`portal.html` heading structure** — flagged, needs a scoped React-component-level fix, not a static-HTML patch.
4. **Checkride Prep TBT (~1.4s)** — no safe, confident fix identified this pass; needs dedicated profiling.
5. **Meta Pixel delivery confirmation** — source code is correct; actual Events Manager delivery is unverified.
6. ~~**PR #340**~~ — **Resolved as of PR #346's final-integration pass:** its exact dedup fix is now incorporated directly in this branch (see Issue Register #16). Close #340 as superseded once #346 merges.
7. **Fresh Lighthouse re-measurement** — the readiness-article LCP improvement is only inferred from the image-size reduction, not re-measured, since nothing is live.

## 12. Integration Plan

1. ~~Owner/instructor reviews §3's regulatory wording recommendation~~ — **done:** owner-approved copy applied (PR #346).
2. ~~Owner reviews the visual gallery and this issue register~~ — **done:** PR #346 opened, reviewed, and is now in final-integration cleanup.
3. ~~Once approved: commit, push, open a PR~~ — **done:** PR #346, commit `176334678ff038cb932cac648a452a79d14261d5` (superseded by the final-integration commit once final checks land).
4. After merge: re-run the post-merge production verification pattern established for PR #345 (deploy confirmation, live smoke tests, fresh Lighthouse, analytics coverage check) — this is the only way to confirm the performance and Meta Pixel items above with real numbers.
5. Close PR #340 as superseded once #346 merges (its fix is already incorporated — see Issue Register #16). Separately schedule the color-contrast and portal.html heading follow-ups, and decide on the Checkride Prep TBT investigation.

---
*No commits, pushes, merges, or deploys were made as part of this review package, per the brief's Section 17.*
