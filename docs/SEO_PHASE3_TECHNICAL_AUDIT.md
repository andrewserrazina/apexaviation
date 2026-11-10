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

### Root cause — corrected during PR review (platform identified)

**Correction to this section's original version**: it attributed this
behavior to "Netlify Pretty URLs." That was wrong. The actual hosting
platform for this site is **Cloudflare Pages**, not Netlify — confirmed by
checking the PR's own deploy-preview bot comment (`cloudflare-workers-and-pages[bot]`,
giving a `*.apexaviation.pages.dev` branch-preview URL) and by testing that
preview directly: it reproduces the identical `.html` → extensionless 308
behavior found on production, including on a project (`apexaviation`) whose
branch-preview response headers match production's fingerprint (`server:
cloudflare`, no Netlify-specific headers on either). The `netlify.toml` /
`_redirects` file names are a red herring here — **Cloudflare Pages supports
the same `_redirects` file syntax as a documented compatibility feature**,
so this repo's `_redirects` file is genuinely being read by Cloudflare
Pages, while `netlify.toml` is likely inert (Cloudflare Pages has no reason
to read a Netlify-specific config file; it wasn't tested whether it's
ignored outright or silently has no effect, but nothing in it does anything
Cloudflare Pages would need).

Cloudflare Pages has its own automatic clean-URL behavior for static HTML
files — serving `/page` directly (200) for a file at `page.html`, and
308-redirecting `/page.html` requests to the clean path — which is what's
actually happening here, not a Netlify feature. This is **not configurable
from `netlify.toml`** (a Netlify-only file) and does not appear to be
something `_redirects` can override for files that still exist as static
assets (confirmed indirectly: this behavior persists even though nothing in
`_redirects` requests it).

I do not have Cloudflare dashboard/API access from this session to confirm
whether this clean-URL behavior has an on/off toggle the way Netlify's
Pretty URLs does. **This should be confirmed against the actual Cloudflare
Pages project settings before Phase 4 is finalized** — see Section 6.

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
- **Likely explanation, found after identifying the real platform
  (Cloudflare Pages, not Netlify — see Section 2): a documented Cloudflare
  Pages `_redirects` constraint.** Cloudflare's own docs cap a `_redirects`
  file at 2,000 *static* rules but only **100 *dynamic* (splat/wildcard)
  rules**, and explicitly recommend putting static rules before dynamic
  ones — processing dynamic rules out of order against a large static block
  has been reported (third-party, not official, so treated as corroborating
  rather than conclusive) to cause later static rules to silently stop
  working. The pre-fix file had exactly this shape: a splat rule
  (`/operations/*`) at line 4, *before* the 143-line static
  `/ground-school-*.html` block starting at line 14. This is a materially
  better-supported explanation than anything in this doc's original version
  (which guessed at Netlify limits for the wrong platform) — but it's still
  a plausible mechanism inferred from documented limits and one third-party
  report, not something confirmed against this project's actual Cloudflare
  deploy logs. Either way, **the fix applied below removes the problem
  regardless of the exact mechanism**: collapsing the 143 static rules into
  one splat rule drops the file to 3 dynamic rules total, nowhere near the
  100-rule dynamic budget, and removes the large static block that the
  ordering issue (if that's what this is) would have interacted with.

### What I did about it

Since I can't inspect the hosting platform's deploy logs or dashboard from
here, I can't prove the exact mechanism. But the fix doesn't require knowing
the mechanism: **I replaced all 143 individual literal rules with one
wildcard rule** using the splat syntax both Netlify and Cloudflare Pages
support:

```
/ground-school-*  /apex-advantage-private-instruction  301
```

This is semantically identical to the original intent (any
`/ground-school-...` path redirects to the consolidated page), is far
simpler, and sidesteps whatever caused only part of a long literal-rule
block to be honored.

### Validated live against the PR's actual deploy preview (not production — PR not yet merged)

This PR's branch builds a real preview deployment
(`https://seo-phase3-technical-audit-2.apexaviation.pages.dev`, confirmed as
the correct marketing-site project by its homepage title matching
production — a sibling Cloudflare Pages project in this same repo,
`apexadvantage`, serves an unrelated React app and was initially mistaken
for the right preview before this was caught). All 143 original slugs were
tested **in both `.html` and extensionless form** (286 requests total)
against this preview.

**Result: 143/143 `.html` URLs return 301; 143/143 extensionless URLs also
return 301** — including every one of the 45 that returned 404 before this
fix (spot-checked by name: `seattle-wa`, `springfield-ma`, `philadelphia-pa`,
`tulsa-ok`, and others from the original failing list are all in the
passing 143 now).

**A second defect was found during this validation**: following the full
redirect chain (`curl -L -w "num_redirects=%{num_redirects}"`) showed **2
redirects, not 1** — `/ground-school-chicago-il.html` → 301 →
`/apex-advantage-private-instruction.html` → 308 →
`/apex-advantage-private-instruction` → 200. The wildcard rule's own target
still had a `.html` extension, which itself triggered the same clean-URL
redirect described in Section 2 — an avoidable, unnecessary intermediate
hop. **Fixed** by repointing the wildcard rule directly at the extensionless
destination (shown above). Re-tested after the fix: `num_redirects=1`,
`final_http_code=200`, final URL is the extensionless destination directly.

**The same double-hop defect was found and fixed in two other existing
rules** while validating this one:

| Rule | Before | After |
|---|---|---|
| `/flight-training-hutto-taylor.html` (Phase 1) | → `/flight-training-taylor.html` → 308 → `/flight-training-taylor` (2 hops) | → `/flight-training-taylor` (1 hop) |
| `/operations/*` | → `/portal.html#operations` → 308 → `/portal#operations` (2 hops) | → `/portal#operations` (1 hop) |

Both re-tested live against the same preview after the fix: single
redirect, 200 final status, correct destination.

**No redirect loops found.** No rule's destination matches its own source
pattern, directly or after following the clean-URL hop; every chain now
terminates at a real 200 within exactly 1 hop.

**Unrelated URLs confirmed unaffected**, tested directly against the same
preview: homepage (`/`) → 200 unchanged; `/pricing.html` → 308 unchanged
(pre-existing platform clean-URL behavior, not something this PR touches);
`/pricing` → 200 unchanged. The wildcard rule only matches paths starting
with `/ground-school-`; it cannot affect any other path.

### What was *not*, and could not be, tested from this session

- **Production itself.** PR #291 is not merged/deployed, so all of the
  above is from the PR's own branch-preview deployment, not
  `https://apexaviationtx.com`. The preview is served by the same
  platform/project family as production (identical response-header
  fingerprint, identical pre-existing clean-URL behavior reproduced
  exactly), which is the strongest evidence available short of an actual
  production deploy — but it is not production. **Re-run the same 286
  ground-school requests against production after this PR merges and
  deploys** to close this gap; the exact commands are reproducible by
  substituting the preview URL above for `https://apexaviationtx.com`.
- Whether Cloudflare Pages' clean-URL behavior has a project-level on/off
  setting (the Cloudflare equivalent of Netlify's Pretty URLs toggle) — no
  dashboard/API access from this session.

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

## 6. Outstanding uncertainties and next steps

**Update**: the canonical-URL decision in item 2 below has since been made
by the site owner — **Option B, extensionless URLs, approved**. That work
is being implemented as a separate Phase 4 PR (not folded into this one),
per the explicit instruction not to combine the two. The options are kept
below as the record of what was presented and why Option B was chosen over
Option A.

1. **Platform confirmed**: the hosting platform is **Cloudflare Pages**, not
   Netlify (corrected above, in Section 2) — confirmed by testing this PR's
   own Cloudflare Pages branch-preview deployment directly. Still
   unconfirmed: whether Cloudflare Pages' automatic clean-URL behavior has a
   project-level on/off setting; no dashboard/API access from this session.
2. **The canonical URL form decision** (`.html` vs. extensionless):
   - **Option A — disable the platform's automatic clean-URL redirect** (if
     such a setting exists on Cloudflare Pages; unconfirmed). Zero repo
     changes; would make `.html` serve 200 directly again, matching every
     existing canonical tag, sitemap entry, and internal link as-is. Lowest
     repo risk, but depends on a setting that may not exist or be
     accessible, and would need confirming it doesn't break anything else
     relying on the clean-URL behavior.
   - **Option B — adopt the extensionless form as canonical everywhere**
     (rewrite ~100+ pages' canonical/og/JSON-LD URLs, `sitemap.xml`'s 76
     entries, and every internal `.html` link). Matches current hosting
     behavior exactly and modern clean-URL convention, but is a large,
     sitewide content change.
   - **Decision: Option B, approved by the site owner.** Rationale given:
     preserve the URL format already live in production rather than change
     hosting behavior to match outdated `.html` references. Being
     implemented as Phase 4 (separate PR, in progress).
3. **Re-verify the 143 ground-school redirects against production** (not
   just the PR's deploy preview, which is what this doc's evidence is from)
   after this PR merges and deploys:
   ```bash
   for slug in ground-school-philadelphia-pa.html ground-school-seattle-wa.html \
       ground-school-springfield-ma.html ground-school-tulsa-ok.html; do
     curl -sS -o /dev/null -w "%{http_code} $slug\n" "https://apexaviationtx.com/$slug"
   done
   # expect 301 for all four (previously 404; confirmed 301 on the PR's
   # own preview deployment during validation, not yet on production)
   ```
4. **Pull the raw Search Console URL-level export** (Index Coverage report →
   export) if the single 4xx/redirect-error entries, or the specific 29
   "page with redirect" URLs, need confirming beyond the strong circumstantial
   match to Section 2's finding.
5. **The Oct 23 indexing jump remains unexplained.** Do not retroactively
   attribute it to this phase's findings; none of them predate or line up
   with that date.
