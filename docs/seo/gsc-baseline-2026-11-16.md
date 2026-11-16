# GSC Baseline — 2026-11-16

Source: Google Search Console export `apexaviationtx.com-Performance-on-Search-2026-11-16.xlsx`, supplied in the task brief, covering August 14 – November 13, 2026 (92 days). All numbers below are transcribed as supplied — **[GSC-HISTORICAL]**, not independently re-pulled from the GSC API (this session has no GSC API access). GSC measures Google organic search only; it does not establish leads, bookings, conversions, or causality, and is not cross-referenced against analytics in this document.

## Caveats (carried over from the brief, not relaxed)

- The three 30-day-ish windows below are **unequal lengths** (30 / 30 / 32 days) — compare daily rates, not raw totals, when discussing trend.
- Query-level totals are **not necessarily additive** to page-level or overall totals — GSC applies privacy filtering and the dimensions (query vs. page vs. device vs. country) are reported independently, so they can't be summed and cross-checked against each other.
- GSC visibility of a URL variant (e.g. `/programs` and `/programs.html` both appearing) does **not by itself** prove a duplicate-content or canonical problem — see `technical-audit.md` for what the live site actually does.
- "Average position" is itself an average across whatever queries/dates triggered an impression for that page; a single page's average position conflates many queries, some much stronger or weaker than others.

## Overall totals

| Period | Clicks | Impressions | CTR |
|---|---:|---:|---:|
| Full 92 days | 117 | 4,792 | 2.44% |
| First 30 days | 40 | 818 | 4.89% |
| Next 30 days | 37 | 1,308 | 2.83% |
| Last 32 days | 40 | 2,666 | 1.50% |

Impressions roughly tripled across the three windows while clicks stayed flat — CTR fell each period. This is consistent with (not proof of) the site appearing for more queries/positions than before while conversion-to-click hasn't kept pace; `technical-audit.md` and `content-opportunities.md` propose ways to test that.

## By device

| Device | Clicks | Impressions | CTR | Avg. position |
|---|---:|---:|---:|---:|
| Desktop | 57 | 3,455 | 1.65% | 21.38 |
| Mobile | 57 | 1,304 | 4.37% | 7.84 |
| Tablet | 3 | 33 | 9.09% | 9.52 |

Mobile ranks ~13 positions better than desktop on average and converts impressions to clicks roughly 2.6x as often. The brief is explicit that this disparity **merits investigation, not an assumed technical bug** — candidate explanations (not yet tested): different query mix by device, mobile-first indexing weighting mobile page experience more heavily, or genuinely different SERP features (e.g. desktop showing more competing paid/map results for the same queries). Not investigated further in this pass — flagged as an open question in `implementation-plan.md`.

## By country

| Country | Clicks | Impressions | CTR | Avg. position |
|---|---:|---:|---:|---:|
| United States | 111 | 4,330 | 2.56% | 17.44 |

95% of clicks and 90% of impressions are US — expected for a Texas-based school with no stated non-US service area.

## By page

| Page | Clicks | Impressions | CTR | Avg. position |
|---|---:|---:|---:|---:|
| Homepage (`/`) | 73 | 2,549 | 2.86% | 16.53 |
| `/checkride-prep` | 7 | 112 | 6.25% | 7.33 |
| `/about` | 5 | 255 | 1.96% | 14.07 |
| `/blog-how-many-simulator-hours-count-toward-instrument-rating` | 2 | 50 | 4.00% | 6.48 |
| `/private-pilot-training` | 2 | 374 | 0.53% | 30.70 |
| `/instrument-rating-training` | 1 | 334 | 0.30% | 11.53 |

`checkride-prep` and the simulator-hours blog post both have strong CTR at decent position — they're working. `instrument-rating-training` and `private-pilot-training` are the clear underperformers: high impressions, very low CTR. `instrument-rating-training` is especially notable — a near-top-of-page-2 position (11.53) earning almost no clicks, which points at the SERP snippet (title/meta) failing to convert visibility into clicks rather than a visibility problem. See `implementation-plan.md` P1 for the fix already applied on a branch.

## Zero/near-zero-click queries with real impression volume

| Query | Impressions | Avg. position |
|---|---:|---:|
| `austin aircraft management programs` | 85 | 26.04 |
| `instrument rating austin` | 42 | 11.9 |
| `instrument checkride preparation austin` | 38 | 10.58 |
| `instrument proficiency training austin` | 38 | 17.55 |
| `instrument training near austin` | 33 | 13.48 |
| `instrument ground training austin` | 33 | 16.94 |

Four of these six are instrument-rating-flavored and point at the same page (`/instrument-rating-training`) and the same underlying gap: real search demand for instrument training "near/in Austin," much of it rank-worthy (position 10.58–17.55), converting to almost no clicks. `austin aircraft management programs` is the odd one out — **Apex Aviation does not offer aircraft management**, so per the brief's own constraint ("do not create services the business does not actually offer"), this query is **not** a target for new content; it's left unaddressed and flagged as a possible brand/intent mismatch worth a manual look in GSC's query report (is this a real searcher looking for something else entirely, or a mis-triggered SERP feature?).

## Brand queries

`apex aviation` — 25 clicks, 409 impressions, position 4.76. Healthy branded performance. The brief notes unrelated-sounding "Apex" flight schools/academies also surface in adjacent searches — **not investigated in this pass**; targeting or disambiguating against another business's brand is out of scope without first confirming intent, per the brief's own instruction not to target competitor brands misleadingly.

## Duplicate-URL-variant concern (as raised in the brief)

The brief lists `/programs` vs `/programs.html`, `/private-pilot-training` vs `.html`, `/instrument-rating-training` vs `.html`, `/about` vs `.html`, `www` vs non-`www`, `/apex-advantage` vs `.html` as GSC-visible variant pairs. **Live HTTP checks performed for this pass** (see `technical-audit.md` §1) show every `.html` variant 308-redirecting to its extensionless canonical today — this was fixed in the prior Phase 4 canonicalization work (`docs/SEO_PHASE4_CANONICALIZATION.md`, already merged to `main`). The **one variant pair still live without a redirect is `www` vs non-`www`** — both serve byte-identical 200 responses today, confirmed by direct HTTP request. See `technical-audit.md` §2 for the finding and a proposed (not yet applied) fix.

## Search appearance

Product snippets: 7 clicks / 122 impressions. See `technical-audit.md` §4 for which pages' `Product`/`Offer` schema this plausibly corresponds to, and whether that markup is accurate for the page it's on.

## Prioritized opportunities carried into this plan

1. Fix the SERP snippet (title/meta) on `/instrument-rating-training` and `/private-pilot-training` to lead with what's actually available **now** (live 1-on-1 CFII instruction) rather than the 2027-dated future aircraft program — both pages already have real, verified "Private Instruction · Live Now" content to draw on. **Applied as a safe patch**, see `implementation-plan.md` P1.
2. Close the one missing internal link the brief asked for (`checkride-prep` → `instrument-rating-training`) — the other three requested link sources (simulator-hours blog, `programs`, homepage) already link there. **Applied.**
3. Resolve the `www` host-duplicate — proposed, **not applied** (requires a hosting/DNS-adjacent change outside this repo's normal change surface; needs explicit approval, see `implementation-plan.md` P0).
4. Content-cluster candidates for the zero-click instrument queries — see `content-opportunities.md` (proposals only, not published).
