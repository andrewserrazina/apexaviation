// Creates Stripe Checkout Sessions for the Apex Advantage portal.
//
// Portal signup itself is free (see create-free-account). This function
// handles the two things that actually cost money after signup:
//
//   purpose: 'unlock-checkride-prep'
//     An already-signed-in free member unlocking the Checkride Prep
//     System (DPE library, scenarios, progress tracking, etc). Priced
//     the same $29/first-25-then-$49 founder tier as before, decided
//     server-side from portal_access_purchases — never trusted from the
//     client. Requires the caller's Supabase access token so we know
//     *which* profile to unlock; never trust a client-supplied id.
//
//   purpose: 'ground-school-registration'
//     Registering (and paying $25) for a specific live ground school
//     session. Anonymous-friendly — no login required, same as the old
//     cash-at-door flow, just paid online now.
//
// Env vars required (set as Supabase Edge Function secrets):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const FOUNDING_PRICE_CENTS = 2900 // $29 — first 25 unlocks
const STANDARD_PRICE_CENTS = 4900 // $49 — everyone after
const FOUNDING_SEATS = 25
const GROUND_SCHOOL_PRICE_CENTS = 2500 // $25 per session

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

      const { count } = await supabase
        .from('portal_access_purchases')
        .select('id', { count: 'exact', head: true })

      const isFounding = (count ?? 0) < FOUNDING_SEATS
      const amount = isFounding ? FOUNDING_PRICE_CENTS : STANDARD_PRICE_CENTS
      const tier = isFounding ? 'founding' : 'standard'

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Apex Advantage Checkride Prep Unlock',
              description: isFounding
                ? 'Founding pilot pricing — locked in for the first 25 members'
                : 'Full access to the Checkride Prep System inside your member portal',
            },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        metadata: { purpose: 'unlock-checkride-prep', profile_id: profileId, tier },
        success_url: `${siteOrigin}/portal.html?unlocked=1#checkride-prep`,
        cancel_url: `${siteOrigin}/portal.html#dashboard`,
      })

      return new Response(JSON.stringify({ url: session.url, tier, amount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (purpose === 'ground-school-registration') {
      const { sessionId, name, email } = body
      if (!sessionId || !name || !email) {
        return jsonError('Missing required fields: sessionId, name, email', 400)
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
