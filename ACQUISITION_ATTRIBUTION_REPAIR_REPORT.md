# Acquisition & Revenue Attribution Repair — Report

Branch: `claude/acquisition-attribution-repair` (off `claude/apex-member-portal-w3yoej`)
Commit: `c38d5a9`
Status: application code + tests complete and pushed. **Migration (v156) is NOT applied to production** — written and validated locally only, pending separate human approval per this task's explicit constraints.

---

## 1. Audit findings (root causes)

Verified production state (Oct 8, 2026): 271 profiles, 128 with `signup_utm_source`, 143 without. Reconciliation against `analytics_events`/`analytics_identity_map`/`readiness_assessment_leads` found 29 profiles with recoverable external-channel signals (18 Facebook, 5 Instagram, 6 Email) that `signup_utm_source` alone misses. 26 paid invoices / 24 distinct customers / $1,967 gross, already correctly unioned with no overlap by `verified_purchases` (v153) — this task extends that view, never replaces or duplicates it.

Reading `site/analytics-events.js`, `create-free-account/index.ts`, `create-checkout-session/index.ts`, `stripe-webhook/index.ts`, and the live schema surfaced five concrete gaps:

1. **No `document.referrer` or ad-platform click-ID capture.** Only UTM params and a `?ref=` code were ever captured. Several ad templates (and most organic/direct referrers) carry no `utm_*` at all — those visits left zero channel signal, even though the referrer or a `fbclid`/`gclid` would have identified them.
2. **No "signup-touch" concept distinct from first-touch.** `profiles.signup_utm_*` is written once, from the client's first-ever (`_first`-suffixed) localStorage keys — correct, but nothing captured the *latest* touch at that same moment. A visitor who arrived organically, then converted weeks later via a Facebook retargeting email, has that Facebook touch recorded nowhere.
3. **`checkout_session_attempts` (the purchase-touch record) had the same gap as #1** — UTM only, no referrer/click IDs.
4. **No reviewable backfill path for the 143 UTM-less profiles.** Any fix had to either silently guess (rejected — the task forbids inventing attribution) or surface evidence-backed proposals for human review. Nothing like this existed.
5. **`verified_purchases` didn't expose `stripe_session_id`**, so there was no safe join from a real paid transaction back to the checkout attempt that captured its purchase-touch.

`classify_marketing_channel()`/`normalize_marketing_source()` (the normalized-channel-mapping functions the task asked for) **already existed** (v83/v146) and already handle the `facebook/fb/meta`, `instagram/ig` aliases correctly — reused in the new canonical view rather than rebuilt.

Confirmed real two-key-spelling split in `analytics_events.properties` while building the backfill function: 10,020 rows use `traffic_source`, 853 use `utm_source` (older convention) — the backfill generator coalesces both so neither is silently missed.

## 2. Application changes (committed, on the branch)

**`site/analytics-events.js`** — added `CLICK_ID_KEYS` (`fbclid`/`gclid`/`msclkid`/`ttclid`/`gbraid`/`wbraid`) and `captureClickIdsAndReferrer()`; `utmProps()` now treats a fresh click ID the same as a fresh UTM param for the "first touch" gate (landing page/timestamp/anon-id capture); 6 new getters (`apexGetFirstTouchClickIds`, `apexGetClickIds`, `apexGetFirstTouchReferrer`, `apexGetReferrer`, `apexGetFirstTouchAnonId`, `apexGetSignupTouch`) exported on `window`. `getSignupTouch()` reads the *current* (latest) touch state — deliberately distinct from the `_first`-suffixed first-touch getters.

**`portal/supabase/functions/create-free-account/index.ts`** and **`create-checkout-session/index.ts`** — added `sanitizeReferrer()`/`sanitizeClickIds()` (same untrusted-input treatment as the existing `sanitizeUtm()`: capped length, printable-ASCII only, dropped silently if malformed). `applySignupAttribution()` (and create-free-account's equivalent inline block) extended with 4 new parameters, writing `first_touch_referrer`/`first_touch_click_ids`/`first_touch_anon_id` and the 8 new `signup_touch_*` columns — all additive spreads, so a profile with no new-field data gets no new columns touched (never overwrites, never invents). `logCheckoutAttempt()` extended to persist `referrer`/`click_ids` on `checkout_session_attempts` (purchase-touch), wired into all 12 call sites.

**6 client call sites updated**: `site/portal-login.html` (×3: free-account signup, 2 one-step checkouts), `site/readiness-assessment.html` (free-account signup), `site/apex-advantage-mock-oral.html` (one-step checkout), `site/apex-advantage-private-pilot.html` (ground-school-registration — purchase-touch fields only, since that flow never creates an account).

Nothing above changes existing column semantics, existing `last_touch_*` sync behavior, or Stripe webhook idempotency — `stripe-webhook/index.ts` was not modified (verified by source inspection: it only ever `UPDATE`s `checkout_session_attempts` by `stripe_session_id` for lifecycle fields, never touches `utm_*`/referrer/click_ids, and never `INSERT`s a second row for the same session — a duplicate webhook delivery re-sets the same lifecycle fields and cannot clobber or duplicate attribution).

## 3. Migration plan — `portal/supabase-portal-schema-v156-acquisition-attribution-repair.sql` (NOT APPLIED)

All changes are additive (new nullable columns, one new table, one view gains one column, two new views, one new function):

- **`profiles`**: 12 new columns — `first_touch_referrer`, `first_touch_click_ids` (jsonb), `first_touch_anon_id`, `signup_touch_source/medium/campaign/content/term`, `signup_touch_referrer`, `signup_touch_click_ids` (jsonb), `signup_touch_landing_page`, `signup_touch_at`.
- **`checkout_session_attempts`**: 2 new columns — `referrer`, `click_ids` (jsonb).
- **`verified_purchases`** (v153): extended to also select `stripe_session_id` from both the `invoices` and `ground_registrations` branches. Confirmed safe — every known consumer (the 5 RPCs in v153) selects explicit columns, never `select *`.
- **`canonical_paid_transaction_attribution`** (new view): one row per real paid transaction (from `verified_purchases`, so row count and total `amount_cents` always match it exactly — no double-counting), with first-touch, signup-touch, and purchase-touch each in clearly distinct, separately-named columns, plus `classify_marketing_channel()`/`normalize_marketing_source()` applied to each raw value (the normalized-channel-mapping requirement) without discarding the raw value.
- **`attribution_backfill_proposals`** (new table, propose-only, admin-only RLS): evidence-backed candidate values for profiles missing `signup_utm_source`, never auto-applied.
- **`generate_attribution_backfill_proposals()`** (new function, admin-gated, `INSERT`-only — never writes to `profiles`): 3 confidence tiers —
  1. **High** — earliest `analytics_events` row linked via `analytics_identity_map` (genuine pre-signup anonymous touch).
  2. **High** — a linked `readiness_assessment_leads` row's `utm_source` (also a genuine pre-signup touch).
  3. **Medium** — `checkout_session_attempts.utm_source`, explicitly labeled as a **purchase-touch proxy** (may postdate the visitor's real first touch — the email-retargeting scenario), and only proposed when no higher-confidence tier already covers that profile/field.
  Idempotent: `unique(profile_id, field_name, evidence_source)` + `ON CONFLICT DO NOTHING` — safe to re-run as new data arrives.

**Validation**: `test/sql/v156_attribution_harness.sql` — a self-contained local Postgres harness (stubs only the pre-existing objects this migration touches, column names/types verified against live `information_schema` via read-only queries). 13 assertions, all passing:
- New columns/tables exist with expected types.
- `canonical_paid_transaction_attribution` row count == `verified_purchases` row count (no double-counting), and correctly separates first/signup/purchase-touch for a fixture where all three genuinely differ.
- `generate_attribution_backfill_proposals()` rejects non-admins; as admin, produces exactly the right tier for each of 5 fixture profiles (including one with no signup_utm_source already, which gets no proposal; one where tier-1 evidence suppresses a would-be tier-3 proposal; and one proving the *earliest* tagged event wins, not the latest).
- Re-running the generator is a no-op (idempotent).
- RLS is enabled with admin-only select/update policies.

**Applying this to production requires separate, explicit approval** — this report does not constitute that approval. No destructive statements; everything is `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE VIEW`/`FUNCTION`.

## 4. Tests

`portal/test/acquisitionAttributionRepair.test.js` — 17 new tests, covering all 6 required scenarios:

| Scenario | Coverage |
|---|---|
| Anonymous-to-authenticated linking | Client-side: first-touch `anon_id` captured once, stable across later visits, ready for server-side linking. Server-side: SQL harness tier-1 (`analytics_identity_map` join). |
| UTM-free return visits | Click IDs/referrer follow the same never-overwritten first-touch / updatable last-touch contract UTM already had; a plain return visit with no params clears nothing. |
| Signup via readiness assessment | Static wiring check — the real page's `create-free-account` call includes all 4 new fields. |
| Checkout-before-signup | `applySignupAttribution()` extraction test — new profile gets both first-touch and signup-touch written from the same first-ever touch. |
| Email retargeting (purchase-touch ≠ first-touch) | `applySignupAttribution()` test with genuinely different first-touch vs. signup-touch values (never conflated); `logCheckoutAttempt()` test proving purchase-touch is captured independently per attempt; SQL harness assertion 5. |
| Duplicate Stripe webhook delivery | Static source scan — every `checkout_session_attempts` `.update()` in `stripe-webhook/index.ts` only sets lifecycle fields, never `utm_*`/referrer/click_ids; zero `.insert()` calls against that table from the webhook. |

**Full suite**: `cd portal && npx vitest run` → **296/296 passing**, 21 test files, **no regressions** (baseline before this task was unaffected; +17 new tests, 0 removed).

## 5. Deployment verification steps (for whoever approves the production migration)

1. Re-run `test/sql/v156_attribution_harness.sql` against a fresh local Postgres one more time immediately before applying (`sudo -u postgres psql -d <fresh db> -f test/sql/v156_attribution_harness.sql`) to confirm no drift since this report.
2. Apply `portal/supabase-portal-schema-v156-acquisition-attribution-repair.sql` via `mcp__Supabase__apply_migration` (or the Supabase dashboard) against the `ApexAdvantage` project.
3. Run `mcp__Supabase__get_advisors` (security) immediately after — matches this repo's standard post-migration check for every prior schema change.
4. Spot-check `canonical_paid_transaction_attribution` returns the same row count as `verified_purchases` in production (`select count(*) from verified_purchases; select count(*) from canonical_paid_transaction_attribution;` — must match).
5. Deploy the 2 updated edge functions (`create-free-account`, `create-checkout-session`) via `mcp__Supabase__deploy_edge_function`.
6. Deploy the 6 updated static site pages (whatever this repo's normal static-site deploy path is — unchanged by this task).
7. As a real (disposable) test account: sign up with `?fbclid=test123` in the URL and no `utm_*`, confirm `profiles.first_touch_click_ids`/`first_touch_referrer` populate; sign up via a one-step checkout and confirm `signup_touch_*` populates distinctly from `signup_utm_*`.
8. Once comfortable, run `select public.generate_attribution_backfill_proposals();` as an admin and review the proposals table — **do not bulk-apply them** without reading each one's `reasoning`/`confidence`; this is a human review step by design.

## 6. What this task deliberately did not touch

- The 5 existing Marketing & Funnel RPCs from v153 — out of scope; already correct for what they report.
- `stripe-webhook/index.ts` — no changes needed (verified safe by inspection, see §2).
- Any existing `signup_utm_*`/`last_touch_*`/`first_touch_landing_page`/`first_touch_at` column or value — never overwritten, never backfilled automatically.
