// Creates a Stripe Checkout Session for Apex Advantage Portal Access.
//
// Pricing: the first 25 successful purchases (see portal_access_purchases)
// are $29 ("founding" tier); every purchase after that is $49 ("standard").
// The tier is decided here, server-side, from the actual paid-purchase
// count — never trusted from the client.
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

const FOUNDING_PRICE_CENTS = 2900 // $29 — first 25 signups
const STANDARD_PRICE_CENTS = 4900 // $49 — everyone after
const FOUNDING_SEATS = 25

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { name, email, origin } = await req.json()
    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name, email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { count } = await supabase
      .from('portal_access_purchases')
      .select('id', { count: 'exact', head: true })

    const isFounding = (count ?? 0) < FOUNDING_SEATS
    const amount = isFounding ? FOUNDING_PRICE_CENTS : STANDARD_PRICE_CENTS
    const tier = isFounding ? 'founding' : 'standard'

    const siteOrigin = origin || 'https://apexaviationtx.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Apex Advantage Portal Access',
            description: isFounding
              ? 'Founding pilot pricing — locked in for the first 25 members'
              : 'Full access to the Apex Advantage member portal',
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      metadata: { full_name: name, tier },
      success_url: `${siteOrigin}/portal-signup-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin}/checkride-prep.html`,
    })

    return new Response(JSON.stringify({ url: session.url, tier, amount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
