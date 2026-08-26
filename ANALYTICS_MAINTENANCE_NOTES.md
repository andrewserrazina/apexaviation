# Analytics Maintenance Notes

Companion to `ANALYTICS_EVENT_DICTIONARY.md` — orphaned-page cleanup,
manual GA4 Admin checks, and the test plan for the analytics reliability
pass (GA4 purchase dedupe, `portal_first_login` fix, attribution
persistence, Marketing & Funnel dashboard — see
`portal/supabase-portal-schema-v83.sql`).

## Identity stitching (funnel-coherence pass, v85)

**Root cause found:** `readiness-assessment.html` and the other marketing
pages are served from `apexaviationtx.com`; the portal
(`portal.html`/`portal-login.html`) is on `advantage.apexaviationtx.com`
— a different origin as far as `localStorage` is concerned. `anonId()`
(`site/analytics-events.js`) used to live exclusively in `localStorage`,
so an anon_id picked up during the readiness assessment was invisible
the moment the same visitor reached the portal — they silently became a
second, disconnected anonymous identity, which is why funnel steps that
should have been the same person (e.g. Readiness `Signup Completed` vs.
Executive `Registration Completed`) could disagree even before accounting
for the separate event-naming issue documented in the dictionary.

**Fix, in two parts:**
1. `anonId()` now persists via a cookie scoped to the shared
   `.apexaviationtx.com` parent domain (`cookieDomain()`,
   `site/analytics-events.js`), readable from both the marketing site and
   the portal. `localStorage` is kept only as a same-origin cache and a
   migration path (an existing localStorage-only anon_id gets promoted to
   a cookie on next read rather than being replaced).
2. `analytics_identity_map` (`anon_id text primary key, profile_id uuid,
   linked_at`) + `link_analytics_identity()` (`supabase-portal-schema-
   v85.sql`) durably record the first time each anon_id is seen from an
   authenticated session. Called from `site/portal-stable.js`'s
   `checkLifecycleMilestones()` (every authenticated portal load) and
   from `readiness-assessment.html`'s login-gate handler (the one
   same-origin, immediately-authenticated case on that page). Every
   funnel RPC resolves identity via `resolve_analytics_identity(anon_id,
   profile_id)`, which prefers a resolved profile_id (direct or via the
   map) over the raw anon_id — the reverse of the old plain
   `coalesce(anon_id, profile_id::text)`, which (because anon_id is
   written on every event, authenticated or not) meant anon_id always won
   and profile_id was never actually reachable through it.

**What this does NOT fix:** any anon_id that was already disconnected
across the origin boundary *before* this shipped stays disconnected —
that history is genuinely unrecoverable and was not fabricated or
backfilled. Only journeys that happen after this ships get correctly
stitched end-to-end.

## Funnel RPC comparison table (Part 1 of the coherence audit)

Every RPC uses `resolve_analytics_identity(anon_id, profile_id)` as of
v85 (see above) and the same cohort model unless noted: **the cohort is
whoever hit the funnel's first step within the selected date range; every
later step counts whether that same identity EVER reached it, with no
upper bound on when** ("open funnel" / cohort model, not same-period).
This is deliberate for acquisition/activation funnels (a signup on day 29
of a 30-day window can still convert on day 35) and is called out
explicitly in the dashboard's own section subtitles. `get_marketing_
revenue_summary()` is the one exception — it's a same-period transaction
total, not a cohort, since "revenue in the last 30 days" should mean
purchases that happened in the last 30 days, not purchases eventually
made by anyone who merely visited in the last 30 days.

| RPC | First-step event (cohort) | Identity | Same-period or cohort? | Counts events or unique users? |
|---|---|---|---|---|
| `get_marketing_executive_funnel` | `landing_page_viewed` | resolved | Cohort | Unique (distinct identity) |
| `get_readiness_funnel_stats` | `readiness_assessment_viewed` | resolved | Cohort | Unique |
| `get_checkride_prep_funnel_stats` | `landing_page_viewed` (product=checkride_prep) | resolved | Cohort | Unique |
| `get_ground_school_funnel_stats` | `ground_school_schedule_viewed` | resolved | Cohort | Unique |
| `get_portal_activation_funnel` | `registration_completed` (profile_id only — anonymous visitors have no onboarding/activation state) | `profile_id` directly, no anon_id | Cohort | Unique |
| `get_utm_campaign_performance` / `get_channel_performance` | Any event with a recorded first touch | resolved, credited to each identity's EARLIEST touch in range | Cohort (per-user first touch), events scoped to range | Unique, `revenue` summed |
| `get_marketing_revenue_summary` | n/a — direct aggregate | n/a | **Same-period** (transaction date, not cohort) | Revenue summed, purchases counted |
| `get_analytics_data_quality` | n/a — checks + re-runs other RPCs over a fixed 90-day window for invariant checks | resolved | Fixed 90-day window, independent of the dashboard's selected range | Mixed |

## Orphaned pages

Four pages carry zero analytics of any kind (no GA4, no Meta, no Clarity,
no `apexTrack`) — re-confirmed as part of this pass:

- `site/checkride-guide-web.html`
- `site/checkride-prep-download.html`
- `site/free-checkride-guide.html`
- `site/portal-signup-success.html`

All four have zero internal links anywhere in `site/*.html`, are absent
from `site/sitemap.xml`, and no Supabase Edge Function template (email or
otherwise) references any of their filenames. They read as superseded —
`portal-login.html`'s own success states and `checkride-prep.html` now
cover the same ground each of these once did.

**Recommendation:** left in place, not deleted, per this pass's own
"don't delete without confirming no external dependency" instruction —
this sandbox can confirm nothing *inside* the repo points to them, but
cannot confirm whether an old ad, an email sent from outside this
codebase, or a bookmarked link still drives real traffic to one of them.
Before deleting: check GA4's own page-path report for any traffic to
these four URLs in the last 90 days (zero traffic there would close the
loop this pass couldn't).

## GA4 Admin — manual checks required

Not configurable from source code; verify directly in **GA4 Admin → Data
Streams → your Web stream → Enhanced measurement**:

- **Scrolls** — if enabled, this already covers generic 90%-scroll-depth
  tracking; no reason to duplicate it with custom `apexTrack()` scroll
  events unless a specific business question needs a scroll depth other
  than 90%.
- **Outbound clicks** — covers links to other domains automatically;
  doesn't apply to same-origin navigation (e.g. a city landing page's
  in-site link to `apex-advantage-private-pilot.html`), which is why the
  Marketing & Funnel dashboard's per-campaign attribution exists as a
  first-party alternative for that case.
- **Site search** — only relevant if a `?q=`/`?s=`-style search exists
  anywhere on the site; not applicable today as far as this pass found.
- **File downloads** — would automatically catch the Download Vault's
  Google-Drive-linked PDFs; confirm this is on if download tracking in
  GA4 (as opposed to the internal funnel) matters for reporting.

None of the above were duplicated with new custom JavaScript in this
pass, per the explicit instruction not to re-implement what Enhanced
Measurement already covers without a specific reason.

## Test plan

Five tests, per the analytics reliability brief. None of these could be
executed live in this sandbox (no live Supabase project, no real Stripe
checkout, no browser session against production) — every fix was verified
by static code inspection, a full syntax/build check (`npm run build`,
`tsc --noEmit` against both edited Edge Functions), and by tracing the
exact code path each test below exercises. Treat this as the checklist to
run once these changes are deployed, not as executed results.

### Test 1 — Purchase refresh dedupe
1. Complete a real (or Stripe test-mode) Checkride Prep purchase.
2. Confirm in GA4 DebugView and the `analytics_events` table: `purchase`
   (GA4) = 1, `purchase_completed` (DB) = 1.
3. Refresh the success page (`portal.html?unlocked=1&session_id=...`).
4. Confirm: GA4 `purchase` does **not** log a second transaction (check
   for the `transaction_id` match — GA4 should suppress or flag the
   duplicate), and `purchase_completed` does not insert a second row
   (the `apex_ga4_purchase_<session_id>` / `apex_funnel_purchase_<session_id>`
   `localStorage` keys should already be set from step 2, short-circuiting
   the repeat).
5. Repeat for the other three products (`?registered=1`, `?mockoral=1`,
   `?groundschoolpack=1`) — all four now share the same `fireGa4Purchase()`
   helper and dedupe pattern (`site/portal-stable.js`).

### Test 2 — `portal_first_login`
1. Create a new test account, log in for the first time.
2. Confirm `portal_first_login` = 1 (GA4 and `analytics_events`), and
   `profiles.first_portal_login_at` is now set for that profile.
3. Refresh the portal. Confirm still 1 (the atomic claim already lost the
   race against itself the first time — `claim_first_portal_login()`
   returns `false` on every call after the first).
4. Log out, log back in. Confirm still 1.
5. Repeat from a second browser/device for the same account. Confirm
   still 1 — this is the specific case the old implementation could not
   guarantee (two concurrent sessions both reading `portal_events` before
   either had written to it).

### Test 3 — Readiness funnel
Verify, in order, on a fresh assessment attempt: `readiness_assessment_viewed`
→ `readiness_assessment_started` → `readiness_question_answered` (×20) →
`readiness_assessment_completed` → `readiness_score_viewed` (×2, gated
true then false) → `readiness_signup_started` → `readiness_signup_completed`.
No code changed in this funnel during this pass (it was already correctly
implemented — the earlier GA4 tracking audit found `EVENT_ALLOWLIST` was
the only thing out of date, not the events themselves); this test exists
to confirm the `EVENT_ALLOWLIST` update didn't introduce a regression.

### Test 4 — UTM attribution persistence
1. Visit `readiness-assessment.html?utm_source=tiktok&utm_medium=live&utm_campaign=ask_a_cfi`.
2. Confirm `localStorage` now has `apex_utm_source=tiktok`,
   `apex_utm_medium=live`, `apex_utm_campaign=ask_a_cfi`,
   `apex_utm_source_first`/etc. matching, plus `apex_landing_page_first`
   and `apex_first_touch_at`.
3. Navigate to another page on the site (no UTM params on this second
   URL) — confirm the values from step 2 are unchanged (an internal nav
   must never look like a new touch).
4. Complete signup. Confirm `profiles.signup_utm_source = 'tiktok'`,
   `signup_utm_medium = 'live'`, `signup_utm_campaign = 'ask_a_cfi'`,
   `first_touch_landing_page` set, and `last_touch_*` seeded to the same
   values (`create-free-account/index.ts`).
5. Complete portal entry. Confirm attribution is still intact on the
   profile (nothing after signup overwrites `signup_utm_*` — only
   `last_touch_*` is ever updated post-signup, and only when a *new*
   utm-tagged URL is visited).
6. Separately: visit the portal weeks later via a *different* tagged link
   (e.g. `utm_source=facebook&utm_medium=paid`) while signed in. Confirm
   `profiles.last_touch_source` updates to `facebook` while
   `signup_utm_source` stays `tiktok` — this is the specific gap the
   `last_touch_*` columns and `update_last_touch_attribution()` RPC exist
   to close (`syncLastTouchIfFresh()`, `site/analytics-events.js`).
7. Repeat steps 1–4 for the two "instant access" signup-and-checkout
   paths (`signup-and-unlock-checkride-prep`, `signup-and-unlock-ground-
   school-pack`) — these previously had **no** first-touch attribution
   captured at all (a separate, real gap found and fixed alongside the
   above; see `applySignupAttribution()` in `create-checkout-session/index.ts`).

### Test 5 — Funnel dashboard reconciliation
For a known small test cohort (e.g. the accounts created during Tests 1–4
above), confirm the Marketing & Funnel dashboard's Executive Funnel and
Readiness Assessment Funnel numbers match a direct SQL count against
`analytics_events` for the same date range and event names — e.g.:

```sql
select count(distinct coalesce(anon_id, profile_id::text))
from analytics_events
where event_name = 'landing_page_viewed'
  and created_at >= '<range start>' and created_at < '<range end>';
```

should equal the dashboard's "Landing Visitors" figure for that same
range. Repeat for a few other steps/funnels to confirm the RPCs
(`get_marketing_executive_funnel`, `get_readiness_funnel_stats`, etc.,
`supabase-portal-schema-v83.sql`) aren't silently miscounting.
