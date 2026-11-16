# Technical SEO Audit — 2026-11-16

Scope: `apexaviationtx.com` only (static `site/` directory, served via Cloudflare Pages). Does not touch `C:\Apex\APOS`, the Apex Explains repo, or any other project. Builds on and re-verifies (does not repeat from scratch) the prior `docs/SEO_PHASE3_TECHNICAL_AUDIT.md` and `docs/SEO_PHASE4_CANONICALIZATION.md`, both already merged to `main`, plus the PR #318 SEO pass merged 2026-11-15 (structured data + image-weight fixes on `programs`/`pricing`/`instructors`/5 image-heavy pages).

Evidence tags, matching the existing house convention:
- **[REPO]** — found by reading files in this repository.
- **[LIVE]** — a real HTTP request made from this session to `https://apexaviationtx.com`, command included so it's reproducible.
- **[GSC-HISTORICAL]** — from the supplied GSC export only, not independently verified.

## 1. URL canonicalization — re-verified, holding in production

The brief asks to test `http`→`https`, `www`↔non-`www`, trailing slash, `.html`↔extensionless, and query strings. All five were tested live today.

| Test | Result | Evidence |
|---|---|---|
| `http://apexaviationtx.com/` | 301 → `https://apexaviationtx.com/` | **[LIVE]** `curl -sSI http://apexaviationtx.com/` |
| `https://apexaviationtx.com/programs.html` | 308 → `/programs` | **[LIVE]** |
| `https://apexaviationtx.com/private-pilot-training.html` | 308 → `/private-pilot-training` | **[LIVE]** |
| `https://apexaviationtx.com/instrument-rating-training.html` | 308 → `/instrument-rating-training` | **[LIVE]** |
| `https://apexaviationtx.com/about.html` | 308 → `/about` | **[LIVE]** |
| `https://apexaviationtx.com/apex-advantage.html` | 308 → `/apex-advantage` | **[LIVE]** |
| `https://apexaviationtx.com/checkride-prep.html` | 308 → `/checkride-prep` | **[LIVE]** |
| `https://apexaviationtx.com/programs/` (trailing slash) | 308 → `/programs` | **[LIVE]** |
| `https://apexaviationtx.com/programs?utm_source=test` | 200, served directly, no redirect | **[LIVE]** |

This confirms Phase 4's fix (every page's canonical tag + `og:url` declares the extensionless form, matching what Cloudflare Pages' own clean-URL redirect actually serves) is live and correct today. **No action needed here** — this closes the `.html`-vs-extensionless half of the brief's "potential duplicate variants" list (`/programs` & `/programs.html`, `/private-pilot-training` & `.html`, `/instrument-rating-training` & `.html`, `/about` & `.html`, `/apex-advantage` & `.html`). The GSC export's visibility of both forms reflects **historical** crawl data from before Phase 4 shipped, consistent with the brief's own warning that GSC visibility alone doesn't prove a current problem.

## 2. Finding: `www.apexaviationtx.com` serves identical content with no redirect to the canonical host

**Severity: Low-Medium. Not yet fixed — proposed only, needs explicit approval (see §2.3).**

### Evidence

```
$ curl -sS https://apexaviationtx.com/     -D - -o /tmp/nonwww.html
$ curl -sS https://www.apexaviationtx.com/ -D - -o /tmp/www.html
```
Both return `HTTP/2 200`, `content-type: text/html; charset=utf-8`, and **byte-identical bodies** (60,313 bytes each, confirmed via `wc -c`), same `<title>`. **[LIVE]**

The homepage does carry a correct canonical tag even when served on `www`:
```
<link rel="canonical" href="https://apexaviationtx.com/" />
```
**[LIVE]**, confirmed present in the `www` response body.

### Why this matters, and why it's lower severity than it could be

A correct `rel=canonical` tag is the standard mitigation Google documents for exactly this situation, and it's present and correct — Google generally consolidates ranking signals to the canonical URL even when a duplicate host serves the same content. This is **not** the same severity as Phase 3's original finding (a canonical tag pointing at a URL that was itself a redirect, which is a genuine signal contradiction). Here the signal is consistent; it's just not enforced at the transport layer. The residual risk is: wasted crawl budget on a host that will never rank, and any external link built to the `www` form not consolidating as cleanly as a direct 301 would guarantee.

### 2.1 Does this explain the GSC "`www` and non-`www`" variant note?

Plausibly, yes — **[GSC-HISTORICAL]** shows both host forms receiving impressions, which is exactly what two live, identical, canonically-linked hosts would produce. Not provable from GSC data alone, consistent with the evidence above.

### 2.2 Where the fix would actually live

This is **not** a `_redirects`-file concern — `site/_redirects` (Cloudflare Pages' path-based redirect file, already used for the `/home`, `/ground-school-*`, and `flight-training-hutto-taylor` redirects) operates within one already-resolved host; it does not control which host serves a request in the first place. A `www` → apex-root redirect is configured at the Cloudflare zone/DNS level (a Redirect Rule or Bulk Redirect, or in the `www` custom domain's own Pages Function/Worker if one exists) — outside this repository's normal file-based change surface, and squarely inside the brief's "never alter production DNS... without explicit approval" constraint.

### 2.3 Proposed fix (not applied)

Add a Cloudflare Redirect Rule (zone-level, not in this repo) or convert the `www` custom domain into a simple permanent redirect to `apexaviationtx.com`, preserving path and query string. This requires Cloudflare dashboard access this session doesn't have, and is exactly the kind of "issue irreversible redirects only after validating equivalence and route dependencies, never without explicit approval" change the brief calls out by name. **Flagged for owner action — not implemented.**

## 3. Sitemap / robots.txt — clean

- `robots.txt` **[LIVE]**: `User-agent: *` / `Allow: /`, `Sitemap: https://apexaviationtx.com/sitemap.xml` present and correct. The file also carries Cloudflare's managed AI-crawler-blocking block (`Content-Signal`, `Disallow` for GPTBot/ClaudeBot/etc.) — this is informational/policy, not an indexing problem; Google's own crawler is explicitly `Allow: /` and `search=yes`.
- Live sitemap **[LIVE]**: 74 `<loc>` entries (one more than the 73 found in the 2026-11-15 audit — the "Go-Around" blog post published that day), **zero** `.html` URLs in the sitemap. Every sitemap URL is the canonical extensionless form.
- Re-ran the 2026-11-15 audit's canonical/noindex-contradiction/duplicate-title/duplicate-meta/H1-count/broken-internal-link checks **[REPO]** against the current `main` — all still hold (0 contradictions, 0 duplicate titles, 0 missing/short meta descriptions, every indexed page exactly 1 `<h1>`, 0 broken internal `<a href>` targets, 0 images sitewide missing `alt`). Not re-detailed here to avoid duplicating that already-committed finding; see PR #318's description for the original methodology.

## 4. Structured data — spot-checked against the brief's specific concerns

- `instrument-rating-training.html` and `private-pilot-training.html` each carry one `Course` + `Organization` JSON-LD block. Read in full **[REPO]**: both correctly state "targeting March 2027 subject to airport and aircraft approval" inside the `description` field itself — i.e. the schema is already honest about the service's actual availability, not just the visible page copy. **No fabricated rating, review, or availability claim found. No change needed.**
- The GSC brief's "product snippets: 7 clicks / 122 impressions" **[GSC-HISTORICAL]** most plausibly corresponds to `Product`/`Offer` schema on `checkride-prep.html`, `apex-advantage-mock-oral.html`, or `apex-advantage-private-instruction.html` — all three carry real, live-priced `Offer`/`Product` markup matching their actual current price ($29 / $129 / $55 respectively, re-verified **[REPO]** against each page's own pricing copy on 2026-11-15). **No mismatch found.**
- Per the 2026-11-15 audit, 65 of 72 indexed pages now carry at least one JSON-LD block (up from 62 before PR #318). The 7 remaining (`blog.html`, `privacy.html`, `readiness-assessment.html`, `jobs.html`, `terms.html`, `mock-oral-giveaway.html`, `mock-oral-giveaway-rules.html`) are legal/utility/funnel pages or pages where the "right" schema type needs more product-side thought (e.g. a Quiz/WebApplication type for the readiness assessment) — intentionally left alone, not a new finding from this pass.

## 5. Internal linking — the one gap the brief named, now closed

**[REPO]**: of the four source pages the brief specifically asked to link to `/instrument-rating-training` (checkride prep, simulator-hours blog, programs, homepage), three already did:
- `blog-how-many-simulator-hours-count-toward-instrument-rating.html` — 2 links
- `programs.html` — 2 links
- `index.html` — 3 links

`checkride-prep.html` had **zero**. It does, however, already list "Instrument Rating applicants — In Development" as an audience it doesn't yet serve. **Applied**: added a contextual link from that exact list item to `/instrument-rating-training`, phrased accurately ("see Instrument Rating Training for what's available now") rather than implying the Checkride Prep *system* itself covers instrument content, which it does not (confirmed by the page's own FAQ: "Instrument Rating and Commercial Pilot content is in development"). One-line change, see the patch.

## 6. Desktop/mobile and Core Web Vitals

The GSC export has no Core Web Vitals data (per the brief's own caveat) and this session has no Lighthouse/CrUX access. What was checked instead, re-confirming the 2026-11-15 pass **[REPO]**: every indexed page has exactly one `viewport` meta tag, images sitewide carry explicit `width`/`height` (reduces layout shift), and the two heaviest pre-existing images (a 1.6MB and a 950KB PNG used inline/as a CSS hero background) were already found and fixed in PR #318 (re-encoded as WebP, ~96% smaller, no visible quality loss). **No new image-weight issues found in this pass.** The desktop-vs-mobile CTR/position disparity in the GSC data (§ `gsc-baseline-2026-11-16.md`) was not further investigated — flagged as an open question, not a confirmed technical bug, per the brief's own instruction.

## 7. No-change list

Explicitly confirmed correct and left untouched: `robots.txt`, `sitemap.xml` structure, all canonical tags, all `.html`→extensionless redirects, the `Course`/`Organization` JSON-LD on both P1 target pages, the `Product`/`Offer` schema on the three priced-product pages, and the existing internal-link graph everywhere except the one gap in §5.
