// Creates Stripe Checkout Sessions for the Apex Advantage portal.
//
// Portal signup itself is free (see create-free-account). This function
// handles the things that actually cost money after (or during) signup:
//
//   purpose: 'unlock-checkride-prep'
//     An already-signed-in free member unlocking the Checkride Prep
//     System (DPE library, scenarios, progress tracking, etc). Priced
//     via get_checkride_prep_pricing() (founding/launch/standard tiers,
//     decided server-side from portal_access_purchases and the caller's
//     own profiles.created_at — never trusted from the client). Requires
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
//     dashboard. Always prices at the founding/launch discount since the
//     account is (by construction) brand new at the moment this runs —
//     see get_checkride_prep_pricing()'s launch-window rule. No auth
//     token available yet (the account doesn't have a password set) —
//     the new profile id comes directly from auth.admin.createUser's
//     result, not from a client-supplied value.
//
//   purpose: 'ground-school-registration'
//     Registering (and paying $25) for a specific live ground school
//     session. Anonymous-friendly — no login required, same as the old
//     cash-at-door flow, just paid online now.
//
//   purpose: 'book-mock-oral'
//     An already-signed-in member booking a $99 60-minute Mock Oral.
//     Requires the caller's Supabase access token, same as
//     unlock-checkride-prep -- a mock oral is a 1:1 session against an
//     instructor's calendar, not a fixed class slot, so payment just
//     creates a request row (handled in stripe-webhook) for admin to
//     actually schedule a time with the student.
//
//   purpose: 'unlock-ground-school-pack' / 'signup-and-unlock-ground-school-pack'
//     $400 flat one-time purchase granting unlimited free registration to
//     every Private Pilot ground school class (scheduled_ground_classes
//     where course_id = 'PPL'), instead of paying $25/session via
//     'ground-school-registration' above -- an alternative, not a
//     replacement; a member can still pay per-class if they don't want
//     the full pack. Same already-signed-in vs. one-step-signup split as
//     the Checkride Prep purposes above. No pricing tiers (flat $400), so
//     no pricing RPC involved.
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
import { emailTemplate } from '../_shared/emailTemplate.ts'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://apexaviationtx.com'

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const GROUND_SCHOOL_PRICE_CENTS = 2500 // $25 per session
const GROUND_SCHOOL_PACK_PRICE_CENTS = 40000 // $400 flat, unlimited Private Pilot classes
const MOCK_ORAL_PRICE_CENTS = 9900 // $99 per 60-minute mock oral

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
  return out
}

// Logs every Checkout Session this function creates, regardless of
// purpose -- the source of truth send-lifecycle-emails' abandoned-
// checkout recovery job reads from. stripe-webhook stamps completed_at
// when (if) the session actually completes; a row with no completed_at
// after a while is what "abandoned" means. Best-effort: a logging
// failure here must never block the checkout itself.
async function logCheckoutAttempt(supabase: any, args: { stripeSessionId: string; purpose: string; email?: string | null; profileId?: string | null; amountCents: number; utm?: any }) {
  try {
    const safeUtm = sanitizeUtm(args.utm)
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
    })
  } catch (err) {
    console.error('logCheckoutAttempt failed', err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const purpose = body.purpose
    const siteOrigin = body.origin || 'https://apexaviationtx.com'
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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
      const pricing: PricingRow = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 4900, founding_seats_remaining: 0, launch_expires_at: null }

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
        cancel_url: `${siteOrigin}/portal.html#dashboard`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'unlock-checkride-prep', email, profileId, amountCents: pricing.amount_cents, utm: body.utm })

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
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'join-membership', email, profileId, amountCents, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, tier, amount: amountCents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'signup-and-unlock-checkride-prep') {
      const { name, email, dest, checkride_timing } = body
      if (!name || !email) return jsonError('Missing required fields: name, email', 400)
      const safeCheckrideTiming = CHECKRIDE_TIMINGS.includes(checkride_timing) ? checkride_timing : null

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
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

      // Brand new profile, so this is always founding-or-launch ($29),
      // never standard -- get_checkride_prep_pricing()'s launch window
      // is measured from profiles.created_at, which is effectively "now"
      // for a profile created a few lines above.
      // Unlike the unlock-checkride-prep branch above, this doesn't abort
      // on a pricing error -- the free account was just created a few
      // lines up, so bailing out here would strand a real member with an
      // account but no way to check out. Falls back to the customer-
      // favorable $29 (never silently overcharges), but still logs the
      // error so a real RPC bug doesn't go unnoticed.
      const { data: pricingRows, error: pricingError } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: newProfileId })
      if (pricingError) {
        console.error(`create-checkout-session: get_checkride_prep_pricing failed for new profile ${newProfileId}`, pricingError)
      }
      const pricing: PricingRow = (pricingRows && pricingRows[0]) || { tier: 'launch', amount_cents: 2900, founding_seats_remaining: 0, launch_expires_at: null }

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
              <h2 style="color:#F4B400;margin:0 0 4px;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
              <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your account is ready and your Checkride Prep purchase is being processed. Set your password to get in:</p>
              <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
              <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Once that's done, sign in any time at advantage.apexaviationtx.com/portal-login.html — the full Checkride Prep System (DPE question bank, scenario training, progress tracking) will already be unlocked.</p>
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
        cancel_url: `${siteOrigin}/portal-login.html?view=signup-success`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'signup-and-unlock-checkride-prep', email, profileId: newProfileId, amountCents: pricing.amount_cents, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, tier: pricing.tier, amount: pricing.amount_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'unlock-ground-school-pack') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email

      const { data: profile } = await supabase
        .from('profiles')
        .select('private_pilot_ground_school_pack_unlocked')
        .eq('id', profileId)
        .maybeSingle()

      if (profile?.private_pilot_ground_school_pack_unlocked) {
        return jsonError('The Private Pilot Ground School pack is already unlocked on this account', 400)
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Private Pilot Ground School — Full Course',
              description: 'Unlimited registration for every Private Pilot ground school class — no per-session charge.',
            },
            unit_amount: GROUND_SCHOOL_PACK_PRICE_CENTS,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-ground-school-pack', profile_id: profileId },
        success_url: `${siteOrigin}/portal.html?groundschoolpack=1&amount_cents=${GROUND_SCHOOL_PACK_PRICE_CENTS}&session_id={CHECKOUT_SESSION_ID}#ground-school`,
        cancel_url: `${siteOrigin}/portal.html#ground-school`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'unlock-ground-school-pack', email, profileId, amountCents: GROUND_SCHOOL_PACK_PRICE_CENTS, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, amount: GROUND_SCHOOL_PACK_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Post-purchase upgrade: a member who already paid for one or more
    // individual $25 classes wants the $400 complete pack, crediting
    // what they already paid. The credited amount is computed here from
    // the caller's own real paid enrollment rows -- never a client-
    // supplied "I already paid $X" claim, which is what would make this
    // exploitable. Scoped to scheduled_ground_class_enrollments (the
    // modern system this landing page sells through), not the legacy
    // ground_registrations table.
    if (purpose === 'upgrade-ground-school-pack') {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return jsonError('Missing Authorization header', 401)

      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

      const profileId = userData.user.id
      const email = userData.user.email

      const { data: profile } = await supabase
        .from('profiles')
        .select('private_pilot_ground_school_pack_unlocked')
        .eq('id', profileId)
        .maybeSingle()
      if (profile?.private_pilot_ground_school_pack_unlocked) {
        return jsonError('The Private Pilot Ground School pack is already unlocked on this account', 400)
      }

      // enroll_in_ground_school_via_pack() (v57.sql) only ever unlocks the
      // PPL pack for a PPL class -- this credit calculation has to match
      // that same PPL-only scope, or a paid enrollment in a future
      // non-PPL course (Commercial/Instrument) would count as credit
      // toward a pack that has nothing to do with it.
      const { data: paidEnrollments } = await supabase
        .from('scheduled_ground_class_enrollments')
        .select('amount_cents, scheduled_ground_class:scheduled_ground_classes(course_id)')
        .eq('profile_id', profileId)
        .eq('payment_status', 'paid')

      const creditedCents = (paidEnrollments || [])
        .filter((row: any) => row.scheduled_ground_class?.course_id === 'PPL')
        .reduce((sum: number, row: any) => sum + (row.amount_cents || 0), 0)
      if (creditedCents <= 0) {
        return jsonError('No prior paid Ground School class found on this account to credit toward the upgrade', 400)
      }

      const upgradeAmountCents = Math.max(GROUND_SCHOOL_PACK_PRICE_CENTS - creditedCents, 0)
      if (upgradeAmountCents === 0) {
        return jsonError('Your prior payments already cover the full program price — contact info@apexaviationtx.com to unlock directly', 400)
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Private Pilot Ground School — Upgrade to Full Course',
              description: `Credits $${(creditedCents / 100).toFixed(2)} already paid toward the $400 complete program.`,
            },
            unit_amount: upgradeAmountCents,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'upgrade-ground-school-pack', profile_id: profileId, credited_cents: String(creditedCents) },
        success_url: `${siteOrigin}/portal.html?groundschoolpack=1&amount_cents=${upgradeAmountCents}&session_id={CHECKOUT_SESSION_ID}#ground-school`,
        cancel_url: `${siteOrigin}/portal.html#ground-school`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'upgrade-ground-school-pack', email, profileId, amountCents: upgradeAmountCents, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, amount: upgradeAmountCents, creditedCents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'signup-and-unlock-ground-school-pack') {
      const { name, email, dest } = body
      if (!name || !email) return jsonError('Missing required fields: name, email', 400)

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
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

      // Same "set your password" email pattern as
      // signup-and-unlock-checkride-prep -- the account is real and
      // usable the moment it's created, independent of whether this
      // checkout is ever completed.
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
              <h2 style="color:#F4B400;margin:0 0 4px;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
              <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your account is ready and your Private Pilot Ground School purchase is being processed. Set your password to get in:</p>
              <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
              <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Once that's done, sign in any time at advantage.apexaviationtx.com/portal-login.html — every Private Pilot ground school class will already be unlocked, no per-session charge.</p>
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
              name: 'Apex Advantage Private Pilot Ground School — Full Course',
              description: 'Unlimited registration for every Private Pilot ground school class — no per-session charge.',
            },
            unit_amount: GROUND_SCHOOL_PACK_PRICE_CENTS,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-ground-school-pack', profile_id: newProfileId },
        success_url: `${siteOrigin}/portal-login.html?view=signup-success&paid=1&product=ground_school_pack&amount_cents=${GROUND_SCHOOL_PACK_PRICE_CENTS}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteOrigin}/portal-login.html?view=signup-success&product=ground_school_pack`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'signup-and-unlock-ground-school-pack', email, profileId: newProfileId, amountCents: GROUND_SCHOOL_PACK_PRICE_CENTS, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, amount: GROUND_SCHOOL_PACK_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
        success_url: `${siteOrigin}/portal.html?mockoral=1#mock-oral`,
        cancel_url: `${siteOrigin}/portal.html#mock-oral`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'book-mock-oral', email, profileId, amountCents: MOCK_ORAL_PRICE_CENTS, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, amount: MOCK_ORAL_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'ground-school-registration') {
      const { sessionId, scheduledClassId, name, email } = body
      if ((!sessionId && !scheduledClassId) || !name || !email) {
        return jsonError('Missing required fields: scheduledClassId/sessionId, name, email', 400)
      }

      if (scheduledClassId) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: scheduledClass, error: classErr } = await supabase
          .from('scheduled_ground_classes')
          .select('id, title, lesson_title, class_date, start_time, timezone, capacity, enrolled_count, status')
          .eq('id', scheduledClassId)
          .eq('status', 'published')
          .gte('class_date', today)
          .maybeSingle()

        if (classErr || !scheduledClass) return jsonError('Ground school class not found or not open for registration', 404)
        if ((scheduledClass.enrolled_count ?? 0) >= scheduledClass.capacity) return jsonError('Ground school class is full', 409)

        const { data: existingEnrollment } = await supabase
          .from('scheduled_ground_class_enrollments')
          .select('id')
          .eq('scheduled_ground_class_id', scheduledClassId)
          .ilike('email', escapeIlike(email))
          .eq('payment_status', 'paid')
          .maybeSingle()
        if (existingEnrollment) return jsonError('This email is already registered for this class', 409)

        const when = new Date(`${scheduledClass.class_date}T${scheduledClass.start_time}`).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: email,
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Ground School — ${scheduledClass.title}`,
                description: `${when} · ${scheduledClass.lesson_title}`,
              },
              unit_amount: GROUND_SCHOOL_PRICE_CENTS,
            },
            quantity: 1,
          }],
          metadata: { purpose: 'ground-school-registration', scheduled_class_id: scheduledClassId, full_name: name, email },
          success_url: `${siteOrigin}/portal.html?registered=1&amount_cents=${GROUND_SCHOOL_PRICE_CENTS}&session_id={CHECKOUT_SESSION_ID}#ground-school`,
          cancel_url: `${siteOrigin}/portal.html#ground-school`,
        })
        await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'ground-school-registration', email, amountCents: GROUND_SCHOOL_PRICE_CENTS, utm: body.utm })

        return new Response(JSON.stringify({ url: session.url, amount: GROUND_SCHOOL_PRICE_CENTS }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: groundSession, error: gsErr } = await supabase
        .from('ground_sessions')
        .select('id, title, scheduled_at')
        .eq('id', sessionId)
        .single()
      if (gsErr || !groundSession) return jsonError('Ground school session not found', 404)

      // Mirrors the scheduledClassId branch's pre-check above -- this legacy
      // path never had one, so a member who already paid could reopen
      // Ground School and get charged a second time before the webhook's
      // own dedup guard (confirm_legacy_ground_registration, v63) ever ran.
      const { data: existingRegistration } = await supabase
        .from('ground_registrations')
        .select('id')
        .eq('session_id', sessionId)
        .ilike('email', escapeIlike(email))
        .eq('payment_status', 'paid')
        .maybeSingle()
      if (existingRegistration) return jsonError('This email is already registered for this session', 409)

      const when = new Date(groundSession.scheduled_at).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Ground School — ${groundSession.title}`,
              description: when,
            },
            unit_amount: GROUND_SCHOOL_PRICE_CENTS,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'ground-school-registration', session_id: sessionId, full_name: name, email },
        success_url: `${siteOrigin}/portal.html?registered=1&amount_cents=${GROUND_SCHOOL_PRICE_CENTS}&session_id={CHECKOUT_SESSION_ID}#ground-school`,
        cancel_url: `${siteOrigin}/portal.html#ground-school`,
      })
      await logCheckoutAttempt(supabase, { stripeSessionId: session.id, purpose: 'ground-school-registration', email, amountCents: GROUND_SCHOOL_PRICE_CENTS, utm: body.utm })

      return new Response(JSON.stringify({ url: session.url, amount: GROUND_SCHOOL_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return jsonError(`Unknown purpose: ${purpose}`, 400)
  } catch (err) {
    return jsonError(String(err), 500)
  }
})
