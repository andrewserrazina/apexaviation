// Creates Stripe Checkout Sessions for the Apex Advantage portal.
//
// Portal signup itself is free (see create-free-account). This function
// handles the things that actually cost money after (or during) signup:
//
//   purpose: 'unlock-checkride-prep'
//     An already-signed-in free member unlocking the Checkride Prep
//     System (DPE library, scenarios, progress tracking, etc). Priced
//     via get_checkride_prep_pricing() -- a permanent $29 as of v158,
//     decided server-side (never trusted from the client) so a future
//     price change still only needs to touch that one function. Requires
//     the caller's Supabase access token so we know *which* profile to
//     unlock; never trust a client-supplied id.
//
//   purpose: 'join-membership'
//     An already-signed-in member starting the Apex Advantage Membership
//     subscription ($19/mo or $190/yr, body.tier: 'monthly' | 'annual',
//     no trial). mode: 'subscription', unlike every other purpose here --
//     see stripe-webhook for how the resulting subscription lifecycle
//     (renewals, cancellation, failed payments) is tracked in
//     member_subscriptions. Rejects if the caller already has a
//     non-canceled subscription rather than silently creating a second one.
//
//   purpose: 'signup-and-unlock-checkride-prep'
//     One-step "Get Instant Access" signup: creates the free account
//     (same logic as create-free-account) AND starts a Checkride Prep
//     checkout in a single request, for a visitor who already knows they
//     want it rather than making them come back later from the
//     dashboard. Priced the same permanent $29 as the unlock-checkride-
//     prep branch above, via the same get_checkride_prep_pricing() call.
//     No auth
//     token available yet (the account doesn't have a password set) --
//     the new profile id comes directly from auth.admin.createUser's
//     result, not from a client-supplied value.
//
//   purpose: 'ground-school-registration'
//     CLOSED (Oct 2026) -- Group Ground School is fully discontinued,
//     replaced by Private Instruction (see 'book-private-instruction'
//     below). This purpose now always returns a 410; the registration
//     logic it used to run was removed rather than left dead, since it
//     can never execute again. stripe-webhook's handleGroundSchoolRegistration
//     is deliberately left in place to finish processing any checkout
//     session created in the brief window before this closed, up to
//     Stripe's ~24h session expiry.
//
//   purpose: 'book-mock-oral'
//     An already-signed-in member booking a $99 60-minute Mock Oral.
//     Requires the caller's Supabase access token, same as
//     unlock-checkride-prep -- a mock oral is a 1:1 session against an
//     instructor's calendar, not a fixed class slot, so payment just
//     creates a request row (handled in stripe-webhook) for admin to
//     actually schedule a time with the student.
//
//   purpose: 'book-mock-oral-v2'
//     Apex Advantage Mock Orals (the $129/2-hour ACS-based product,
//     distinct from the older $99/60-minute 'book-mock-oral' request
//     queue above). Requires the caller's access token, an active
//     mock_oral_products row (productId), and an OPEN mock_oral_
//     availability slot (availabilityId) -- price is read from the
//     product row, never trusted from the client. The slot is NOT
//     marked 'booked' here: that only happens inside stripe-webhook's
//     handler, via a single atomic conditional UPDATE, which is what
//     actually makes double-booking impossible. The open-status check
//     here is just an early, non-atomic UX check so a student doesn't
//     even reach Stripe for a slot someone else just took.
//
//   purpose: 'signup-and-book-mock-oral-v2'
//     One-step version of 'book-mock-oral-v2' for a visitor with no Apex
//     Advantage account -- creates the free account (same as
//     signup-and-unlock-checkride-prep) and starts the same Stripe
//     Checkout in one request, so a guest can pick a product + open slot
//     on the public apex-advantage-mock-oral.html page and pay without a
//     separate signup step first. The resulting Stripe session's
//     metadata.purpose is still 'book-mock-oral-v2' -- stripe-webhook
//     doesn't need to know or care whether the account existed already.
//
//   purpose: 'book-private-instruction'
//     Apex Advantage Private Instruction -- flat $55/hour 1-on-1 time
//     with an instructor (ground school content, checkride prep, oral
//     prep, whatever the student needs that hour), open to every
//     certificate level. Requires the caller's access token and an OPEN
//     private_instruction_availability slot (availabilityId) -- no
//     productId, since there's a single flat rate (PRIVATE_INSTRUCTION_
//     RATE_CENTS), not a catalog. Same "non-atomic early UX check here,
//     the real atomic claim happens in stripe-webhook" pattern as
//     book-mock-oral-v2.
//
//   purpose: 'signup-and-book-private-instruction'
//     One-step version of 'book-private-instruction' for a visitor with
//     no Apex Advantage account, mirroring signup-and-book-mock-oral-v2
//     exactly. The resulting Stripe session's metadata.purpose is still
//     'book-private-instruction'.
//
//   purpose: 'unlock-study-pack'
//     Apex Advantage Study Packs -- generic engine, Airspace Mastery
//     ($19, lifetime) is Pack #1. Requires the caller's access token;
//     price is resolved server-side from the study_packs row (never
//     trusted from the client). See supabase-portal-schema-v99.sql for
//     the entitlement/content-versioning model and
//     get-study-pack-content for the protected-content read path.
//
//   purpose: 'unlock-ground-school-pack' / 'upgrade-ground-school-pack' /
//   'signup-and-unlock-ground-school-pack'
//     CLOSED (Oct 2026), same as 'ground-school-registration' above --
//     all three $400-pack variants (direct unlock, credited upgrade from
//     prior per-class payments, and one-step guest signup) always return
//     a 410 now. stripe-webhook's handleUnlockGroundSchoolPack/
//     handleUpgradeGroundSchoolPack are deliberately left in place for
//     the same already-in-flight-session reason noted above.
//
// Env vars required (set as Supabase Edge Function secrets):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)
//   SITE_ORIGIN               (used for the welcome-email action link,
//                              same var create-free-account already uses)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// `?target=denonext`, not `?target=deno` -- the latter pulls in esm.sh's
// legacy Node-compat shim, which calls the internal `Deno.core.
// runMicrotasks()` API. That API doesn't exist in the Supabase Edge
// Runtime (it's Deno-based but not vanilla Deno), so every invocation
// crashed with "Deno.core.runMicrotasks() is not supported in this
// environment" before the handler ever ran -- confirmed via the actual
// function logs. `denonext` is esm.sh's build target for this exact
// runtime and doesn't hit that code path.
import Stripe from 'https://esm.sh/stripe@14?target=denonext'

// Inlined (not imported from ../_shared/emailTemplate.ts) because the
// Supabase deploy path used for this function cannot resolve a relative
// import that reaches outside this function's own directory. Must be
// kept byte-identical to _shared/emailTemplate.ts's own emailTemplate()
// export -- create-free-account is the only function that still imports
// it normally (stripe-webhook and send-lifecycle-emails also carry their
// own forced-inline copies, same reason). See that file's own header
// comment for the design-system rationale (navy header / white body /
// solid-hex text / square CTA corners) and the note that no design-
// manual .docx exists anywhere in this repo.
//
// Audit note: this fifth copy of the shell (alongside _shared/
// emailTemplate.ts itself and the forced-inline copies in
// stripe-webhook/index.ts) was found during the email-system audit --
// it predates that audit and was not previously listed in that "must be
// kept byte-identical" comment anywhere else. Updated here in the same
// pass as the other two so all three stay in sync.
function emailTemplate(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E5E7EB;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1F3A;">
      <tr><td align="center" style="padding:28px 16px;">
        <img src="https://apexaviationtx.com/apexwhite.png" alt="Apex Advantage" width="160" style="display:block;margin:0 auto 10px;height:auto;max-width:160px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:2px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">APEX ADVANTAGE</div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 24px 8px;">
        ${content}
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:20px 24px 28px;border-top:1px solid #E5E7EB;margin-top:12px;">
        <p style="font-size:12px;color:#4B5563;margin:16px 0 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Apex Aviation &middot; Austin, TX</p>
        <p style="font-size:11px;margin:0 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com" style="color:#4B5563;text-decoration:underline;">apexaviationtx.com</a>
        </p>
        <p style="font-size:11px;margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com/email-preferences.html" style="color:#4B5563;text-decoration:underline;">Manage email preferences</a>
        </p>
      </td></tr>
    </table>
  </div>
</body></html>`
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://apexaviationtx.com'

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const MOCK_ORAL_PRICE_CENTS = 9900 // $99 per 60-minute mock oral
const PRIVATE_INSTRUCTION_RATE_CENTS = 5500 // $55 per 1-hour Private Instruction slot (flat rate, all certificate levels)

// Apex Advantage Membership pricing -- $19/mo or $190/yr (roughly two
// months free annually), no trial. Built as inline recurring price_data
// rather than pre-created Stripe Price objects, same reasoning as the
// Checkride Prep pricing above: nothing here depends on the Stripe
// dashboard having specific Price IDs configured, which matters since
// this repo has no Stripe account access to create them.
const MEMBERSHIP_PRICE_CENTS: Record<'monthly' | 'annual', number> = { monthly: 1900, annual: 19000 }
const MEMBERSHIP_INTERVAL: Record<'monthly' | 'annual', 'month' | 'year'> = { monthly: 'month', annual: 'year' }

// Must match the check constraint on profiles.checkride_timing
// (supabase-portal-schema-v39.sql).
const CHECKRIDE_TIMINGS = ['within_14_days', 'within_30_days', 'within_60_days', 'more_than_60_days', 'not_scheduled']

type PricingRow = { tier: string; amount_cents: number; founding_seats_remaining: number; launch_expires_at: string | null }

function tierDescription(tier: string): string {
  if (tier === 'founding') return 'Founding pilot pricing — locked in for the first 25 members'
  if (tier === 'launch') return 'New-member fast-action pricing — locked in within 48 hours of signup'
  return 'Full access to the Checkride Prep System inside your member portal'
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Escapes ilike's own wildcard characters so a case-insensitive *exact*
// match on unauthenticated, client-supplied email actually only matches
// that literal email -- without this, a caller submitting `%` or `_` in
// the email field turns the duplicate-registration check below into a
// SQL LIKE pattern, letting them match (and get wrongly blocked as
// "already registered" against) an unrelated existing row instead of
// their own literal address.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}

// Attribution audit (Oct 2026): signup_utm_source/checkout_session_
// attempts.utm_source was fragmenting one real channel across several
// differently-spelled/differently-cased values depending on which ad/
// landing page tagged the click -- 'facebook', 'fb', 'meta', and
// 'FACEBOOK' all meaning the same ad platform, 'ig' vs 'instagram' the
// same thing. That silently understated each real channel's own
// conversion rate in any query grouping by source (several rows instead
// of one). sanitizeUtm() below lowercases every source value for this
// same reason (casing alone was already fragmenting sources with no
// alias at all), then this map additionally collapses known SAME-
// PLATFORM alias spellings on top of that. Never touches `medium`
// (paid_social vs social is a real, meaningful distinction, not an
// alias) -- an unrecognized source is still stored, just lowercased,
// never dropped or guessed at. Duplicated in create-free-account/
// index.ts -- no shared module between these two functions today, same
// reasoning as this file's own emailTemplate()/escapeIlike() duplicates.
const UTM_SOURCE_ALIASES: Record<string, string> = {
  fb: 'facebook',
  meta: 'facebook',
  ig: 'instagram',
}

// Latest-touch UTM as of this specific checkout attempt
// (supabase-portal-schema-v58.sql) -- untrusted client input (the
// browser's own localStorage, forwarded in the request body), so it's
// capped and character-restricted rather than trusted outright. Dropped
// silently if malformed; UTM data is attribution, never something a
// checkout should fail over.
function sanitizeUtm(utm: any): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const val = utm && typeof utm === 'object' ? utm[key] : null
    out[key] = typeof val === 'string' && /^[\x20-\x7e]{1,200}$/.test(val) ? val : null
  }
  if (out.source) {
    const lowered = out.source.toLowerCase()
    out.source = UTM_SOURCE_ALIASES[lowered] || lowered
  }
  return out
}

// document.referrer, forwarded by analytics-events.js -- a genuine
// channel signal independent of UTM params (a visitor arriving from an
// unlabeled Facebook post or a Google organic result carries no utm_*,
// but still has a referrer). Same untrusted-client-input treatment as
// sanitizeUtm(): capped length, printable-ASCII only, dropped silently
// if malformed rather than failing the checkout.
function sanitizeReferrer(ref: any): string | null {
  return typeof ref === 'string' && /^[\x20-\x7e]{1,1000}$/.test(ref) ? ref : null
}

// Ad-platform click IDs (fbclid/gclid/msclkid/ttclid/gbraid/wbraid) --
// present on paid-ad clicks even when the destination URL carries no
// utm_* params at all (several of this platform's own ad templates omit
// them). Stored as jsonb; each value is validated independently so one
// malformed id doesn't drop the others.
const CLICK_ID_KEYS = ['fbclid', 'gclid', 'msclkid', 'ttclid', 'gbraid', 'wbraid']
function sanitizeClickIds(clickIds: any): Record<string, string> | null {
  if (!clickIds || typeof clickIds !== 'object') return null
  const out: Record<string, string> = {}
  for (const key of CLICK_ID_KEYS) {
    const val = clickIds[key]
    if (typeof val === 'string' && /^[\x20-\x7e]{1,300}$/.test(val)) out[key] = val
  }
  return Object.keys(out).length > 0 ? out : null
}

// The "signup-and-unlock-*" purposes below create a brand-new profile as
// part of a one-step checkout (no separate create-free-account call at
// all), which meant every account created this way had signup_utm_*
// permanently null -- first-touch attribution for anyone who signed up
// straight into a purchase (arguably the highest-intent signups of all)
// was silently dropped. Mirrors create-free-account/index.ts's own
// signup_utm_*/first_touch_*/last_touch_* write, just reusable across
// both branches below instead of duplicated inline.
// referrerFirst/clickIdsFirst/firstTouchAnonId/signupTouch are the newer
// acquisition-attribution-repair fields (profiles.first_touch_referrer/
// first_touch_click_ids/first_touch_anon_id/signup_touch_* --
// supabase-portal-schema-v156.sql). signupTouch captures whichever touch
// was active at this exact moment of account creation -- distinct from
// first-touch (the visitor's very first ever recorded touch, which may be
// an earlier, different session) and never conflated with it below.
async function applySignupAttribution(supabase: any, profileId: string, utmFirst: any, firstTouchLanding: any, referrerFirst?: any, clickIdsFirst?: any, firstTouchAnonId?: any, signupTouch?: any) {
  const safeUtm = sanitizeUtm(utmFirst)
  const hasUtm = Object.values(safeUtm).some((v) => v !== null)
  const landingPage = firstTouchLanding && typeof firstTouchLanding.landing_page === 'string' ? firstTouchLanding.landing_page.slice(0, 500) : null
  const touchAt = firstTouchLanding && typeof firstTouchLanding.at === 'string' ? firstTouchLanding.at : null

  const safeReferrerFirst = sanitizeReferrer(referrerFirst)
  const safeClickIdsFirst = sanitizeClickIds(clickIdsFirst)
  const safeFirstTouchAnonId = typeof firstTouchAnonId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(firstTouchAnonId) ? firstTouchAnonId : null

  const safeSignupTouchUtm = sanitizeUtm(signupTouch)
  const hasSignupTouchUtm = Object.values(safeSignupTouchUtm).some((v) => v !== null)
  const safeSignupTouchReferrer = sanitizeReferrer(signupTouch && signupTouch.referrer)
  const safeSignupTouchClickIds = sanitizeClickIds(signupTouch && signupTouch.click_ids)
  const signupTouchLandingPage = signupTouch && typeof signupTouch.landing_page === 'string' ? signupTouch.landing_page.slice(0, 500) : null
  const signupTouchAt = signupTouch && typeof signupTouch.at === 'string' ? signupTouch.at : null
  const hasSignupTouch = hasSignupTouchUtm || !!safeSignupTouchReferrer || !!safeSignupTouchClickIds || !!signupTouchLandingPage

  if (!hasUtm && !landingPage && !safeReferrerFirst && !safeClickIdsFirst && !safeFirstTouchAnonId && !hasSignupTouch) return
  await supabase.from('profiles').update({
    ...(hasUtm ? {
      signup_utm_source: safeUtm.source, signup_utm_medium: safeUtm.medium, signup_utm_campaign: safeUtm.campaign,
      signup_utm_content: safeUtm.content, signup_utm_term: safeUtm.term,
      last_touch_source: safeUtm.source, last_touch_medium: safeUtm.medium, last_touch_campaign: safeUtm.campaign,
      last_touch_content: safeUtm.content, last_touch_term: safeUtm.term,
    } : {}),
    ...(landingPage ? { first_touch_landing_page: landingPage, last_touch_landing_page: landingPage } : {}),
    ...(touchAt ? { first_touch_at: touchAt, last_touch_at: touchAt } : {}),
    ...(safeReferrerFirst ? { first_touch_referrer: safeReferrerFirst } : {}),
    ...(safeClickIdsFirst ? { first_touch_click_ids: safeClickIdsFirst } : {}),
    ...(safeFirstTouchAnonId ? { first_touch_anon_id: safeFirstTouchAnonId } : {}),
    ...(hasSignupTouchUtm ? {
      signup_touch_source: safeSignupTouchUtm.source, signup_touch_medium: safeSignupTouchUtm.medium,
      signup_touch_campaign: safeSignupTouchUtm.campaign, signup_touch_content: safeSignupTouchUtm.content,
      signup_touch_term: safeSignupTouchUtm.term,
    } : {}),
    ...(safeSignupTouchReferrer ? { signup_touch_referrer: safeSignupTouchReferrer } : {}),
    ...(safeSignupTouchClickIds ? { signup_touch_click_ids: safeSignupTouchClickIds } : {}),
    ...(signupTouchLandingPage ? { signup_touch_landing_page: signupTouchLandingPage } : {}),
    ...(signupTouchAt ? { signup_touch_at: signupTouchAt } : {}),
  }).eq('id', profileId)
}

// Logs every Checkout Session this function creates, regardless of
// purpose -- the source of truth send-lifecycle-emails' abandoned-
// checkout recovery job reads from. stripe-webhook stamps completed_at
// when (if) the session actually completes; a row with no completed_at
// after a while is what "abandoned" means. Best-effort: a logging
// failure here must never block the checkout itself.
async function logCheckoutAttempt(supabase: any, args: { stripeSessionId: string; purpose: string; email?: string | null; profileId?: string | null; amountCents: number; utm?: any; referrer?: any; clickIds?: any }) {
  try {
    const safeUtm = sanitizeUtm(args.utm)
    // referrer/click_ids here are the purchase-touch signal -- whichever
    // touch was active at the moment of THIS checkout attempt, captured
    // per-attempt rather than overwriting any profile-level column, so a
    // later purchase by an email-retargeted return visitor is never
    // mislabeled as that visitor's first-touch.
    await supabase.from('checkout_session_attempts').insert({
      stripe_session_id: args.stripeSessionId,
      purpose: args.purpose,
      email: args.email ?? null,
      profile_id: args.profileId ?? null,
      amount_cents: args.amountCents,
      utm_source: safeUtm.source,
      utm_medium: safeUtm.medium,
      utm_campaign: safeUtm.campaign,
      utm_content: safeUtm.content,
      utm_term: safeUtm.term,
      referrer: sanitizeReferrer(args.referrer),
      click_ids: sanitizeClickIds(args.clickIds),
    })
  } catch (err) {
    console.error('logCheckoutAttempt failed', err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // Readiness-funnel instrumentation audit: a Stripe API failure (network
  // error, invalid params, a Stripe-side outage) inside any purpose branch
  // below previously left ZERO trace anywhere server-side -- the only
  // signal was the client's own best-effort checkout_session_create_failed
  // event (site/portal-stable.js), which depends on the browser actually
  // reaching window.apexSupabase after the fetch has already failed.
  // checkoutFailurePurpose is captured here (not deeper inside a branch) so
  // the catch block below can log *something* identifying even if the
  // request body itself failed to parse.
  let checkoutFailurePurpose: string | undefined

  try {
    const body = await req.json()
    const purpose = body.purpose
    checkoutFailurePurpose = typeof purpose === 'string' ? purpose : undefined
    const siteOrigin = body.origin || 'https://apexaviationtx.com'

    if (purpose === 'unlock-checkride-prep') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email

      const { data: profile } = await supabase
        .from('profiles')
        .select('checkride_prep_unlocked')
        .eq('id', profileId)
        .maybeSingle()

      if (profile?.checkride_prep_unlocked) {
        return jsonError('Checkride Prep is already unlocked on this account', 400)
      }

      const { data: pricingRows, error: pricingError } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: profileId })
      if (pricingError) {
        // Never let a broken pricing RPC silently overcharge a member --
        // this used to fall back to standard ($49) with no trace of why,
        // masking real founding/launch-tier bugs as "the promo ended."
        console.error(`create-checkout-session: get_checkride_prep_pricing failed for profile ${profileId}`, pricingError)
        return jsonError('Could not determine pricing. Please try again in a moment.', 500)
      }
      const pricing: PricingRow = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 2900, founding_seats_remaining: 0, launch_expires_at: null }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        // Lets a customer enter any active Stripe Promotion Code on
        // Stripe's own hosted Checkout page -- no code is hardcoded or
        // validated here, Stripe handles that entirely, and
        // session.amount_total (read by stripe-webhook) already reflects
        // whatever discount was applied. See supabase-portal-schema-v55.sql
        // for why analytics/success-page code can no longer trust the
        // pre-discount amount_cents this function computes below.
        allow_promotion_codes: true,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Checkride Prep Unlock',
              description: tierDescription(pricing.tier),
            },
            unit_amount: pricing.amount_cents,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-checkride-prep', profile_id: profileId, tier: pricing.tier },
        success_url: `${siteOrigin}/portal.html?unlocked=1&amount_cents=${pricing.amount_cents}&session_id={CHECKOUT_SESSION_ID}#checkride-prep`,
        // checkout_cancelled=1&product=checkride_prep (Revenue Funnel +
        // Attribution Integrity sprint, Section 4/7) -- previously this
        // was the one bounce in the whole Checkride Prep flow with zero
        // analytics signal: "started checkout" (checkout_started, wired
        // up in site/portal-stable.js's unlockModalCta handler) and
        // "completed" (?unlocked=1) both fire something; backing out of
        // Stripe's hosted page fired nothing at all. Read by the IIFE
        // near the top of site/portal-stable.js.
        cancel_url: `${siteOrigin}/portal.html?checkout_cancelled=1&product=checkride_prep#dashboard`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'unlock-checkride-prep', email, profileId, amountCents: pricing.amount_cents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, tier: pricing.tier, amount: pricing.amount_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'join-membership') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email
      const tier = body.tier === 'annual' ? 'annual' : 'monthly'

      // Apex Advantage Membership isn't public yet -- admin-only preview
      // while the product is being finished, matching the portal.html/
      // portal-stable.js client-side gating (askAndrewNavItem, membershipCard,
      // enforceAskAndrewAccess()). This is the real enforcement; the client
      // hiding the Join buttons is just UX, not the security boundary.
      const { data: callerProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', profileId)
        .maybeSingle()
      if (callerProfile?.role !== 'admin') {
        return jsonError('Apex Advantage Membership is not available yet.', 403)
      }

      const { data: existingSub } = await supabase
        .from('member_subscriptions')
        .select('status')
        .eq('profile_id', profileId)
        .in('status', ['active', 'trialing', 'past_due'])
        .maybeSingle()
      if (existingSub) return jsonError('You already have an active Apex Advantage Membership', 400)

      const amountCents = MEMBERSHIP_PRICE_CENTS[tier]
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Membership',
              description: tier === 'annual' ? 'Annual membership — billed once a year' : 'Monthly membership — billed every month',
            },
            unit_amount: amountCents,
            recurring: { interval: MEMBERSHIP_INTERVAL[tier] },
          },
          quantity: 1,
        }],
        metadata: { purpose: 'join-membership', profile_id: profileId, tier },
        success_url: `${siteOrigin}/portal.html?membership=1&tier=${tier}&amount_cents=${amountCents}&session_id={CHECKOUT_SESSION_ID}#account`,
        cancel_url: `${siteOrigin}/portal.html#account`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'join-membership', email, profileId, amountCents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, tier, amount: amountCents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'signup-and-unlock-checkride-prep') {
      const { name, email, dest, checkride_timing, utm_first, first_touch_landing, click_ids_first, referrer_first, first_touch_anon_id, signup_touch } = body
      if (!name || !email) return jsonError('Missing required fields: name, email', 400)
      const safeCheckrideTiming = CHECKRIDE_TIMINGS.includes(checkride_timing) ? checkride_timing : null

      // Case-insensitive on purpose (bug sweep, Oct 2026) -- see
      // escapeIlike()'s own comment above, and the matching fix in
      // create-free-account/index.ts. This purpose's own sibling,
      // signup-and-book-mock-oral-v2 below, already used this correct
      // pattern; this one was the original, never backported.
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', escapeIlike(email))
        .maybeSingle()
      if (existingProfile) {
        return jsonError('An account with this email already exists. Sign in and unlock from your dashboard instead.', 409)
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { full_name: name },
      })
      if (createErr) return jsonError(String(createErr), 500)
      const newProfileId = created.user.id
      if (safeCheckrideTiming) {
        await supabase.from('profiles').update({ checkride_timing: safeCheckrideTiming }).eq('id', newProfileId)
      }
      await applySignupAttribution(supabase, newProfileId, utm_first, first_touch_landing, referrer_first, click_ids_first, first_touch_anon_id, signup_touch)

      // $29 is the permanent price (get_checkride_prep_pricing(), v158) --
      // this call is kept rather than hardcoding the amount so a future
      // price change still only needs to touch that one function.
      // Unlike the unlock-checkride-prep branch above, this doesn't abort
      // on a pricing error -- the free account was just created a few
      // lines up, so bailing out here would strand a real member with an
      // account but no way to check out. Falls back to the known-current
      // $29 (never silently overcharges), but still logs the error so a
      // real RPC bug doesn't go unnoticed.
      const { data: pricingRows, error: pricingError } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: newProfileId })
      if (pricingError) {
        console.error(`create-checkout-session: get_checkride_prep_pricing failed for new profile ${newProfileId}`, pricingError)
      }
      const pricing: PricingRow = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 2900, founding_seats_remaining: 0, launch_expires_at: null }

      // Same "set your password" email as create-free-account, sent
      // immediately rather than waiting on the Stripe webhook -- the
      // account is real and usable (for signing in, not yet for
      // Checkride Prep) the moment it's created, independent of whether
      // this checkout is ever completed.
      const safeDest = typeof dest === 'string' && /^[a-z0-9-]{1,60}$/.test(dest) ? dest : ''
      const redirectTo = `${SITE_ORIGIN}/portal-reset-password.html${safeDest ? `?dest=${safeDest}` : ''}`
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const actionLink = linkData?.properties?.action_link
      if (actionLink) {
        await supabase.functions.invoke('send-email', {
          body: {
            to: email,
            subject: 'Welcome to Apex Advantage — set your password',
            html: emailTemplate(`
              <h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
              <p style="color:#1F2937;font-size:15px;line-height:1.7;">Your account is ready and your Checkride Prep purchase is being processed. Set your password to get in:</p>
              <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
              <p style="color:#4B5563;font-size:13px;line-height:1.6;">Once that's done, sign in any time at apexaviationtx.com/portal-login.html — the full Checkride Prep System (DPE question bank, scenario training, progress tracking) will already be unlocked.</p>
            `),
          },
        })
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        // Same promo code support as the unlock-checkride-prep branch
        // above -- this is the same product (Checkride Prep Unlock),
        // just from the one-step signup entry point.
        allow_promotion_codes: true,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Checkride Prep Unlock',
              description: tierDescription(pricing.tier),
            },
            unit_amount: pricing.amount_cents,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-checkride-prep', profile_id: newProfileId, tier: pricing.tier },
        success_url: `${siteOrigin}/portal-login.html?view=signup-success&paid=1&amount_cents=${pricing.amount_cents}&session_id={CHECKOUT_SESSION_ID}`,
        // Same checkout_cancelled=1&product=checkride_prep marker as the
        // unlock-checkride-prep branch above -- read by the matching IIFE
        // in site/portal-login.html (this purpose's account already
        // exists but the member never signed in client-side, so this
        // lands here rather than portal.html).
        cancel_url: `${siteOrigin}/portal-login.html?view=signup-success&checkout_cancelled=1&product=checkride_prep`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'signup-and-unlock-checkride-prep', email, profileId: newProfileId, amountCents: pricing.amount_cents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, tier: pricing.tier, amount: pricing.amount_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Group Ground School (per-session $25, and the $400 full-pack unlock/
    // upgrade/guest-signup variants below) is fully discontinued --
    // replaced by Private Instruction. All four purposes that used to
    // sell it are closed here, at the actual enforcement point, rather
    // than relying on portal.html's UI being hidden (which a direct API
    // call bypasses entirely -- confirmed exploitable in the Oct 2026
    // verification pass: none of these four had any "still available"
    // check, and two require no auth at all). stripe-webhook's matching
    // handlers are deliberately left in place, untouched -- a checkout
    // session created in the brief window before this deploy ships can
    // still complete and be processed correctly for up to the session's
    // ~24h Stripe expiry, rather than erroring out on a legitimately
    // already-paid customer.
    if (purpose === 'unlock-ground-school-pack' || purpose === 'upgrade-ground-school-pack' || purpose === 'signup-and-unlock-ground-school-pack') {
      return jsonError('Group Ground School registration is closed. Private Instruction has replaced it.', 410)
    }

    if (purpose === 'book-mock-oral') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', profileId)
        .maybeSingle()

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: '60-Minute Mock Oral',
              description: 'A live 1:1 mock oral exam session with an Apex Advantage instructor.',
            },
            unit_amount: MOCK_ORAL_PRICE_CENTS,
          },
          quantity: 1,
        }],
        metadata: {
          purpose: 'book-mock-oral',
          profile_id: profileId,
          full_name: profile?.full_name || '',
          email: email || '',
        },
        // session_id was missing here entirely until now -- with no
        // Stripe session id on the success URL, the client had no way to
        // dedupe this purchase's tracking on a refresh/bfcache restore,
        // and no id to attach to the internal purchase_completed event
        // for the marketing dashboard's revenue-by-product breakdown.
        success_url: `${siteOrigin}/portal.html?mockoral=1&session_id={CHECKOUT_SESSION_ID}#mock-oral`,
        cancel_url: `${siteOrigin}/portal.html#mock-oral`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'book-mock-oral', email, profileId, amountCents: MOCK_ORAL_PRICE_CENTS, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: MOCK_ORAL_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'ground-school-registration') {
      // Group Ground School is fully discontinued, replaced by Private
      // Instruction. Closed here, at the single real enforcement point,
      // rather than relying on the public site's UI being hidden (which
      // a direct API call bypasses entirely -- confirmed exploitable in
      // the Oct 2026 verification pass: this endpoint had no auth
      // requirement and no closed check, and scheduled_ground_classes/
      // ground_sessions remained enumerable by an authenticated member
      // or, for the legacy table, anyone). The registration logic this
      // purpose used to run was deleted, not left dead -- it can never
      // execute again now that this check is first.
      return jsonError('Group Ground School registration is closed. Private Instruction has replaced it.', 410)
    }
    if (purpose === 'book-mock-oral-v2') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email
      const productId = body.productId as string
      const availabilityId = body.availabilityId as string
      if (!productId || !availabilityId) return jsonError('Missing productId or availabilityId', 400)

      const { data: product } = await supabase
        .from('mock_oral_products')
        .select('id, name, short_description, price_cents, active')
        .eq('id', productId)
        .maybeSingle()
      if (!product || !product.active) return jsonError('That product is not currently available', 400)

      const { data: slot } = await supabase
        .from('mock_oral_availability')
        .select('id, status, class_date, start_time, timezone')
        .eq('id', availabilityId)
        .maybeSingle()
      if (!slot) return jsonError('That time slot no longer exists', 404)
      if (slot.status !== 'open') return jsonError('That time slot was just booked by someone else. Please choose another.', 409)

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', profileId)
        .maybeSingle()

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: product.short_description,
            },
            unit_amount: product.price_cents,
          },
          quantity: 1,
        }],
        metadata: {
          purpose: 'book-mock-oral-v2',
          profile_id: profileId,
          product_id: product.id,
          availability_id: slot.id,
          full_name: profile?.full_name || '',
          email: email || '',
        },
        success_url: `${siteOrigin}/portal.html?mockoralv2=1&session_id={CHECKOUT_SESSION_ID}#mock-oral`,
        cancel_url: `${siteOrigin}/apex-advantage-mock-oral.html#schedule`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'book-mock-oral-v2', email, profileId, amountCents: product.price_cents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: product.price_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // purpose: 'signup-and-book-mock-oral-v2'
    //   Same one-step pattern as signup-and-unlock-checkride-prep, applied
    //   to Mock Orals: a visitor with no Apex Advantage account picks a
    //   product + open slot on the public apex-advantage-mock-oral.html
    //   page and pays without a separate "create your account first" step.
    //   The account is created here server-side (no password yet, same
    //   "set your password" email as every other one-step signup path),
    //   and the Stripe session's metadata.purpose is still 'book-mock-
    //   oral-v2' -- stripe-webhook's handleMockOralBookingV2 only ever
    //   reads profile_id/product_id/availability_id/full_name/email off
    //   that metadata, so it fulfills a guest-created booking exactly the
    //   same way it fulfills one from an already-signed-in member. No
    //   webhook changes needed.
    if (purpose === 'signup-and-book-mock-oral-v2') {
      const { name, email, productId, availabilityId, utm_first, first_touch_landing, click_ids_first, referrer_first, first_touch_anon_id, signup_touch } = body
      if (!name || !email) return jsonError('Missing required fields: name, email', 400)
      if (!productId || !availabilityId) return jsonError('Missing productId or availabilityId', 400)

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', escapeIlike(email))
        .maybeSingle()
      if (existingProfile) {
        return jsonError('An account with this email already exists. Sign in and book from your dashboard instead.', 409)
      }

      const { data: product } = await supabase
        .from('mock_oral_products')
        .select('id, name, short_description, price_cents, active')
        .eq('id', productId)
        .maybeSingle()
      if (!product || !product.active) return jsonError('That product is not currently available', 400)

      const { data: slot } = await supabase
        .from('mock_oral_availability')
        .select('id, status, class_date, start_time, timezone')
        .eq('id', availabilityId)
        .maybeSingle()
      if (!slot) return jsonError('That time slot no longer exists', 404)
      if (slot.status !== 'open') return jsonError('That time slot was just booked by someone else. Please choose another.', 409)

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { full_name: name },
      })
      if (createErr) return jsonError(String(createErr), 500)
      const newProfileId = created.user.id
      await applySignupAttribution(supabase, newProfileId, utm_first, first_touch_landing, referrer_first, click_ids_first, first_touch_anon_id, signup_touch)

      const redirectTo = `${SITE_ORIGIN}/portal-reset-password.html?dest=mock-oral`
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const actionLink = linkData?.properties?.action_link
      if (actionLink) {
        await supabase.functions.invoke('send-email', {
          body: {
            to: email,
            subject: 'Welcome to Apex Advantage — set your password',
            html: emailTemplate(`
              <h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
              <p style="color:#1F2937;font-size:15px;line-height:1.7;">Your account is ready and your Mock Oral booking is being processed. Set your password to get in:</p>
              <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
              <p style="color:#4B5563;font-size:13px;line-height:1.6;">Once that's done, sign in any time at apexaviationtx.com/portal-login.html — your Mock Oral booking, intake form, and (after your session) your Performance Report will all be waiting in your dashboard.</p>
            `),
          },
        })
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: product.short_description,
            },
            unit_amount: product.price_cents,
          },
          quantity: 1,
        }],
        metadata: {
          purpose: 'book-mock-oral-v2',
          profile_id: newProfileId,
          product_id: product.id,
          availability_id: slot.id,
          full_name: name,
          email,
        },
        success_url: `${siteOrigin}/portal-login.html?view=signup-success&paid=1&product=mock_oral_v2&amount_cents=${product.price_cents}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteOrigin}/apex-advantage-mock-oral.html#pricing`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'signup-and-book-mock-oral-v2', email, profileId: newProfileId, amountCents: product.price_cents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: product.price_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'book-private-instruction') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email
      const availabilityId = body.availabilityId as string
      if (!availabilityId) return jsonError('Missing availabilityId', 400)

      const { data: slot } = await supabase
        .from('private_instruction_availability')
        .select('id, status, class_date, start_time, timezone')
        .eq('id', availabilityId)
        .maybeSingle()
      if (!slot) return jsonError('That time slot no longer exists', 404)
      if (slot.status !== 'open') return jsonError('That time slot was just booked by someone else. Please choose another.', 409)

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', profileId)
        .maybeSingle()

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Private Instruction',
              description: '1 hour of 1-on-1 instruction time.',
            },
            unit_amount: PRIVATE_INSTRUCTION_RATE_CENTS,
          },
          quantity: 1,
        }],
        metadata: {
          purpose: 'book-private-instruction',
          profile_id: profileId,
          availability_id: slot.id,
          full_name: profile?.full_name || '',
          email: email || '',
        },
        success_url: `${siteOrigin}/portal.html?privateinstruction=1&session_id={CHECKOUT_SESSION_ID}#private-instruction`,
        cancel_url: `${siteOrigin}/apex-advantage-private-instruction.html#schedule`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'book-private-instruction', email, profileId, amountCents: PRIVATE_INSTRUCTION_RATE_CENTS, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: PRIVATE_INSTRUCTION_RATE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'signup-and-book-private-instruction') {
      const { name, email, availabilityId, utm_first, first_touch_landing, click_ids_first, referrer_first, first_touch_anon_id, signup_touch } = body
      if (!name || !email) return jsonError('Missing required fields: name, email', 400)
      if (!availabilityId) return jsonError('Missing availabilityId', 400)

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', escapeIlike(email))
        .maybeSingle()
      if (existingProfile) {
        return jsonError('An account with this email already exists. Sign in and book from your dashboard instead.', 409)
      }

      const { data: slot } = await supabase
        .from('private_instruction_availability')
        .select('id, status, class_date, start_time, timezone')
        .eq('id', availabilityId)
        .maybeSingle()
      if (!slot) return jsonError('That time slot no longer exists', 404)
      if (slot.status !== 'open') return jsonError('That time slot was just booked by someone else. Please choose another.', 409)

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { full_name: name },
      })
      if (createErr) return jsonError(String(createErr), 500)
      const newProfileId = created.user.id
      await applySignupAttribution(supabase, newProfileId, utm_first, first_touch_landing, referrer_first, click_ids_first, first_touch_anon_id, signup_touch)

      const redirectTo = `${SITE_ORIGIN}/portal-reset-password.html?dest=private-instruction`
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const actionLink = linkData?.properties?.action_link
      if (actionLink) {
        await supabase.functions.invoke('send-email', {
          body: {
            to: email,
            subject: 'Welcome to Apex Advantage — set your password',
            html: emailTemplate(`
              <h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
              <p style="color:#1F2937;font-size:15px;line-height:1.7;">Your account is ready and your Private Instruction booking is being processed. Set your password to get in:</p>
              <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
              <p style="color:#4B5563;font-size:13px;line-height:1.6;">Once that's done, sign in any time at apexaviationtx.com/portal-login.html — your Private Instruction booking will be waiting in your dashboard.</p>
            `),
          },
        })
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Private Instruction',
              description: '1 hour of 1-on-1 instruction time.',
            },
            unit_amount: PRIVATE_INSTRUCTION_RATE_CENTS,
          },
          quantity: 1,
        }],
        metadata: {
          purpose: 'book-private-instruction',
          profile_id: newProfileId,
          availability_id: slot.id,
          full_name: name,
          email,
        },
        success_url: `${siteOrigin}/portal-login.html?view=signup-success&paid=1&product=private_instruction&amount_cents=${PRIVATE_INSTRUCTION_RATE_CENTS}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteOrigin}/apex-advantage-private-instruction.html#pricing`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'signup-and-book-private-instruction', email, profileId: newProfileId, amountCents: PRIVATE_INSTRUCTION_RATE_CENTS, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: PRIVATE_INSTRUCTION_RATE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // purpose: 'unlock-study-pack'
    //   Apex Advantage Study Packs (Airspace Mastery is Pack #1, $19,
    //   lifetime). Requires the caller's access token, same as
    //   unlock-checkride-prep -- price is always resolved here from the
    //   study_packs row (never trusted from the client), and entitlement
    //   is only ever granted by stripe-webhook on a verified payment, not
    //   by this function or the success URL.
    if (purpose === 'unlock-study-pack') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email
      const packId = body.packId as string
      if (!packId) return jsonError('Missing packId', 400)

      const { data: pack } = await supabase
        .from('study_packs')
        .select('id, name, subtitle, price_cents, active')
        .eq('id', packId)
        .maybeSingle()
      if (!pack || !pack.active) return jsonError('That Study Pack is not currently available', 400)

      const { data: alreadyOwned } = await supabase.rpc('has_study_pack_entitlement', { p_profile_id: profileId, p_pack_id: packId })
      if (alreadyOwned) return jsonError('You already own this Study Pack', 400)

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: pack.name,
              description: pack.subtitle || undefined,
            },
            unit_amount: pack.price_cents,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-study-pack', profile_id: profileId, pack_id: pack.id },
        success_url: `${siteOrigin}/portal.html?studypackunlocked=1&pack=${encodeURIComponent(pack.id)}&amount_cents=${pack.price_cents}&session_id={CHECKOUT_SESSION_ID}#study-packs`,
        cancel_url: `${siteOrigin}/portal.html#study-packs`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'unlock-study-pack', email, profileId, amountCents: pack.price_cents, utm: body.utm, referrer: body.referrer, clickIds: body.click_ids })

      return new Response(JSON.stringify({ url: session.url, amount: pack.price_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return jsonError(`Unknown purpose: ${purpose}`, 400)
  } catch (err) {
    // Server-side record of a checkout-session-creation failure (see the
    // header comment above) -- best-effort and wrapped in its own
    // try/catch so a logging problem can never replace or mask the real
    // error response below. Identity (profile_id/email) is deliberately
    // not attempted here: it's only known inside individual purpose
    // branches above, and reaching into each one would widen this fix far
    // past "log that a failure happened" for marginal benefit.
    try {
      await supabase.from('analytics_events').insert({
        event_name: 'checkout_session_create_failed',
        properties: { purpose: checkoutFailurePurpose ?? null, reason: String(err), origin: 'server' },
      })
    } catch (logErr) {
      console.error('create-checkout-session: failed to log checkout_session_create_failed', logErr)
    }
    return jsonError(String(err), 500)
  }
})
