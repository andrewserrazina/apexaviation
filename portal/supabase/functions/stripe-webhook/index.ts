// Stripe webhook handler for Apex Advantage Portal Access purchases.
//
// On checkout.session.completed:
//   1. Idempotency check (stripe_webhook_events) — Stripe retries webhooks,
//      this makes sure a retry never double-charges/double-creates.
//   2. If no profile exists for the payer's email, create a real Supabase
//      Auth user (portal account) and email them a secure link to set
//      their own password.
//   3. If a profile already exists (returning student topping up), just
//      send a payment-received receipt — no duplicate account.
//   4. Record the purchase (portal_access_purchases + invoices, the
//      latter so it shows up in the existing Billing.jsx / Admin Analytics
//      views alongside everything else).
//
// SETUP (Supabase Dashboard → Edge Functions → stripe-webhook → Secrets):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Then in Stripe Dashboard → Developers → Webhooks, add an endpoint at
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// listening for `checkout.session.completed`, and copy its signing
// secret into STRIPE_WEBHOOK_SECRET above.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const cryptoProvider = Stripe.createSubtleCryptoProvider()

function template(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#06080f;font-family:'Helvetica Neue',Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="margin-bottom:28px;">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff;">APEX</span>
      <span style="font-size:22px;font-style:italic;color:#F4B400;font-family:Georgia,serif;"> Advantage</span>
    </div>
    ${content}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">
    <p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">Apex Aviation · San Marcos, TX (KHYI)</p>
  </div>
</body></html>`
}

async function sendEmail(supabase: any, to: string, subject: string, html: string) {
  await supabase.functions.invoke('send-email', { body: { to, subject, html } })
}

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err}`, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Idempotency: never process the same Stripe event twice.
  const { error: dupeError } = await supabase
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, event_type: event.type })
  if (dupeError) {
    // Unique violation means we've already processed this event.
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 })
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), { status: 200 })
  }

  try {
    const session = event.data.object as Stripe.Checkout.Session
    const email = session.customer_details?.email || session.customer_email
    const fullName = (session.metadata?.full_name as string) || 'Apex Advantage Student'
    const tier = (session.metadata?.tier as string) || 'standard'
    const amountCents = session.amount_total ?? 0

    if (!email) throw new Error('No email on checkout session')

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('email', email)
      .maybeSingle()

    let profileId = existingProfile?.id

    if (!existingProfile) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { full_name: fullName },
      })
      if (createErr) throw createErr
      profileId = created.user.id

      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
      })
      const actionLink = linkData?.properties?.action_link

      await sendEmail(supabase, email, 'Welcome to Apex Advantage — set your password',
        template(`
          <h2 style="color:#F4B400;margin:0 0 4px;">Welcome to Apex Advantage, ${fullName.split(' ')[0]}!</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your payment went through and your member portal account is ready. Set your password to get in:</p>
          <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
          <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Once that's done, sign in any time at apexaviationtx.com/portal-login.html.</p>
        `))
    } else {
      await sendEmail(supabase, email, 'Payment received — Apex Advantage',
        template(`
          <h2 style="color:#F4B400;margin:0 0 4px;">Payment received. Thank you!</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">We've recorded your $${(amountCents / 100).toFixed(2)} payment for Apex Advantage. Your portal account is unchanged — sign in any time.</p>
          <a href="https://apexaviationtx.com/portal-login.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Go to the Portal →</a>
        `))
    }

    await supabase.from('portal_access_purchases').insert({
      profile_id: profileId,
      email,
      full_name: fullName,
      stripe_session_id: session.id,
      amount_cents: amountCents,
      tier,
    })

    if (profileId) {
      await supabase.from('invoices').insert({
        student_id: profileId,
        description: 'Apex Advantage Portal Access' + (tier === 'founding' ? ' (Founding Pilot Pricing)' : ''),
        amount_cents: amountCents,
        status: 'paid',
      })
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    console.error('stripe-webhook processing error', err)
    // Still return 200 so Stripe doesn't retry into an infinite loop for
    // errors that won't self-heal (e.g. a bad email) — the event is logged
    // above in stripe_webhook_events either way. Genuine outages will show
    // up in Supabase function logs.
    return new Response(JSON.stringify({ received: true, error: String(err) }), { status: 200 })
  }
})
