// Stripe webhook handler for the Apex Advantage portal.
//
// Portal signup itself is free (see create-free-account), so this
// function no longer creates accounts. On checkout.session.completed it
// branches on `metadata.purpose`, set by create-checkout-session:
//
//   'unlock-checkride-prep' — flips profiles.checkride_prep_unlocked to
//     true for the signed-in member who paid, logs the purchase
//     (portal_access_purchases + invoices), and emails a confirmation.
//
//   'ground-school-registration' — creates the ground_registrations row
//     (waitlisted if the session had already filled up by the time
//     payment completed), linking it to a profile if one exists for that
//     email, and emails a confirmation.
//
// Idempotency: every event is recorded in stripe_webhook_events first;
// a unique-constraint failure there means Stripe is retrying an event
// we already processed, so we skip straight to returning 200.
//
// SETUP (Supabase Dashboard → Edge Functions → stripe-webhook → Secrets):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Then in Stripe Dashboard → Developers → Webhooks, add an endpoint at
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// listening for `checkout.session.completed`, and copy its signing
// secret into STRIPE_WEBHOOK_SECRET above.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// `?target=denonext`, not `?target=deno` -- see the matching comment in
// create-checkout-session/index.ts. Same crash, same fix, same function
// family (both call the Stripe SDK the same way).
import Stripe from 'https://esm.sh/stripe@14?target=denonext'
import { emailTemplate as template } from '../_shared/emailTemplate.ts'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const cryptoProvider = Stripe.createSubtleCryptoProvider()

async function sendEmail(supabase: any, to: string, subject: string, html: string) {
  await supabase.functions.invoke('send-email', { body: { to, subject, html } })
}

async function handleUnlockCheckridePrep(supabase: any, session: Stripe.Checkout.Session) {
  const profileId = session.metadata?.profile_id as string
  const tier = (session.metadata?.tier as string) || 'standard'
  const amountCents = session.amount_total ?? 0
  const email = session.customer_details?.email || session.customer_email

  if (!profileId) throw new Error('No profile_id on checkout session metadata')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', profileId)
    .maybeSingle()
  const fullName = profile?.full_name || 'there'

  const { data: unlockedProfile, error: unlockError } = await supabase
    .from('profiles')
    .update({ checkride_prep_unlocked: true })
    .eq('id', profileId)
    .select('id, checkride_prep_unlocked')
    .maybeSingle()

  if (unlockError) throw unlockError
  if (!unlockedProfile?.checkride_prep_unlocked) {
    throw new Error(`Checkride Prep unlock flag was not set for profile ${profileId}`)
  }

  await supabase.from('portal_access_purchases').insert({
    profile_id: profileId,
    email,
    full_name: fullName,
    stripe_session_id: session.id,
    amount_cents: amountCents,
    tier,
  })

  await supabase.from('invoices').insert({
    student_id: profileId,
    description: 'Apex Advantage Checkride Prep Unlock' + (tier === 'founding' ? ' (Founding Pilot Pricing)' : ''),
    amount_cents: amountCents,
    status: 'paid',
  })

  // Conversion event for the Phase 5 admin analytics dashboard. Logged
  // here (server-side, webhook-driven) rather than client-side like the
  // portal.js milestone events -- this one must never depend on the
  // member reopening the portal at the right moment, since it's a
  // revenue event, not an engagement nudge. See ANALYTICS_EVENT_MAP.md.
  await supabase.from('portal_events').insert({
    profile_id: profileId,
    event_type: 'premium_unlocked',
    metadata: { tier, amount_cents: amountCents },
  })

  if (email) {
    await sendEmail(supabase, email, "You're unlocked — Apex Advantage Checkride Prep",
      template(`
        <h2 style="color:#F4B400;margin:0 0 4px;">You're in, ${fullName.split(' ')[0]}!</h2>
        <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your payment went through and the full Checkride Prep System is unlocked — DPE question library, scenario training, Checkride Mode, progress tracking, and everything else in the sidebar.</p>
        <a href="https://apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Start Studying →</a>
      `))
  }
}

async function handleGroundSchoolRegistration(supabase: any, session: Stripe.Checkout.Session) {
  const sessionId = session.metadata?.session_id as string
  const fullName = (session.metadata?.full_name as string) || 'Student'
  const email = (session.metadata?.email as string) || session.customer_details?.email || session.customer_email
  const amountCents = session.amount_total ?? 0

  if (!sessionId) throw new Error('No session_id on checkout session metadata')
  if (!email) throw new Error('No email on checkout session')

  const { data: groundSession } = await supabase
    .from('ground_sessions')
    .select('title, scheduled_at, max_students')
    .eq('id', sessionId)
    .maybeSingle()

  const { count: confirmedCount } = await supabase
    .from('ground_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('is_waitlisted', false)

  const isWaitlisted = !!groundSession && (confirmedCount ?? 0) >= groundSession.max_students

  const { data: matchingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  await supabase.from('ground_registrations').insert({
    session_id: sessionId,
    full_name: fullName,
    email,
    is_waitlisted: isWaitlisted,
    profile_id: matchingProfile?.id ?? null,
    stripe_session_id: session.id,
    amount_cents: amountCents,
    payment_status: 'paid',
  })

  // Conversion event for the Phase 5 admin analytics dashboard -- see
  // the matching comment in handleUnlockCheckridePrep(). profile_id can
  // be null here (no matching profile for this email, e.g. a walk-in who
  // paid online without a portal account) -- still logged for aggregate
  // revenue/funnel counting even when it can't be attributed to a member.
  await supabase.from('portal_events').insert({
    profile_id: matchingProfile?.id ?? null,
    event_type: 'ground_school_purchased',
    metadata: { session_id: sessionId, amount_cents: amountCents, is_waitlisted: isWaitlisted },
  })

  const when = groundSession
    ? new Date(groundSession.scheduled_at).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : ''
  const title = groundSession?.title || 'Ground School'

  if (isWaitlisted) {
    await sendEmail(supabase, email, `Waitlisted — ${title}`,
      template(`
        <h2 style="color:#F4B400;margin:0 0 4px;">You're on the waitlist</h2>
        <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${title} on ${when} filled up right as your payment came through. You're first on the waitlist — we'll email you the moment a spot opens, and refund you in full if one doesn't.</p>
      `))
  } else {
    await sendEmail(supabase, email, `You're registered — ${title}`,
      template(`
        <h2 style="color:#F4B400;margin:0 0 4px;">You're confirmed, ${fullName.split(' ')[0]}!</h2>
        <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You're registered for <strong style="color:#fff">${title}</strong> on ${when}. See you there.</p>
      `))
  }
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
    const purpose = session.metadata?.purpose

    if (purpose === 'unlock-checkride-prep') {
      await handleUnlockCheckridePrep(supabase, session)
    } else if (purpose === 'ground-school-registration') {
      await handleGroundSchoolRegistration(supabase, session)
    } else {
      throw new Error(`Unknown checkout purpose: ${purpose}`)
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
