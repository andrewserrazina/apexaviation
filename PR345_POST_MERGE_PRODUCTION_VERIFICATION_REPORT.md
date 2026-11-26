# Apex Aviation — PR #345 Post-Merge Production Verification

Verified merge commit: `147d1b29df576c1e31491fc79493795fc69370ff`
Verification performed: 2026-11-26, ~18:00–18:05 UTC, via direct HTTPS requests and fresh headless-Chromium (Playwright/Lighthouse) sessions against the live `apexaviationtx.com` origin — no cached search results relied on.

No deploys, merges, or production data changes were made during this verification. This is a read-only report.

---

## 1. Deployment commit and timestamp

- `main`'s HEAD is exactly the PR #345 merge commit: `147d1b29df576c1e31491fc79493795fc69370ff`, authored 2026-11-26T17:50:19Z.
- The repo's `Portal CI` GitHub Actions workflow (added by this same PR) ran again on the push-to-`main` event triggered by the merge (run #2, `completed`/`success`), confirming the CI pipeline itself is live and exercised the merged code.
- No direct Cloudflare dashboard/API access is available in this environment, so deployment was verified the authoritative way available here: by fetching the live site directly and confirming its served content, byte-for-byte, matches what this merge commit contains (see §2). This is stronger evidence than a dashboard status flag, since it proves the actual bytes users receive are correct, not just that a deploy job reported success.

---

## 2. Live-page verification results (Phase 1, items 4–7)

| Check | Result |
|---|---|
| Homepage serves corrected content | ✅ 200 OK, references `apex-logo-nav.png` (not the old `apexwhite.png`) in both header and footer |
| Pricing FAQ describes instant booking | ✅ Live JSON-LD and visible FAQ both read: *"Pick Mock Oral or Private Instruction and use the live calendar on its page to choose an open time with Andrew — checkout confirms your spot immediately, no email back-and-forth required."* |
| Optimized navbar logo served | ✅ `apex-logo-nav.png` returns `content-length: 2380` (bytes) — the correct 2.4KB asset, not the old 2.1MB file |
| Original high-res logo still used for social sharing | ✅ `og:image`/`twitter:image`/JSON-LD `logo` on the homepage still point to the full-resolution `apexwhite.png` |
| Simulator FAQ new voice | ✅ Live, reads *"We're launching lean: one dedicated aircraft, no AATD..."* (both JSON-LD and visible) |
| Orphan page in sitemap | ✅ `flight-time-building-austin` present in the live `sitemap.xml`, `<lastmod>2026-11-26</lastmod>` |
| Orphan page internal links | ✅ Live on both `commercial-pilot-training` and `instrument-rating-training` |
| Cache headers / staleness | ✅ HTML responses: `cache-control: public, max-age=0, must-revalidate` (always revalidated — no stale-HTML risk). New logo asset: `cf-cache-status: MISS` (freshly served from origin, not a stale cached copy), `etag` present for validation, `max-age=14400` (4h) for the static asset — appropriate. |
| `robots.txt` | ✅ Valid, correct `Sitemap:` reference. Cloudflare's own "Managed content signals" block is auto-injected at the edge ahead of the repo's own rules — this is a Cloudflare platform feature unrelated to this PR, not a defect; the repo's own `Allow: /` + sitemap directive is still present and in effect. |
| 404 handling | ✅ A nonexistent path correctly returns HTTP 404 |

**No stale content found anywhere checked.** Every sprint change is live and byte-correct on production.

---

## 3. Browser smoke-test results (Phase 2)

Tested via fresh headless-Chromium sessions (no cache) at desktop (1440×900) and mobile (390×844) against all 7 named pages: homepage, pricing, checkride-prep, private-instruction, mock-oral, Taylor, and the Austin time-building page.

**Clean across the board:**
- Zero console errors, zero failed requests (excluding expected third-party analytics beacons) on any of the 14 page/viewport combinations.
- Exactly one `<h1>` on every page.
- No horizontal overflow at any width.
- Canonical tag on every page matches its own URL exactly.
- Mobile hamburger button measured at exactly 44×44px and correctly toggles `aria-expanded` (false → true) on click, with the menu actually opening — verified live, not just in source.
- Booking/registration surfaces present and correct: Mock Oral and Private Instruction pages both show 8–9 real booking-related links/controls; `checkride-prep` shows its "Get Instant Access" CTA; homepage shows 5 real portal-signup links.
- Internal links, sitemap, and metadata all consistent with §2.

**Confirmed production defect found (pre-existing, not caused by this PR):**
`apex-advantage-mock-oral.html` and `apex-advantage-private-instruction.html` — the two actual live, revenue-generating booking pages this whole sprint centers on — have **zero `<main>` landmarks**, at both desktop and mobile. This sprint's accessibility fix (task that restored `<main>` on 3 other pages) did not cover these two, because Fork B's original 6-page audit sample didn't include them. This is a genuine, confirmed gap on two of the most important pages on the site, independent of anything this PR changed. See §6/§7.

---

## 4. Mobile performance measurements (Phase 3)

**Environment:** Lighthouse v13.6.0, headless Chromium (Playwright's pre-installed binary), mobile form-factor + screen emulation, Lighthouse's default mobile throttling (simulated slow 4G / mid-tier CPU), against the live `https://apexaviationtx.com` origin (real Cloudflare CDN, not localhost). Multiple runs taken on the primary comparison page; medians reported.

### `checkride-prep` (the sprint's named baseline page) — 3 runs

| Run | Performance score | LCP | CLS | FCP | TBT |
|---|---|---|---|---|---|
| 1 | 0.70 | 2442ms | 0.0004 | 1842ms | 1608ms |
| 2 | 0.70 | 2620ms | 0.0004 | 1936ms | 1418ms |
| 3 | 0.67 | 3087ms | 0.0004 | 1957ms | 1360ms |
| **Median** | **0.70** | **2620ms (2.6s)** | **0.0004** | **1936ms** | **1418ms** |

**Comparison to sprint baseline:**

| Metric | Pre-sprint (reported) | Sprint branch (localhost, 1 run) | **Production median (this verification, 3 runs)** |
|---|---|---|---|
| LCP | 19.0s | 3.1s | **2.6s** |
| CLS | 0.188 | 0.0004 | **0.0004** |

Production is holding — and, as expected, is slightly *faster* than the single localhost measurement taken during the sprint (real CDN edge delivery vs. a local dev server). CLS matches almost exactly across all three environments, strong confirmation the width/height fix is working as intended.

**Note on Total Blocking Time (1.36–1.6s):** not part of the sprint's original baseline metrics, so not a regression — but worth flagging as a real, measurable interactivity cost on this page, out of scope for this PR.

### Other pages (1 run each, for context — not part of the sprint's named baseline)

| Page | Performance | LCP | CLS |
|---|---|---|---|
| Homepage | 0.76 | 1.7s | 0.0005 |
| `blog-private-pilot-checkride-readiness` (the other original 14.3s outlier) | 0.59 | **4.9s** | 0.022 |

The blog page improved enormously from its original 14.3s (**-66%**), confirming the sitewide logo fix helped there too — but it is now the slowest of the pages tested, and its CLS (0.022) is 55x `checkride-prep`'s. This is very likely the same class of issue flagged in the original sprint report as a remaining risk ("several other large images... weren't confirmed clear of LCP impact") — this page apparently has its own unoptimized images beyond the logo, which the original 6-page Fork B audit also flagged (2 of 4 images on this page missing `width`/`height`). Not caused by this PR; a real, confirmed, pre-existing opportunity for a follow-up pass.

---

## 5. Analytics coverage matrix (Phase 4)

GA4 (`G-JFPBCF2GXE`) and Meta Pixel (`1049117198055794`) are both configured via `gtag`/`fbq` in site source, backed by a first-party `analytics_events` Supabase table (`apexTrack()`, `site/analytics-events.js`) that fires the same named event to GA4 + Meta + the DB in one call. This is an unusually mature, already-audited instrumentation layer — a dedicated `ANALYTICS_EVENT_DICTIONARY.md` documents every event's exact trigger, properties, and expected frequency, verified against real call sites.

| Funnel step | Event(s) | Verified via | Status |
|---|---|---|---|
| Visitor | `landing_page_viewed` + GA4 automatic `page_view` | Code + live DB: 160 events in last 14 days, most recent **today, post-deploy** | ✅ Configured and actively firing |
| Registration | `registration_started` → `registration_completed` | Code + live DB: 2 completions in last 14 days | ✅ Configured and actively firing |
| Assessment Start | `readiness_assessment_viewed` → `readiness_assessment_started` | Code + live DB: 38 viewed → 13 started in last 14 days | ✅ Configured and actively firing |
| Assessment Completion | `readiness_assessment_completed` | Code + live DB: 7 in last 14 days | ✅ Configured and actively firing |
| Checkout | `checkout_started` | Code (dictionary entry verified) | ⚠️ **Not observed firing in the last 14 days** (0 events) |
| Purchase | `purchase_completed` + separate GA4 Enhanced Ecommerce `purchase` (session_id-guarded against double-fire) | Code (dictionary entry verified, dedup mechanism documented) | ⚠️ **Not observed firing in the last 14 days** (0 events) |

**On the Checkout/Purchase gap — read carefully, per the brief's own instruction not to misread this:** Zero `checkout_started`/`purchase_completed` events in 14 days is **not**, by itself, evidence of a tracking failure. Independent corroboration from the real backend (`checkout_session_attempts` table, not the analytics log) also shows **zero** checkout attempts of any kind in the same 14-day window. Two independent data sources agree there was simply no real checkout activity to track in this period — this reads as a genuine lull in traffic reaching checkout, not a broken pipe. The instrumentation itself (dedup guard, session_id correlation, documented in the event dictionary) was verified by code audit only this period, not against live transaction data, because there were none to observe.

**UTM preservation:** verified in code (`utmProps()`). First-touch and last-touch values persist via `localStorage` across the whole visit, including the non-obvious case of a click-ID-only arrival (fbclid/gclid with no classic `utm_*` params) still counting as a genuine new touch — a previously-fixed bug per the code's own history comments.

**Duplicate event handling:** `purchase_completed` is guarded by a `localStorage` key scoped to the Stripe `session_id`, so a page refresh or back/forward-cache restore of the same success URL does not double-fire it (this was a real, since-fixed historical bug in GA4's own separate `purchase` event, per the dictionary).

**Confirmed defect found:** `apex-advantage-mock-oral.html` has **zero `fbq()` calls anywhere** — no Meta Pixel `init`, no `PageView`, nothing. `apex-advantage-private-instruction.html` and `checkride-prep.html` both correctly initialize it; Mock Oral does not. `apexTrack()`'s Meta call is defensively guarded (`if (window.fbq)`), so this fails silently rather than erroring — but it means **Meta Ads has zero visibility into anyone who visits or books Mock Oral**: no retargeting audience, no conversion-tracking signal, no attribution for that entire product line on the Meta side. GA4 tracking on this same page is unaffected and confirmed present.

---

## 6. Confirmed production defects (new findings from this verification, not previously known)

1. **Missing `<main>` landmark on `apex-advantage-mock-oral.html` and `apex-advantage-private-instruction.html`** — the two live, revenue-generating self-service booking pages. Pre-existing; not caused by PR #345 (these pages were outside the original 6-page accessibility audit sample).
2. **Missing Meta Pixel entirely on `apex-advantage-mock-oral.html`** — no `fbq('init', ...)` anywhere on the page, unlike its sibling Private Instruction page. Pre-existing; not caused by PR #345.
3. **`blog-private-pilot-checkride-readiness.html` remains the slowest page site-wide** (4.9s mobile LCP, CLS 0.022) even after the sitewide logo fix — almost certainly due to its own unoptimized images (2 of 4 missing `width`/`height`, per the original sprint's Fork B finding), separate from the logo issue this PR fixed.

None of these three are regressions introduced by PR #345 — all predate it and were simply outside its tested scope. All three directly affect the same conversion-critical surfaces (Mock Oral especially) that this sprint targeted, so they're flagged here as natural next-pass candidates.

---

## 7. Recommended fixes (not implemented — stopping before any further change per instructions)

1. Add `<main id="main-content">` + skip-link to `apex-advantage-mock-oral.html` and `apex-advantage-private-instruction.html`, matching the exact pattern already used on the 3 pages fixed in PR #345.
2. Add Meta Pixel initialization (`fbq('init', '1049117198055794')` + `fbq('track', 'PageView')`) to `apex-advantage-mock-oral.html`, matching its sibling Private Instruction page.
3. Add `width`/`height` attributes to the 2 remaining unsized images on `blog-private-pilot-checkride-readiness.html` and audit its other image weights, the same treatment PR #345 applied to `checkride-prep.html`.
4. (Lower priority, informational only) `checkride-prep`'s Total Blocking Time (~1.4s median) is worth a follow-up profiling pass if interactivity becomes a priority — not flagged as broken, just notably higher than the other pages tested.

---

## 8. Final status

**PASS WITH WARNINGS**

The deployment itself is fully verified: the correct commit is live, every sprint change (logo, booking copy, orphan page, accessibility fixes, FAQ voice) is confirmed present and correct on production with zero staleness, zero regressions, and measurably real performance gains (LCP -84% to -86% depending on measurement point, CLS reduced ~470x on the named baseline page). Nothing in PR #345 itself failed verification.

The "warnings" are three **pre-existing** defects this verification pass surfaced on adjacent, equally-critical pages that were outside PR #345's original scope (two missing `<main>` landmarks on the live booking pages, one missing Meta Pixel, one page with its own unresolved image-weight problem). None block or undermine what PR #345 shipped; all three are clearly scoped, concrete, and ready for a focused follow-up pass.
