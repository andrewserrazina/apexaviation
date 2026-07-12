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
const MOCK_ORAL_PRICE_CENTS = 9900 // $99 per 60-minute mock oral

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

      const { data: pricingRows } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: profileId })
      const pricing: PricingRow = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 4900, founding_seats_remaining: 0, launch_expires_at: null }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
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
        success_url: `${siteOrigin}/portal.html?unlocked=1#checkride-prep`,
        cancel_url: `${siteOrigin}/portal.html#dashboard`,
      })

      return new Response(JSON.stringify({ url: session.url, tier: pricing.tier, amount: pricing.amount_cents }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'signup-and-unlock-checkride-prep') {
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

      // Brand new profile, so this is always founding-or-launch ($29),
      // never standard -- get_checkride_prep_pricing()'s launch window
      // is measured from profiles.created_at, which is effectively "now"
      // for a profile created a few lines above.
      const { data: pricingRows } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: newProfileId })
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
        success_url: `${siteOrigin}/portal-login.html?view=signup-success&paid=1`,
        cancel_url: `${siteOrigin}/portal-login.html?view=signup-success`,
      })

      return new Response(JSON.stringify({ url: session.url, tier: pricing.tier, amount: pricing.amount_cents }), {
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
          .ilike('email', email)
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
          success_url: `${siteOrigin}/portal.html?registered=1#ground-school`,
          cancel_url: `${siteOrigin}/portal.html#ground-school`,
        })

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
        success_url: `${siteOrigin}/portal.html?registered=1#ground-school`,
        cancel_url: `${siteOrigin}/portal.html#ground-school`,
      })

      return new Response(JSON.stringify({ url: session.url, amount: GROUND_SCHOOL_PRICE_CENTS }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return jsonError(`Unknown purpose: ${purpose}`, 400)
  } catch (err) {
    return jsonError(String(err), 500)
  }
})
