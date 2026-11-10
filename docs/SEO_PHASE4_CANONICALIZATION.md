# SEO Phase 4 — Extensionless Canonical URL Migration

This phase implements the long-term URL standard decided after Phase 3:
**extensionless URLs are canonical** (`https://apexaviationtx.com/flight-training-taylor`,
not `.../flight-training-taylor.html`). Legacy `.html` URLs keep working —
Cloudflare Pages' own clean-URL behavior 308-redirects them to the
extensionless form — but every indexable page, every internal link, and
the sitemap now consistently *declare* the extensionless form, instead of
contradicting what the platform actually serves.

This is a separate PR from Phase 3 (PR #291), on its own branch
(`seo/phase4-canonical-urls-2026-11`, branched from the tip of Phase 3's
branch to avoid re-doing or conflicting with its already-validated redirect
fixes), and is **not merged or deployed automatically**.

## 1. Scope

**In scope**: the 71 public (non-noindex) pages — canonical `<link>`, `og:url`,
self/cross-referencing JSON-LD `url` fields, the shared person `@id`
(`about.html#andrew-serrazina` → `about#andrew-serrazina`, kept consistent
across every page that references it), every internal `href` sitewide that
targets one of those 71 pages, and `sitemap.xml`.

**Out of scope, deliberately**: the 15 noindex/app pages (`portal*`,
`portal-login.html` + its query-string routing, `mobile-auth-redirect.html`,
`email-preferences.html`, `404.html`, the giveaway-funnel download/landing
pages, etc.). They are not part of the indexable SEO surface, several of
them route entirely by query string (`portal-login.html?view=signup&dest=...`),
and touching that routing was never asked for and isn't a canonical-URL
concern. Their own canonical tags (where present) are untouched. The shared
`Organization` JSON-LD node (`@id: ".../#organization"`) has no `.html` in
it at all and needed no change.

No content, branding, pricing, or educational copy was changed. No `_redirects`
rule was added or removed in this phase — Phase 3 already established that
Cloudflare Pages' automatic `.html` → extensionless redirect covers every
static page by itself; Phase 4 only makes the site's own metadata agree with
that existing platform behavior.

## 2. Inventory (built before any file was touched)

Per the explicit instruction not to do a blind global replace, the affected
files and patterns were enumerated first:

- **71 public pages** = 86 total `.html` files − 15 noindex files (same set
  Phase 3 found, re-verified unchanged).
- **Canonical / og:url status**: 65 of 71 pages had a `.html` canonical +
  `og:url` needing conversion. 3 pages
  (`apex-advantage-mock-oral.html`, `apex-advantage-airspace-mastery.html`,
  `apex-advantage-checkride-binder.html`) were **already** extensionless —
  pre-existing, left untouched. `index.html`'s canonical is `/` — already
  correct. **2 pages had no canonical or `og:url` at all**:
  `mock-oral-giveaway.html` and `mock-oral-giveaway-rules.html` — these are
  genuine pre-existing gaps, not a format problem; canonical/og were added.
- **JSON-LD**: 57 self/cross-referencing `"url"` fields and 58
  `"@id": ".../about.html#andrew-serrazina"` references across 30 files,
  all with `.html`, all converted (0 remaining after the transform; verified
  by sweep, see §4).
- **Internal links**: ~2,660 `href="*.html"` occurrences sitewide
  (relative, absolute, and root-relative `/slug.html` forms — all three
  forms exist in the codebase and all three were handled). Of these, the
  links to noindex/app pages and `portal-login.html`'s query-string routing
  were explicitly excluded and left as `.html`.
- **Sitemap**: see §3.

The full per-pattern counts and raw grep output this inventory was built
from are not committed (they were scratch files used to drive the transform
script, not something future readers need); the script itself
(`canonicalize.mjs`, described below) **is** the durable, reviewable record
of exactly what was matched and changed, and the new regression tests in
§5 assert the end state directly from the repo.

### How the rewrite was done

A Node script (run once, not committed — its logic is fully described here
and verified by the tests in §5) was built directly from the inventory
above: for each of the 71 public-page slugs, it replaced only
`rel="canonical" href="https://apexaviationtx.com/<slug>.html"`,
`property="og:url" content="https://apexaviationtx.com/<slug>.html"`,
`"url": "https://apexaviationtx.com/<slug>.html"` in JSON-LD, the shared
`about.html#andrew-serrazina` `@id`, and `href="<slug>.html[...]"` /
`href="https://apexaviationtx.com/<slug>.html[...]"` /
`href="/<slug>.html[...]"` — preserving any `?query` or `#fragment` suffix —
with the extensionless form. Nothing matching any other pattern was
touched. This was run, then verified (§4), rather than applied blindly.

## 3. Sitemap.xml: two pre-existing defects found and fixed

Independent of the canonical-URL format, inventorying the sitemap surfaced
two genuine, pre-existing bugs unrelated to the .html/extensionless question:

1. **7 blog pages were listed twice** — an entire 7-entry `<url>` block
   (`blog-central-texas-weather-for-pilots.html` and 6 others) was pasted
   into the file a second time verbatim (same `lastmod`/`changefreq`/
   `priority`). 76 `<loc>` tags, only 69 unique.
2. **A noindexed page was listed in the sitemap**:
   `apex-advantage-private-pilot.html` carries `noindex` but was still in
   `sitemap.xml` — sitemaps should only list indexable URLs.
3. (Found alongside, same inventory pass) **3 public pages were missing
   from the sitemap entirely**: `terms.html`, `mock-oral-giveaway.html`,
   `mock-oral-giveaway-rules.html`. Added with reasonable `changefreq`/
   `priority` matching comparable existing pages (`terms` ~ `privacy`:
   yearly/0.3; `mock-oral-giveaway` ~ `jobs`: monthly/0.5;
   `mock-oral-giveaway-rules` ~ `privacy`: yearly/0.3).

The rebuilt `sitemap.xml` has exactly 71 entries — one per public page,
each extensionless, each deduplicated, each resolving directly to an
existing file with no noindex/retired/nonexistent entries.

## 4. Verification performed

- Swept every public page's canonical and `og:url` after the rewrite:
  exactly one of each, extensionless, matching the page's own filename. 0
  remaining `.html` occurrences among the 71.
- Swept all 86 files for JSON-LD `"url"`/`"@id"` fields referencing any of
  the 71 public-page slugs with `.html`: 0 remaining.
- Swept all 86 files for `href` (relative, absolute, root-relative) to any
  public-page slug with `.html`: 0 remaining. The only `.html` hrefs left
  sitewide are to noindex/app pages, `portal-login.html`'s query-string
  routes, and 3 **pre-existing, unrelated** dead links in
  `mock-oral-giveaway.html`'s own (non-shared) nav bar — see §6.
- `sitemap.xml`: validated well-formed (`xmllint --noout`), 71 unique
  entries, every entry resolves to an existing file, none point at a
  `_redirects` source (i.e. none require a redirect hop to reach 200).
- Added `portal/test/seoPhase4Canonicalization.test.js` (see below) and
  updated the pre-existing Phase 1/3 tests whose assertions baked in the
  old `.html`-canonical assumption (`cityPagesSeoConsolidation.test.js`,
  `seoPhase3TechnicalAudit.test.js`, `cityPagesPhase2Content.test.js`) —
  those are genuine test updates to match the new, approved standard, not
  loosened checks; they still assert exact URL equality, just against the
  extensionless form.
- Full suite: **1406/1406 tests pass** (`npm test` in `portal/`), including
  482 new Phase 4 assertions.
- `npm run lint`: clean (pre-existing warnings only, none in touched files;
  `oxlint` doesn't lint `site/*.html` at all).
- `npm run build`: succeeds (this builds the React portal app; the
  marketing `site/` directory is plain static HTML with no build step).

### New regression tests (`seoPhase4Canonicalization.test.js`)

- Every public page: exactly one canonical, extensionless, matching its slug.
- Every public page: exactly one `og:url`, matching its canonical.
- No public page's canonical/og slug is itself a `_redirects` source (i.e.
  nothing canonicalizes to a URL that then has to redirect again).
- No file's JSON-LD `url`/`@id` references a public page with `.html`.
- The shared `about#andrew-serrazina` `@id` is identical, extensionless,
  everywhere it appears; the shared `#organization` `@id` is untouched.
- No file links to a public page with `.html` (relative/absolute/root-relative).
- Every extensionless internal link to a public page resolves to a real file.
- Noindex/app pages: `portal-login.html` query-string routing is still
  `.html` (unchanged, by design); no noindex page was given a self-
  referencing extensionless canonical by this phase.
- `sitemap.xml`: no duplicates, no `.html` entries, no noindex entries,
  every entry resolves directly (not via a redirect), every public page
  present exactly once.
- No regression to analytics (GA4 tag still present) or lead capture (the
  Taylor page's Formspree + CRM wiring, checked by name, is untouched).
- The noindex set itself is byte-for-byte the same 15 files as Phase 3.

## 5. Rollback plan

This phase changes four kinds of file, each independently revertible:

1. **71 public HTML files** (canonical/og/JSON-LD/internal links) — revert
   by `git revert` of this PR's commit(s), or by checking out the pre-Phase-4
   versions of the affected files from the Phase 3 branch tip
   (`seo/phase3-technical-audit-2026-11` / PR #291, once merged). No data
   migration, no database, no build artifact depends on this — it is pure
   static-HTML metadata.
2. **`sitemap.xml`** — same; a plain-file revert restores the prior
   (duplicated, gap-containing) sitemap exactly.
3. **2 files gained new canonical/og tags** (`mock-oral-giveaway.html`,
   `mock-oral-giveaway-rules.html`) — reverting removes them; the pages
   function identically either way, since this is metadata, not markup
   the page depends on.
4. **Test files** — revert alongside; the pre-Phase-4 test suite will pass
   again against the pre-Phase-4 HTML.

Because `_redirects` was **not** changed in this phase, a rollback carries
no risk of breaking the `.html` → extensionless redirect path Phase 3
already validated: `.html` URLs keep working under Cloudflare Pages'
platform-level clean-URL behavior regardless of which direction this PR's
canonical tags point. In other words, canonical URLs are advisory metadata
read by crawlers, not something that changes what actually gets served —
reverting this PR cannot break any live page or redirect.

## 6. Unresolved issues requiring manual follow-up (out of this PR's scope)

- **`mock-oral-giveaway.html` has its own, non-shared nav bar** (not the
  site's common header) that links to three pages that don't exist
  anywhere in the repo: `/services.html`, `/facility.html`, `/team.html`,
  plus a fourth link mislabeled "Training" pointing at
  `/apex-advantage-private-pilot.html` (a real but noindexed, unrelated
  page). This is a **pre-existing dead-link/content bug**, unrelated to the
  `.html`-vs-extensionless question — fixing it would mean deciding what
  those nav links *should* point to, which is a content/IA decision, not a
  URL-format one, and is explicitly out of this technical phase's scope.
  Flagging for a deliberate follow-up fix.
- **Production has not been re-tested against this PR** — like Phase 3,
  this can only be verified against a deployed Cloudflare Pages preview
  once the PR is opened and a preview build exists. The repository-level
  checks in §4 confirm internal consistency (every canonical/sitemap/link
  is self-consistent and resolves to a real file) but not live HTTP
  behavior. **Recommended before merge**: fetch 3-5 representative pages
  (home, a flight-training city page, a blog post, an Apex Advantage page,
  the newly-touched `mock-oral-giveaway.html`) from the deploy preview and
  confirm each serves 200 at its new canonical URL and that view-source
  matches what's in this diff.
- This PR is branched from the tip of Phase 3's branch
  (`seo/phase3-technical-audit-2026-11`, commit `bdeab89`), not from `main`,
  since Phase 3 (PR #291) is not yet merged. Once PR #291 merges, this
  branch should be rebased onto `main` before merging Phase 4, to avoid
  carrying Phase 3's commits into Phase 4's diff.

## 7. Deployment verification checklist

Before merging this PR:

- [ ] PR #291 (Phase 3) is merged first, or this branch is confirmed to
      already contain its changes without conflict.
- [ ] Rebase this branch onto `main` (post-#291-merge) if not already based on it.
- [ ] Open a deploy preview; spot-check the 5 representative pages named in §6.
- [ ] Confirm `GET /flight-training-taylor.html` on the preview 308-redirects
      to `/flight-training-taylor` and returns 200 there (platform behavior,
      unchanged by this PR, but worth reconfirming on the actual preview URL).
- [ ] Confirm `view-source` on 2-3 pages shows the new extensionless
      canonical/og:url/JSON-LD, matching this diff.
- [ ] After merge/deploy, request re-indexing or monitor Search Console for
      the next crawl to confirm GSC starts reporting the extensionless URLs
      as canonical rather than flagging "duplicate, Google chose different
      canonical" (the exact symptom Phase 3's audit was investigating).
