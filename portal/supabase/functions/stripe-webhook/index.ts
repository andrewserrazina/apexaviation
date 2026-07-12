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
//   'ground-school-registration' — creates the scheduled class enrollment
//     for the new admin-managed scheduler when scheduled_class_id is present,
//     falling back to the legacy ground_registrations path for older sessions.
//
//   'book-mock-oral' — creates a mock_oral_requests row and emails both
//     the student (confirmation) and Andrew (ADMIN_NOTIFICATION_EMAIL,
//     defaults to info@apexaviationtx.com) so the actual 1:1 time can be
//     coordinated -- there's no calendar/slot system for this, just a
//     paid request queue.
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
const ADMIN_NOTIFICATION_EMAIL = Deno.env.get('ADMIN_NOTIFICATION_EMAIL') || 'info@apexaviationtx.com'

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

  const tierSuffix = tier === 'founding' ? ' (Founding Pilot Pricing)' : tier === 'launch' ? ' (New-Member Fast-Action Pricing)' : ''
  await supabase.from('invoices').insert({
    student_id: profileId,
    description: 'Apex Advantage Checkride Prep Unlock' + tierSuffix,
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
        <a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Start Studying →</a>
      `))
  }
}

async function handleGroundSchoolRegistration(supabase: any, session: Stripe.Checkout.Session) {
  const sessionId = session.metadata?.session_id as string
  const scheduledClassId = session.metadata?.scheduled_class_id as string
  const fullName = (session.metadata?.full_name as string) || 'Student'
  const email = (session.metadata?.email as string) || session.customer_details?.email || session.customer_email
  const amountCents = session.amount_total ?? 0

  if (!sessionId && !scheduledClassId) throw new Error('No ground school id on checkout session metadata')
  if (!email) throw new Error('No email on checkout session')

  const { data: matchingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (scheduledClassId) {
    const { data: scheduledClass } = await supabase
      .from('scheduled_ground_classes')
      .select('id, title, lesson_title, class_date, start_time, timezone')
      .eq('id', scheduledClassId)
      .maybeSingle()

    const { error: enrollError } = await supabase.rpc('confirm_scheduled_ground_class_enrollment', {
      p_scheduled_ground_class_id: scheduledClassId,
      p_full_name: fullName,
      p_email: email,
      p_profile_id: matchingProfile?.id ?? null,
      p_stripe_session_id: session.id,
      p_amount_cents: amountCents,
    })
    if (enrollError) {
      // The enrollment RPC locks the class row and checks capacity
      // atomically, so this only fires when two people race for the
      // last seat and both payments land before either webhook runs.
      // Stripe has already captured the loser's payment by this point
      // (checkout.session.completed only fires after a successful
      // charge) -- without an explicit refund here, that student would
      // be charged for a class they never got into, with nothing to
      // tell them why.
      if (session.payment_intent) {
        try {
          await stripe.refunds.create({ payment_intent: session.payment_intent as string })
        } catch (refundErr) {
          console.error('stripe-webhook: refund failed after full-class enrollment error', refundErr)
        }
      }
      if (email) {
        await sendEmail(supabase, email, 'Class full — you have been refunded',
          template(`
            <h2 style="color:#F4B400;margin:0 0 4px;">Sorry, ${fullName.split(' ')[0]} — that class just filled up</h2>
            <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Someone grabbed the last seat right as your payment came through. You have not been enrolled, and your payment has been fully refunded. Head back to the Ground School page in your portal to pick another session.</p>
          `))
      }
      throw enrollError
    }

    await supabase.from('portal_events').insert({
      profile_id: matchingProfile?.id ?? null,
      event_type: 'ground_school_purchased',
      metadata: { scheduled_class_id: scheduledClassId, amount_cents: amountCents },
    })

    const when = scheduledClass
      ? new Date(`${scheduledClass.class_date}T${scheduledClass.start_time}`).toLocaleString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : ''
    const title = scheduledClass?.title || 'Ground School'

    await sendEmail(supabase, email, `You're registered — ${title}`,
      template(`
        <h2 style="color:#F4B400;margin:0 0 4px;">You're confirmed, ${fullName.split(' ')[0]}!</h2>
        <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You're registered for <strong style="color:#fff">${title}</strong> on ${when}. See you there.</p>
      `))
    return
  }

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

async function handleMockOralBooking(supabase: any, session: Stripe.Checkout.Session) {
  const profileId = (session.metadata?.profile_id as string) || null
  const fullName = (session.metadata?.full_name as string) || 'Student'
  const email = (session.metadata?.email as string) || session.customer_details?.email || session.customer_email
  const amountCents = session.amount_total ?? 0

  if (!email) throw new Error('No email on checkout session')

  const { error: insertError } = await supabase.from('mock_oral_requests').insert({
    profile_id: profileId,
    full_name: fullName,
    email,
    stripe_session_id: session.id,
    amount_cents: amountCents,
  })
  if (insertError) throw insertError

  await sendEmail(supabase, email, "You're booked — 60-Minute Mock Oral",
    template(`
      <h2 style="color:#F4B400;margin:0 0 4px;">Thanks, ${fullName.split(' ')[0]}!</h2>
      <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your Mock Oral is paid for. Andrew will reach out shortly by email to schedule your 1:1 session at a time that works for you.</p>
    `))

  await sendEmail(supabase, ADMIN_NOTIFICATION_EMAIL, `New Mock Oral request — ${fullName}`,
    template(`
      <h2 style="color:#F4B400;margin:0 0 4px;">New Mock Oral request</h2>
      <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;"><strong style="color:#fff">${fullName}</strong> (${email}) just paid for a 60-Minute Mock Oral. Schedule a time with them and update the request in the CRM under Mock Oral Requests.</p>
    `))
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
    } else if (purpose === 'book-mock-oral') {
      await handleMockOralBooking(supabase, session)
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
