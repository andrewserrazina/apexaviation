# Analytics Event Dictionary

Source of truth for every custom event this codebase fires, client or
server, and what it actually means. Written alongside the analytics
reliability pass (GA4 purchase dedup, `portal_first_login` fix,
`EVENT_ALLOWLIST` reconciliation, Marketing & Funnel dashboard — see
`portal/supabase-portal-schema-v83.sql`) specifically so raw event counts
never get misread again the way `portal_first_login`'s ~11.5-events-per-user
GA4 reading did.

Every entry below was verified against a real call site in the code, not
carried forward from an older list — see "Trigger" for the exact file/
function. "Destinations" uses: **GA4** (`gtag('event', ...)`), **Meta**
(Meta Pixel, `fbq`), **DB** (first-party `analytics_events` table, which is
what the Marketing & Funnel dashboard and `portal/src/pages/Analytics.jsx`
actually query — see `ANALYTICS_MAINTENANCE_NOTES.md` for why GA4 itself is
never queried directly for either dashboard).

## How to read "Expected frequency"

This is the check against misreading raw counts. If GA4 (or the internal
`analytics_events` table) ever shows a number wildly outside what's listed
here, that's a signal something's firing wrong — the way `portal_first_login`
firing ~11.5x/user was cause, not typo, for the previous audit.

---

## Custom funnel events (via `apexTrack()`, `site/analytics-events.js`)

Every event below goes to **GA4 + Meta (custom) + DB** in one call, with
`traffic_source`/`traffic_medium`/`campaign`/`device_type` automatically
attached to every one (see `utmProps()`). Properties listed are *in
addition to* those automatic ones.

### `landing_page_viewed`
**Trigger:** Page load on `apex-advantage-private-pilot.html`,
`apex-advantage.html`, `checkride-prep.html`.
**Properties:** `product` (`ground_school_private_pilot` / `apex_advantage_portal` / `checkride_prep`), `price` (checkride-prep only).
**Expected frequency:** ~1 per visit to one of these pages (can repeat per visit, not deduped).

### `pricing_viewed`
**Trigger:** Pricing section scrolls into view (IntersectionObserver, `threshold: 0.4`) on `checkride-prep.html`. Fires once per page load.
**Properties:** `product: 'checkride_prep'`.
**Expected frequency:** ≤1 per page load.

### `registration_started`
**Trigger:** "Create account" CTA clicked — `apex-advantage.html`'s free-account section, or `portal-login.html`'s Checkride Prep signup form's first interaction.
**Properties:** `location`, `product` (portal-login.html only).
**Expected frequency:** ~1 per person who begins a signup attempt.

### `registration_completed`
**Trigger:** Signup form successfully creates an account — `portal-login.html`'s free-account handler and both instant-access (Checkride Prep / Ground School Pack) handlers.
**Properties:** `product`, `checkride_timing`, `profile_id`, `checkout_step` (instant-access paths only).
**Expected frequency:** Exactly 1 per real account created (each path creates at most one account; a 409 "already exists" response never reaches this line).

### `product_preview_viewed`
**Trigger:** Product-screenshots section scrolls into view on `checkride-prep.html`; opening a locked-widget preview (`upgrade_prompt`-adjacent, portal-stable.js `product_preview_viewed` calls); viewing a Ground School class row; viewing the GS calendar on `apex-advantage-private-pilot.html`.
**Properties:** `product` (`checkride_prep` / `ground_school` / `ground_school_class`), `class_id` (Ground School only).
**Expected frequency:** Can repeat per session — this is an interest/preview signal, not a one-time milestone.

### `checkout_started`
**Trigger:** Any checkout entry point clicked — Ground School class reserve form, Ground School Pack unlock, Checkride Prep "Unlock Now"/CTA, Checkride Prep instant-access redirect-to-Stripe step.
**Properties:** `product`, `checkout_step` (`cta_click` / `redirect_to_stripe`), `location`, `price`/`value`, `purchase_type` (Ground School: `single_class`).
**Expected frequency:** ~1–2 per real checkout attempt (a purchase's own flow can log this at both the CTA-click and redirect-to-Stripe steps — see `checkout_step`).

### `purchase_completed`
**Trigger:** A verified success-redirect URL param, confirmed against the real purchase/profile record — see `site/portal-stable.js`'s four post-Stripe-redirect blocks (`?unlocked=1`, `?registered=1`, `?mockoral=1`, `?groundschoolpack=1`) plus the two "instant access" registration-completed paths.
**Properties:** `product` (`checkride_prep` / `membership` / `ground_school_class` / `ground_school_pack` / `mock_oral`), `price` (the real charged amount, never a guessed static value), `session_id` (the Stripe Checkout Session id — added alongside the GA4 dedupe fix so this event and GA4's own `purchase` event can be cross-checked for duplicates), `tier` (membership only).
**Destinations note:** the parallel GA4 Enhanced Ecommerce `purchase` event (see below) is a *separate* `gtag()` call, not fired via `apexTrack()` — both exist and both should agree in count.
**Expected frequency:** Exactly 1 per real transaction. Each call site is guarded by a `localStorage` key scoped to the Stripe `session_id`, so a page refresh/bfcache restore of the same success URL does not double-fire this specific event (unlike the historical GA4 `purchase` bug, which lacked this guard — see the dedicated GA4 Ecommerce `purchase` entry below).

### `ground_school_class_purchased`
**Trigger:** Fires alongside `purchase_completed` specifically for single-class Ground School purchases (`?registered=1` redirect).
**Properties:** `price`.
**Expected frequency:** Exactly 1 per single-class GS purchase — a subset/duplicate-by-design of `purchase_completed(product=ground_school_class)`, kept as its own name for continuity with the pre-existing GS growth funnel in `portal/src/pages/Analytics.jsx`.

### `early_access_cta_click`
**Trigger:** Checkout CTA clicked on `checkride-prep.html` while `window.cpEarlyAccessActive !== false` (the live-pricing script has confirmed the Aug 2026 Early Access promo price is showing).
**Properties:** `product`, `promotional_price`, `regular_price`, `deadline`, `location`.
**Expected frequency:** Additive to `checkout_started` on the same click, not a replacement — expect matching or near-matching counts to `checkout_started(product=checkride_prep)` while the promo is live.

### `ground_school_schedule_viewed`
**Trigger:** Class-schedule calendar renders on `apex-advantage-private-pilot.html` page load.
**Properties:** `product: 'ground_school_private_pilot'`.
**Expected frequency:** ~1 per page load.

### `ground_school_class_selected`
**Trigger:** Visitor clicks a specific class row/date in the schedule.
**Properties:** `class_id` / class metadata (see call site for exact shape).
**Expected frequency:** Can repeat per visit as someone browses multiple classes.

### `ground_school_reserve_form_opened`
**Trigger:** The "reserve seat" form modal is opened for a selected class.
**Expected frequency:** ~1 per real reservation attempt, can repeat if abandoned and reopened.

### `readiness_assessment_viewed`
**Trigger:** `readiness-assessment.html` page load.
**Properties:** UTM/source context (`getUtmAndSource()`).
**Expected frequency:** ~1 per visit.

### `readiness_assessment_started`
**Trigger:** The first question of the 20-question assessment begins.
**Properties:** `product: 'checkride_prep'`.
**Expected frequency:** ≤ viewed, ~1 per real attempt.

### `readiness_question_answered`
**Trigger:** Each of the 20 questions is answered.
**Properties:** `question_number`, `category`.
**Expected frequency:** Up to 20 per completed assessment — the one event in this dictionary expected to fire many times per user by design.

### `readiness_assessment_completed`
**Trigger:** The 20th question is answered and a score is computed.
**Expected frequency:** ≤1 per real completed assessment (a retake would count as a second legitimate completion, not a bug).

### `readiness_score_viewed`
**Trigger:** The score-reveal screen renders — fires twice per completion by design, once pre-email-gate and once post-gate.
**Properties:** `score`, `readiness_band`, `gated` (`true`/`false`).
**Expected frequency:** ~2 per completed assessment (one `gated:true`, one `gated:false`) — not a duplicate.

### `readiness_signup_started` / `readiness_signup_completed`
**Trigger:** The post-score email-gate form is opened / submitted successfully.
**Properties:** `mode` (`login` / `signup`).
**Expected frequency:** ~1 each per real gate interaction.

### `readiness_checkride_prep_clicked`
**Trigger:** The "Unlock Checkride Prep" CTA is clicked from the results screen.
**Properties:** `score`, `readiness_band`.
**Expected frequency:** ~1 per real click-through; this is the event the Readiness → Checkride Prep purchase-conversion KPI is built on (see `get_readiness_funnel_stats()`, v83).

### `portal_activation_cta_viewed` / `portal_activation_cta_clicked`
**Trigger:** The "your class is booked, activate your account" banner is shown / clicked on `portal-login.html`, for a Ground School purchaser who hasn't yet created a portal account.
**Expected frequency:** ~1 each per real GS purchaser landing on that screen.

### `checkride_prep_upgrade_deeplink_viewed` / `checkride_prep_upgrade_modal_opened`
**Trigger:** A member arrives on the portal via `?upgrade=checkride-prep` (`enforceUpgradeDeepLink()`, `site/portal-stable.js`); the second fires when that same deep link auto-opens the unlock modal.
**Expected frequency:** ~1 each per real deep-link visit.

### `content_deeplink_topic_matched`
**Trigger:** A `?topic=` deep link successfully matches a known content category.
**Properties:** `topic`, `category`.
**Expected frequency:** ~1 per matched deep-link visit.

### `portal_first_login`
**Trigger:** The FIRST time a profile ever successfully claims `claim_first_portal_login()` (an atomic, single-conditional-UPDATE Postgres RPC — see `supabase-portal-schema-v83.sql`). Called from `checkLifecycleMilestones()` on every dashboard render, but the RPC itself guarantees the tracking side-effect only actually runs on the one call, across every tab/device/browser, that wins the claim.
**Properties:** `profile_id`.
**Expected frequency:** Exactly 1 per profile, for the lifetime of that profile. **This was the event confirmed firing ~11.5x/user before this fix** — the old implementation decided "is this the first login" from an in-memory flag seeded by a non-atomic SELECT-then-INSERT against `portal_events`, which two tabs/devices for the same profile could both pass before either INSERT landed. If this ever again shows meaningfully more than 1 event per profile going forward, that's a real regression, not measurement noise.

### `first_lesson_started` / `first_lesson_completed`
**Trigger:** The AI DPE Practice section is opened for the first time in a session / a member's first DPE question is marked studied and its confirmation email sends.
**Properties:** `profile_id`, `feature` (`ai_dpe_practice`, `first_lesson_started` only).
**Expected frequency:** `first_lesson_completed` ≤1 per profile ever (guarded by `loggedEventTypes['first_question_completed']`, a `portal_events`-seeded flag — same category of guard `portal_first_login` used to rely on, currently believed reliable for this lower-stakes event but not migrated to the atomic-claim pattern in this pass). `first_lesson_started` is a per-session interest signal, not a lifetime-once milestone, so it can repeat.

### `onboarding_training_goal_saved` / `onboarding_focus_area_saved` / `onboarding_first_training_started`
**Trigger:** Each step of the new-member welcome-onboarding wizard (`showWelcomeOnboarding()`) is completed. Only ever shown once per profile now that it's gated behind the same atomic `portal_first_login` claim.
**Properties:** `training_stage` / `primary_focus_area` / `task`.
**Expected frequency:** ≤1 each per profile.

### `upgrade_prompt_viewed` / `upgrade_prompt_clicked`
**Trigger:** A locked-widget upgrade prompt scrolls into view / is clicked anywhere in the portal.
**Properties:** `widget` (the locked-widget's identifier).
**Expected frequency:** Can repeat per session — a free member may see/click this many times before ever converting.

### `activation_email_1_clicked` … `activation_email_4_clicked`
**Trigger:** The arriving page's URL still carries `utm_campaign=new_member_activation&utm_content=welcome_N`, checked once on load in `portal-stable.js`'s activation-email click-tracking IIFE.
**Expected frequency:** ≤1 per email per profile (a member could click the same email link twice across two page loads, which would double-count — a known, accepted limitation, not something this pass fixes).

---

## Meta-only standard events (via `apexTrackStandard()`) — never reach GA4 or the DB

Deliberately separate from the funnel system above: Meta's Ads Manager
conversion picker expects these exact standard names, and `apexTrack()`
already logs the equivalent funnel-shaped event for first-party reporting,
so there is no `analytics_events` row for any of these.

| Event | Trigger |
|---|---|
| `ViewContent` | Landing on `checkride-prep.html`; opening the Checkride Prep widget preview in the portal |
| `InitiateCheckout` | Every checkout entry point (GS class, GS full pack, Checkride Prep, Mock Oral, GS upgrade) |
| `Lead` | Free-account signup submitted |
| `CompleteRegistration` | First-ever portal login (same atomic claim as `portal_first_login`) |
| `Purchase` | Same four success-redirects as `purchase_completed`, deduped by its own `session_id`-keyed `localStorage` guard — kept independent of `apexTrack()` specifically so this dedupe logic can never be accidentally shared/broken by a change to the custom-event system |

---

## Legacy direct `gtag()` calls — GA4 only, bypass `apexTrack()` entirely

Kept for continuity with pre-existing GA4 history/reports (see the comment
in `site/checkride-prep.html`) — not a bug, but these have **no first-party
row** in `analytics_events`, so the Marketing & Funnel dashboard cannot see
them and substitutes the nearest `apexTrack()` equivalent where one exists
(documented per-section in the dashboard itself).

| Event | Trigger | First-party stand-in used by the dashboard |
|---|---|---|
| `checkride_prep_page_view` | Page load, `checkride-prep.html` | `landing_page_viewed(product=checkride_prep)` |
| `checkride_prep_cta_click` / `checkride_prep_checkout_start` | Primary CTA clicked (fires both) | `checkout_started(product=checkride_prep, checkout_step=cta_click)` |
| `checkride_prep_secondary_cta_click` | Secondary/anchor-jump CTA clicked | none |
| `dpe_questions_page_view` | Page load, `dpe-questions.html` | none |
| `dpe_questions_cta_click` | CTA clicked | none |
| `lead_gen_download_page_view` | Page load, `checkride-guide-download.html` | none |
| `ground_school_cta_click` | Any GS CTA click (hero, class row, view-toggle tab) | `checkout_started(product=ground_school_class)` for the reservation path |
| `sign_up` (GA4 standard event) | Account created, `portal-login.html` | `registration_completed` |

---

## GA4 Enhanced Ecommerce `purchase`

A **separate** `gtag('event', 'purchase', ...)` call from `purchase_completed`
above — same four success-redirect blocks in `site/portal-stable.js`, fired
alongside (not instead of) `purchase_completed`.

**Properties:** `transaction_id` (the Stripe Checkout Session id — added in
this pass; previously absent, see below), `currency`, `value`, `items[]`
(`item_name`, `item_variant` where applicable, `price`, `quantity`).

**Expected frequency:** Exactly 1 per real transaction — enforced two ways
as of this pass: (1) a `localStorage` guard keyed on the same Stripe
session id used everywhere else on that success page, and (2) GA4's own
server-side de-duplication of ecommerce events sharing a `transaction_id`
within a property. **Before this pass, this call had neither** — no
`transaction_id` at all and no dedupe guard, unlike the Meta/`apexTrack`
calls sitting right next to it on the same success page — so a refresh or
back-forward-cache restore of a `?unlocked=1`/`?registered=1`/`?mockoral=1`/
`?groundschoolpack=1` URL could log the same sale's revenue to GA4 a second
(or Nth) time. **Historical GA4 revenue totals recorded before this fix may
still be inflated and were not and cannot be retroactively corrected** —
use the Marketing & Funnel dashboard's Revenue section (sourced from
`purchase_completed`'s own verified `price` property) for anything that
needs to be trustworthy.

---

## Server-side-only events — logged directly to `analytics_events`, no browser involved

No `apexTrack()` call exists for any of these; they're inserted directly
by Supabase Edge Functions (`create-free-account`, `send-lifecycle-emails`)
running on a cron/webhook, so they never reach GA4 or Meta at all.

| Event | Trigger |
|---|---|
| `seven_day_active_user` | Daily cron finds a profile active 7+ days after signup |
| `checkout_abandoned` | Daily cron finds a started-but-never-completed checkout session (`checkout_session_attempts`, no matching completion) |
| `activation_email_1_sent` … `_4_sent` | Each step of the new-member activation email sequence is sent — the server-side half of the `activation_email_N_clicked` events above |

---

## GA4 automatic events — not custom, not in `EVENT_ALLOWLIST` by design

`page_view` fires on every one of the ~204 pages carrying the base
`gtag.js` snippet, automatically, on `gtag('config', ...)` — no custom code
involved. GA4's Enhanced Measurement features (scroll, outbound clicks,
file downloads, site search) are a property-level toggle in GA4 Admin, not
something this codebase configures — see `ANALYTICS_MAINTENANCE_NOTES.md`
for the manual checklist.
