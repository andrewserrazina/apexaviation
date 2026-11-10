# SEO Phase 3 — Technical Indexing Audit

Date of audit: 2026-11-10. Covers Part A (Search Console baseline), Part B
(technical URL/canonical/sitemap investigation), and the technical half of
Part C (nationwide ground-school pages) from the Phase 3 brief. Builds on
Phase 1 (PR #289) and Phase 2 (PR #290), both merged to `main` before this
audit began.

Every finding below is labeled with its evidence type:

- **[REPO]** — found by reading files in this repository.
- **[LIVE]** — found by making real HTTP requests to `https://apexaviationtx.com`
  from this session, with the exact commands given so they're reproducible.
- **[GSC-HISTORICAL]** — taken from the Search Console export numbers supplied
  in the task brief. This session has no Search Console API access and no raw
  per-URL export file was found locally (checked for CSV/JSON exports under
  the repo and common temp paths — none present). These numbers are
  background, not independently verified, per the brief's own instruction.

---

## 1. Search Console baseline (as supplied, not independently verified)

| Metric | Count | Evidence |
|---|---:|---|
| Indexed URLs | 125 | [GSC-HISTORICAL] |
| Not indexed | 182 | [GSC-HISTORICAL] |
| Discovered — currently not indexed | 106 | [GSC-HISTORICAL] |
| Crawled — currently not indexed | 26 | [GSC-HISTORICAL] |
| Page with redirect | 29 | [GSC-HISTORICAL] |
| Excluded by noindex tag | 15 | [GSC-HISTORICAL] |
| Alternate page with proper canonical | 4 | [GSC-HISTORICAL] |
| Blocked due to other 4xx issue | 1 | [GSC-HISTORICAL] |
| Redirect error | 1 | [GSC-HISTORICAL] |

**No raw per-URL export was available to parse.** The findings below were
derived independently (live HTTP checks + repository inspection), then
cross-referenced against these category totals where a plausible connection
exists. Where I say a finding "is consistent with" or "may explain" a GSC
category, that is an inference from matching evidence, not a confirmed
causal link — I did not have the URL-level data needed to prove causation.

**The Oct 23 jump from ~32 to ~125 indexed URLs is not explained by anything
found in this audit.** The ground-school retirement commit (`975f798`,
2026-11-07) happened *after* that jump, so it cannot be the cause. No other
evidence of an algorithmic change, manual action, or specific intervention
around Oct 23 was found in the repo's git history. This remains unexplained
and should stay unexplained rather than be assigned a cause this audit can't
support.

---

## 2. Finding: every page's declared canonical URL is itself a redirect in production

**This is the most significant finding in this audit, and it's sitewide, not
confined to city pages.**

### Evidence

Every page in this repository declares its own `.html` URL as canonical, e.g.:

```html
<link rel="canonical" href="https://apexaviationtx.com/flight-training-taylor.html" />
```

Live production behavior **[LIVE]** (checked 2026-11-10):

```
$ curl -sS -o /dev/null -w "%{http_code}\n" "https://apexaviationtx.com/flight-training-taylor"
200
$ curl -sS -D - -o /dev/null "https://apexaviationtx.com/flight-training-taylor.html"
HTTP/2 308
location: /flight-training-taylor
```

So the canonical URL that every page declares (`.html`) is not the URL that
actually serves 200 — it 308-redirects to a different URL (the extensionless
form), and *that* URL is what actually returns the page content. Put plainly:
**the canonical tag points at a redirect, not a destination.**

This was checked and confirmed identical across every page tested, with no
exceptions found:

```
flight-training-hutto          extensionless=200  .html=308
flight-training-georgetown     extensionless=200  .html=308
flight-training-round-rock     extensionless=200  .html=308
flight-training-pflugerville   extensionless=200  .html=308
flight-training-cedar-park     extensionless=200  .html=308
flight-training-burnet         extensionless=200  .html=308
flight-training-san-marcos     extensionless=200  .html=308
flight-training-new-braunfels  extensionless=200  .html=308
```

A random sample of 15 URLs pulled directly from `sitemap.xml` (not just
flight-training pages) was tested live; **all 15 returned 308**, zero
returned 200 directly:

```
$ grep -o '<loc>[^<]*</loc>' site/sitemap.xml | sed 's#<loc>##;s#</loc>##' \
    | shuf -n 15 | xargs -P8 -I{} curl -sS -o /dev/null -w "%{http_code} {}\n" "{}"
308 https://apexaviationtx.com/checkride-prep.html
308 https://apexaviationtx.com/commercial-pilot-training.html
308 https://apexaviationtx.com/blog-flying-austin-class-c-airspace-guide.html
308 https://apexaviationtx.com/flight-training-west-lake-hills.html
308 https://apexaviationtx.com/blog-central-texas-weather-for-pilots.html
... (15/15 returned 308)
```

Trailing slashes behave the same way: `/flight-training-taylor/` → 308.

### Root cause (repo evidence, with a documented gap)

Nothing in `site/netlify.toml` or `site/_redirects` creates this `.html` → extensionless
redirect — it isn't expressed anywhere in this repository. `netlify.toml`
here only sets security headers:

```toml
[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    ...
```

This matches Netlify's documented "Pretty URLs" post-processing feature,
which auto-redirects `.html` requests to the clean/extensionless path for any
HTML file it finds, and is controlled by a **site-level setting in the
Netlify dashboard** (Site configuration → Build & deploy → Post processing),
not by anything expressible in `netlify.toml` or `_redirects` on the plan/version
this site appears to be using. I could not confirm this dashboard setting
directly — I have no Netlify dashboard or API access from this session — but
the observed behavior (100% consistent across every page type tested, not
listed in any repo-tracked redirect config, and matching Netlify's documented
Pretty URLs behavior exactly) makes this the best-supported explanation
available from here. **This should be confirmed against the actual Netlify
site settings before any fix is chosen** — see Section 6.

### Why this matters for indexing

- `sitemap.xml` lists the `.html` form for all 76 of its entries. Every one
  of those submitted URLs is a redirect source, not a destination. Google
  can follow a 308 from a sitemap entry, but Search Console explicitly
  tracks this as a distinct, flagged pattern — the **"Page with redirect"**
  exclusion category (29 in the historical export) is very plausibly
  describing exactly this, though I can't confirm the specific 29 URLs
  without the raw export.
- Internal links across the site (`href="flight-training-hutto.html"`, etc.)
  also universally use the `.html` form, meaning every internal navigation
  click takes an extra redirect hop in production that doesn't need to
  happen.
- This is not a new Phase 3 regression — it's a pre-existing condition that
  predates this SEO initiative. The ground-school retirement commit
  (2026-11-07, before Phase 1) already noted in its own commit message that
  the new canonical page's URL needed fixing because its "canonical/og URLs
  ... were pointing at a URL this static host never actually serves" — i.e.,
  this exact `.html`-vs-extensionless ambiguity has been a known trouble spot
  on this site for a while, just not previously traced to its root cause.

### What I did *not* do, and why

I did not rewrite canonical tags, `sitemap.xml`, or internal links to the
extensionless form. That would touch essentially every page on the site —
canonical tags, `og:url`, JSON-LD `url`/`@id` fields, 76 sitemap entries, and
every internal `href`. It's exactly the kind of broad, consequential,
two-way architectural change the Phase 3 brief says must be "documented
separately and submitted for explicit approval," not executed speculatively.
See Section 6 for the two remediation paths and my recommendation.

---

## 3. Finding: 45 of 143 retired ground-school redirects return 404, not 301, in production

### Evidence **[LIVE]**, checked 2026-11-10

All 143 `/ground-school-<city>-<state>.html` → `/apex-advantage-private-instruction.html`
redirect rules in `site/_redirects` (as they existed before this PR — see
Section 6 for the fix) were tested live. Script and full results:

```bash
grep "^/ground-school-" site/_redirects | awk '{print $1}' | sed 's#^/##' \
  | xargs -P10 -I{} sh -c 'echo "$(curl -sS -o /dev/null -w "%{http_code}" "https://apexaviationtx.com/{}") {}"'
```

Result: **98 returned 301 (correct), 45 returned 404 (broken).** All 45
failures were entries alphabetically from "philadelphia" onward in the file
(lines 112–156 of 156); all 98 successes were from the start of the block
through "overland-park" (lines 9–111). The full list of the 45 broken URLs
is in the PR description and this session's working notes; representative
examples: `ground-school-philadelphia-pa.html`, `ground-school-seattle-wa.html`,
`ground-school-springfield-ma.html`, `ground-school-chicago-il.html` (this
one actually *works* — 301 — since "chicago" sorts before "philadelphia"),
`ground-school-tulsa-ok.html`.

### What this is *not*

- **Not a repo-content bug.** Every one of the 143 rules (working and
  broken) is syntactically identical, pure ASCII, no hidden characters, same
  structure (`cat -A` diff showed byte-for-byte identical formatting between
  a working and a broken line aside from the slug and target).
- **Not a stale-deploy issue.** `git blame` confirms all 143 lines were
  added in a single commit (`975f798`, 2026-11-07) — there's no earlier
  commit whose deploy could be "stuck" partway through this block.
- **Not a file-size or line-count problem I could pin to a documented
  limit.** The file is ~12KB / 158 lines total; the failure boundary sits at
  byte offset ~8,468 and line 112 — neither lines up with a Netlify limit I
  could find documented (Netlify's documented ceiling is far higher, on the
  order of 1,000+ rules).

### What I did about it

Since I can't inspect Netlify's deploy logs or dashboard from here, I can't
prove the exact mechanism. But the fix doesn't require knowing the
mechanism: **I replaced all 143 individual literal rules with one wildcard
rule** using Netlify's documented splat syntax:

```
/ground-school-*  /apex-advantage-private-instruction.html  301
```

This is semantically identical to the original intent (any
`/ground-school-...` path redirects to the consolidated page), is far
simpler, and sidesteps whatever caused only part of a long literal-rule
block to be honored. This is the "smallest reliable fix compatible with the
site's actual hosting platform" available from the repo alone. **It has not
been verified live post-deploy** — see Section 6 for the exact commands to
re-run after this PR deploys, to confirm all 143 slugs now 301 correctly,
including the 45 that were previously broken.

---

## 4. Sitemap, robots.txt, and noindex review

### Sitemap **[REPO]**

- 76 `<url>` entries, well-formed XML (verified via `xml.etree.ElementTree`).
- Zero entries reference any `ground-school-*.html` URL — correctly removed
  in the 2026-11-07 retirement commit, before this audit.
- Zero entries reference the retired `flight-training-hutto-taylor.html`
  page (removed in Phase 1).
- Every entry uses the `.html` form — see Section 2 for why that's a
  problem, and why I didn't rewrite it unilaterally.

### robots.txt **[LIVE] vs [REPO]**

The repo's `site/robots.txt` is short:

```
User-agent: *
Allow: /

Sitemap: https://apexaviationtx.com/sitemap.xml
```

The **live** `https://apexaviationtx.com/robots.txt` **[LIVE]** returns a much
longer file, with a large block of AI-crawler-specific `Disallow` rules
(`GPTBot`, `Google-Extended`, `GoogleOther`, `Bytespider`, etc.) and a
`Content-Signal` header-style directive, injected **above** the repo's own
content. The repo's own `Allow: /` and `Sitemap:` lines are present verbatim
at the bottom of the live response, unchanged.

This is Cloudflare's "AI bot management" robots.txt injection (this domain
is Cloudflare-proxied — confirmed via `server: cloudflare` and `cf-ray`
response headers on every request tested). **This is not a defect** — it
layers additional bot-specific directives on top of the origin's own file
rather than replacing it, and none of the disallowed bots is the main
`Googlebot` crawler used for standard Search indexing (`GoogleOther` is a
secondary, research-purpose Google crawler, not the indexing crawler). No
action taken or recommended here; documented so a future audit doesn't
mistake this for configuration drift between the repo and production.

### Noindex pages — matches the GSC "15" exactly **[REPO]**

```
404.html, apex-advantage-private-pilot.html, blog-post.html,
checkride-guide-download.html, checkride-guide-web.html,
checkride-prep-download.html, coming-soon.html, email-preferences.html,
free-checkride-guide.html, landing.html, mobile-auth-redirect.html,
portal-login.html, portal-reset-password.html, portal-signup-success.html,
portal.html
```

That's exactly 15 files with a `noindex` directive — matching the GSC
"Excluded by noindex tag: 15" count precisely. All 15 are legitimate:

- `portal*.html`, `mobile-auth-redirect.html`, `email-preferences.html`:
  authenticated/account pages — correctly noindexed, not touched.
- `404.html`, `coming-soon.html`: utility pages — correctly noindexed.
- `blog-post.html`: the retired dynamic blog-rendering shell from a prior
  session (static posts replaced it) — correctly noindexed rather than
  deleted, since it may still be reachable by old links.
- `checkride-guide-download.html`, `checkride-guide-web.html`,
  `checkride-prep-download.html`, `free-checkride-guide.html`: lead-magnet
  delivery/thank-you pages, meant to be reached only via a direct link after
  a form submission, not organic search — correctly noindexed.
- `apex-advantage-private-pilot.html`, `landing.html`: both titled
  identically to the real `apex-advantage-private-instruction.html` page —
  these read as earlier/alternate landing-page variants kept noindexed to
  avoid competing with the real page rather than being deleted outright
  (possibly still linked from old ad campaigns or emails). Correctly
  noindexed, not touched.

**No action taken.** Per the brief's explicit instruction, intentional
noindex protection on authentication/account/private pages (and these other
legitimately-excluded pages) was not removed, and nothing here looked like
an *accidental* noindex on a page that should be public.

### The single "4xx" and single "redirect error" GSC entries

**Could not be independently investigated** — no raw per-URL export was
available, and a single unidentified URL out of 307 known URLs isn't
something a live crawl can reliably find by guessing. Flagged as an
outstanding uncertainty (Section 6) requiring the actual GSC URL-level
export if it's worth pursuing further.

---

## 5. Other technical checks performed, no defects found

- **Duplicate/conflicting canonical tags**: checked every `.html` file in
  `site/` for more than one `<link rel="canonical">` — none found.
- **JSON-LD validity**: spot-checked across city pages in Phases 1–2;
  re-confirmed no changes in this phase affected it.
- **Fabricated business addresses / LocalBusiness proliferation**: not
  reintroduced; Phase 1's fix (single canonical `Organization` node, no
  per-city `LocalBusiness`, no fabricated ZIP) remains intact — re-verified
  via the existing Phase 1/2 test suites, both still passing (see validation
  report).
- **Stray internal links to retired pages**: searched the entire `site/`
  tree for literal references to `ground-school-[a-z]` and
  `flight-training-hutto-taylor` — the only matches were unrelated internal
  product/feature identifiers (`ground-school-pack`, `ground-school-registration`
  Stripe purchase purposes in `portal-login.html`/`portal-stable.js`), not
  dead links to retired pages.
- **Nationwide consolidation page's own claims**: `apex-advantage-private-instruction.html`
  was checked for language implying a physical/local presence — found none;
  its hero explicitly says the service is "held entirely online, so it's
  available to students anywhere in the country, not just here in Texas,"
  which is accurate and matches the business-context rules in this brief.

---

## 6. Outstanding uncertainties and recommended next steps (not executed here)

1. **Confirm whether Netlify's "Pretty URLs" post-processing setting is
   enabled** for this site (Netlify dashboard → Site configuration → Build &
   deploy → Post processing). This is the best-supported explanation for
   Section 2's finding, but I have no dashboard/API access to confirm it
   directly.
2. **Decide the canonical URL form** (`.html` vs. extensionless) for the
   whole site, then execute that decision in one dedicated, reviewed pass:
   - **Option A — turn off Pretty URLs in the Netlify dashboard.** Zero repo
     changes; makes `.html` serve 200 directly again, matching every
     existing canonical tag, sitemap entry, and internal link as-is.
     Lowest repo risk, but requires dashboard access this session doesn't
     have, and needs confirming it doesn't break something else relying on
     the clean-URL behavior.
   - **Option B — adopt the extensionless form as canonical everywhere**
     (rewrite ~100+ pages' canonical/og/JSON-LD URLs, `sitemap.xml`'s 76
     entries, and every internal `.html` link). Matches current hosting
     behavior and modern clean-URL convention, but is a large, sitewide
     content change with real risk of introducing mistakes across that many
     files.
   - **My recommendation: Option A first.** It's a single settings change,
     reversible, and testable in minutes, versus a multi-hundred-edit repo
     change for Option B. If Option A isn't available or doesn't fully
     resolve it, Option B becomes the fallback, done as its own
     dedicated, carefully-tested PR — not folded into this one.
3. **Re-verify the 143 ground-school redirects live after this PR deploys**:
   ```bash
   for slug in ground-school-philadelphia-pa.html ground-school-seattle-wa.html \
       ground-school-springfield-ma.html ground-school-tulsa-ok.html; do
     curl -sS -o /dev/null -w "%{http_code} $slug\n" "https://apexaviationtx.com/$slug"
   done
   # expect 301 for all four (previously 404)
   ```
4. **Pull the raw Search Console URL-level export** (Index Coverage report →
   export) if the single 4xx/redirect-error entries, or the specific 29
   "page with redirect" URLs, need confirming beyond the strong circumstantial
   match to Section 2's finding.
5. **The Oct 23 indexing jump remains unexplained.** Do not retroactively
   attribute it to this phase's findings; none of them predate or line up
   with that date.
