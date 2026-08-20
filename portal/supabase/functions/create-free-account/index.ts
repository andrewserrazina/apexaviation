// Creates a free Apex Advantage Portal account.
//
// Portal signup itself is free — students get the Dashboard and Ground
// School Scheduling immediately. The Checkride Prep content (DPE library,
// scenarios, progress tracking, etc.) stays locked until they pay the
// $29/$49 unlock via create-checkout-session's `unlock-checkride-prep`
// purpose, handled separately once they're signed in.
//
// Env vars required (set as Supabase Edge Function secrets):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emailTemplate } from '../_shared/emailTemplate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://apexaviationtx.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Must match the check constraint on profiles.checkride_timing
// (supabase-portal-schema-v39.sql).
const CHECKRIDE_TIMINGS = ['within_14_days', 'within_30_days', 'within_60_days', 'more_than_60_days', 'not_scheduled']

// New Member Activation, Email #1 -- checkride_timing is the ONLY
// training-context signal that actually exists at the moment of
// signup. profiles.training_stage / primary_focus_area (the richer
// fields the activation-sequence brief assumed would drive Email #1)
// aren't collected until showWelcomeOnboarding() runs on the member's
// FIRST portal login (site/portal-stable.js, supabase-portal-schema-
// v70.sql) -- there's no way to know them yet here. Rather than
// guessing, Email #1 uses the brief's own explicit "missing training
// stage" fallback (section 26): a generic, always-correct recommendation
// (today's free oral-exam question) plus one optional personalization
// clause built from whatever checkride_timing they did just pick on the
// signup form. Emails #2-4 (send-lifecycle-emails/index.ts,
// processNewMemberActivation) run 24h+ after signup, by which point
// training_stage/primary_focus_area are realistically known -- that's
// where the richer per-stage CTA mapping from the brief actually applies.
const CHECKRIDE_TIMING_CLAUSE: Record<string, string> = {
  within_14_days: " and that your checkride's coming up fast",
  within_30_days: " and that your checkride's coming up soon",
  within_60_days: " and that you're working toward your checkride",
  more_than_60_days: " and that you've got some runway before your checkride",
  // not_scheduled: intentionally no clause -- nothing meaningful to say
  // yet, and forcing one risks the exact "I saw you're currently null"
  // failure mode the brief explicitly warns against (section 26).
}

// Real, monitored inbox -- already the support contact members are told
// to use elsewhere in the product (see the "Is there a refund policy?"
// FAQ answer on checkride-prep.html: "reach out to info@apexaviationtx.com
// and we'll work it out with you directly"). Reused here rather than
// inventing a new address, and only wired up because it's genuinely
// monitored -- an unmonitored noreply@ reply-to would make the email's
// own "reply to this email" line a lie.
const ACTIVATION_REPLY_TO = 'info@apexaviationtx.com'

// First-touch UTM capture (supabase-portal-schema-v58.sql) -- these
// values come from the visitor's browser (analytics-events.js reading
// its own first-visit-only localStorage keys), so they're treated as
// untrusted input: capped length, no control characters, dropped
// entirely if malformed rather than erroring the whole signup.
function sanitizeUtm(utm: any): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const val = utm && typeof utm === 'object' ? utm[key] : null
    out[key] = typeof val === 'string' && /^[\x20-\x7e]{1,200}$/.test(val) ? val : null
  }
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { name, email, dest, checkride_timing, utm_first, ref, source, intent } = await req.json()
    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name, email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const safeCheckrideTiming = CHECKRIDE_TIMINGS.includes(checkride_timing) ? checkride_timing : null

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingProfile) {
      return new Response(JSON.stringify({ error: 'An account with this email already exists. Try signing in instead.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomUUID(),
      user_metadata: { full_name: name },
    })
    if (createErr) throw createErr

    // handle_new_user() (supabase-schema.sql) only copies full_name from
    // auth.users' metadata into the new profiles row -- checkride_timing
    // isn't part of that trigger, so it's set here as a direct update
    // rather than touching a trigger every other account-creation path
    // (admin-created instructors, etc.) also relies on.
    const safeUtm = sanitizeUtm(utm_first)
    const hasUtm = Object.values(safeUtm).some((v) => v !== null)
    if (safeCheckrideTiming || hasUtm) {
      await supabase.from('profiles').update({
        ...(safeCheckrideTiming ? { checkride_timing: safeCheckrideTiming } : {}),
        ...(hasUtm ? {
          signup_utm_source: safeUtm.source,
          signup_utm_medium: safeUtm.medium,
          signup_utm_campaign: safeUtm.campaign,
          signup_utm_content: safeUtm.content,
          signup_utm_term: safeUtm.term,
        } : {}),
      }).eq('id', created.user.id)
    }

    // Closes the referral attribution loop (supabase-portal-schema-
    // v73.sql) -- matches this signup against either a pending
    // email-invite referral or a ?ref=<code> link, whichever applies.
    // Never allowed to fail the signup itself: a referral bookkeeping
    // problem is not a reason to tell a real new member their account
    // creation failed.
    const safeRef = typeof ref === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(ref) ? ref : null
    try {
      const { error: referralError } = await supabase.rpc('record_referral_signup', {
        p_new_profile_id: created.user.id, p_email: email, p_ref_code: safeRef,
      })
      if (referralError) console.error('create-free-account: record_referral_signup failed', referralError)
    } catch (err) {
      console.error('create-free-account: record_referral_signup threw', err)
    }

    // Growth Sprint section 17 -- CFI/instructor distribution prep.
    // record_referral_signup() above only records attribution when
    // p_ref_code matches an existing member's portal_referral_codes row,
    // so a CFI who shares ?ref=<their own code> without ever having
    // created a portal account gets silently dropped today. Rather than
    // building a commission/payout system this sprint (explicitly out of
    // scope), this just makes every ref code that showed up on a signup
    // visible to admins -- matched or not -- via the same portal_events
    // table already used for GS cross-sell/challenge KPIs, so which
    // codes are actually driving signups is queryable immediately.
    if (safeRef) {
      await supabase.from('portal_events').insert({
        profile_id: created.user.id, event_type: 'signup_ref_code_used', metadata: { ref_code: safeRef },
      }).then((res: { error: unknown }) => {
        if (res.error) console.error('create-free-account: signup_ref_code_used log failed', res.error)
      })
    }

    // GS -> Portal Growth Funnel, section 8/18/19 -- source=ground_school&
    // intent=free_training identifies the Ground School landing page's
    // secondary free-account CTA as this signup's entry point, for the
    // "GS non-buyers -> portal" admin funnel metric (accounts created from
    // that specific CTA). Deliberately a distinct event, not the brief's
    // generic "portal_account_created" step -- that one already exists
    // and fires for every signup unconditionally (the 'signup' portal_
    // events row, supabase-portal-schema-v2.sql's handle_new_profile_
    // portal_event trigger); reusing that name here for a conditional,
    // source-specific event would be a second, confusingly-named event
    // for the same underlying thing.
    const safeSource = typeof source === 'string' && /^[a-z_]{1,40}$/.test(source) ? source : null
    const safeIntent = typeof intent === 'string' && /^[a-z_]{1,40}$/.test(intent) ? intent : null
    if (safeSource || safeIntent) {
      await supabase.from('portal_events').insert({
        profile_id: created.user.id, event_type: 'signup_entry_source', metadata: { source: safeSource, intent: safeIntent },
      }).then((res: { error: unknown }) => {
        if (res.error) console.error('create-free-account: signup_entry_source log failed', res.error)
      })
    }

    // GS -> Portal Growth Funnel, section 4 -- Purchase to Account
    // Attribution. handleGroundSchoolRegistration (stripe-webhook)
    // already links a $25 class purchase to an existing profile by email
    // at checkout time; this covers the other direction, someone who
    // bought anonymously (checkout never requires an account) and is
    // only now creating one. Without this, get_my_ground_school_
    // enrollments() (v65.sql, strictly profile_id = auth.uid()) would
    // never surface a class they already paid for. Same non-fatal
    // pattern as record_referral_signup above -- a reconciliation miss
    // is not a reason to fail account creation.
    try {
      const { data: gsClaimedCount, error: gsClaimError } = await supabase.rpc('claim_ground_school_enrollments_by_email', {
        p_profile_id: created.user.id, p_email: email,
      })
      if (gsClaimError) {
        console.error('create-free-account: claim_ground_school_enrollments_by_email failed', gsClaimError)
      } else if ((gsClaimedCount ?? 0) > 0) {
        // Section 19's "portal activations from purchasers" admin metric
        // needs a countable signal that this specific signup was a GS
        // purchaser activating, not just that reconciliation ran (it runs
        // for every signup, most of the time claiming nothing).
        // claim_ground_school_enrollments_by_email returning >0 (v77.sql)
        // is that signal.
        await supabase.from('portal_events').insert({
          profile_id: created.user.id, event_type: 'ground_school_purchaser_activated', metadata: { enrollments_claimed: gsClaimedCount },
        }).then((res: { error: unknown }) => {
          if (res.error) console.error('create-free-account: ground_school_purchaser_activated log failed', res.error)
        })
      }
    } catch (err) {
      console.error('create-free-account: claim_ground_school_enrollments_by_email threw', err)
    }

    // Checkride Readiness Assessment V1 -- same reconciliation pattern as
    // the GS enrollment claim just above: someone who took the free
    // assessment anonymously (readiness-assessment.html never requires
    // an account to see their score) and is only now creating one gets
    // every prior attempt attached to their new profile, not just the
    // one that triggered this signup. claim_readiness_assessment_by_email
    // (v78.sql) returns the count claimed for the same "countable signal"
    // reason as the GS claim.
    try {
      const { data: raClaimedCount, error: raClaimError } = await supabase.rpc('claim_readiness_assessment_by_email', {
        p_profile_id: created.user.id, p_email: email,
      })
      if (raClaimError) {
        console.error('create-free-account: claim_readiness_assessment_by_email failed', raClaimError)
      } else if ((raClaimedCount ?? 0) > 0) {
        await supabase.from('portal_events').insert({
          profile_id: created.user.id, event_type: 'readiness_assessment_claimed', metadata: { attempts_claimed: raClaimedCount },
        }).then((res: { error: unknown }) => {
          if (res.error) console.error('create-free-account: readiness_assessment_claimed log failed', res.error)
        })
      }
    } catch (err) {
      console.error('create-free-account: claim_readiness_assessment_by_email threw', err)
    }

    // Without an explicit redirectTo, generateLink falls back to whatever
    // the project's Auth "Site URL" is set to -- which defaults to
    // http://localhost:3000 on a fresh Supabase project until someone
    // changes it in the dashboard. Setting it explicitly here means the
    // link is always correct regardless of that dashboard setting.
    //
    // `dest` (a portal section id, e.g. "dpe-questions") rides along as a
    // query param on redirectTo -- Supabase appends its own auth tokens
    // as a URL fragment, not the query string, so this survives to
    // portal-reset-password.html untouched. Restricted to a plain
    // lowercase-alphanumeric-and-hyphen id since it ends up in a URL and
    // eventually a location.hash on the portal.
    // A caller-supplied dest (a lead-magnet page's own ?dest=, e.g.
    // checkride-prep.html's signup link) always wins -- that's a real,
    // deliberate routing decision already driving conversions elsewhere
    // and must not be silently overridden by the activation sequence's
    // own default. Only when nothing was supplied does this fall back to
    // the dashboard, where today's free oral-exam question already lives
    // front-and-center (see the "missing training stage" reasoning above)
    // -- an explicit 'dashboard' dest rather than leaving it blank, so
    // the welcome email's own copy/CTA and the actual landing page always
    // agree on what "get started" means.
    const requestedDest = typeof dest === 'string' && /^[a-z0-9-]{1,60}$/.test(dest) ? dest : ''
    const safeDest = requestedDest || 'dashboard'
    // Activation-email click attribution (activation_email_1_clicked,
    // fired client-side once these UTMs reach portal.html -- see
    // site/portal-stable.js) only applies to the generic activation
    // copy, not the lead-magnet variant, matching timingClause/subject/
    // bodyHtml's own requestedDest branch below.
    const activationUtm = requestedDest ? '' : '&utm_source=email&utm_medium=email&utm_campaign=new_member_activation&utm_content=welcome_1'
    const redirectTo = `${SITE_ORIGIN}/portal-reset-password.html?dest=${safeDest}${activationUtm}`
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    })
    const actionLink = linkData?.properties?.action_link
    // A missing link means there is no way to construct a working email at
    // all -- the account already exists in auth.users at this point (a
    // stray, password-less orphan), but better to surface a real error
    // here than to silently "succeed" and let a broken/undefined link
    // ship in the welcome email.
    if (linkError || !actionLink) {
      throw linkError ?? new Error('Failed to generate the account activation link.')
    }

    // send-email's result was previously never checked here -- if Resend
    // rejected the send (bad API key, rate limit, etc.), this function
    // still returned { ok: true } to the client, so the signup form
    // showed success while the member had no way to ever log in and
    // nothing was logged anywhere pointing at why. The account itself
    // was already created successfully above, so a failed send here
    // isn't fatal to the request -- but it must be visible to the
    // caller (see emailSent below) rather than swallowed.
    const firstName = name.split(' ')[0]
    // Only added when caller didn't already route this signup somewhere
    // specific (see safeDest above) -- a lead-magnet signup already has
    // its own reason for existing, and doesn't need the generic
    // activation framing layered on top of it.
    const timingClause = !requestedDest && safeCheckrideTiming ? (CHECKRIDE_TIMING_CLAUSE[safeCheckrideTiming] || '') : ''
    // Brief section 14's explicit carve-out: a subtle SECONDARY sentence
    // (never the main CTA) mentioning the paid system, only when
    // onboarding state is "clearly" checkride preparation. training_stage
    // itself doesn't exist yet at signup (see the CHECKRIDE_TIMING_CLAUSE
    // comment above) -- within_14_days is the closest real, known-at-
    // signup proxy for "clearly" close to the checkride, not a guess.
    const upsellClause = !requestedDest && safeCheckrideTiming === 'within_14_days'
      ? '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">If your checkride is coming up, the full Checkride Prep System is there when you\'re ready.</p>'
      : ''
    const subject = requestedDest ? 'Welcome to Apex Advantage — set your password' : `A good place to start, ${firstName}`
    const bodyHtml = requestedDest
      // Lead-magnet signup: the CTA IS the resource they signed up for --
      // don't compete with it by also recommending QOTD.
      ? `
          <h2 style="color:#F4B400;margin:0 0 4px;">Welcome to Apex Advantage, ${firstName}!</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your free member portal account is ready. Set your password to get in:</p>
          <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
          <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Once that's done, sign in any time at advantage.apexaviationtx.com/portal-login.html. From your dashboard you can register for live ground school sessions right away — and unlock the full Checkride Prep System (DPE question bank, scenario training, progress tracking) whenever you're ready.</p>
        `
      // New Member Activation, Email #1 -- personal note, one
      // recommended action, one CTA. See CHECKRIDE_TIMING_CLAUSE above
      // for why this can't yet be training_stage/focus_area-personalized.
      : `
          <h2 style="color:#F4B400;margin:0 0 4px;">Andrew here.</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">I saw you just joined Apex Advantage${timingClause}.</p>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">I'd start here: set your password, then answer today's oral exam question. It's free for every member and only takes a couple of minutes — the best way to start actually using the portal instead of just looking around.</p>
          <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Up My Account & Get Started →</a>
          ${upsellClause}
          <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">If you get stuck on anything, reply to this email.</p>
          <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Blue skies,<br>Andrew</p>
        `

    // ── Send the welcome email without letting it hold up (or fail) the
    // signup response ──
    // ACCOUNT CREATION MUST WIN: everything above this point (auth user,
    // profile updates) is already durably committed, so nothing below can
    // undo it. This block's only job is to attempt the email reliably and
    // report what it can, never to threaten the { ok: true } response.
    //
    // sendWelcomeEmail() itself can never throw (own try/catch) and never
    // resolves to anything but a boolean, so awaiting or backgrounding it
    // is equally safe either way -- the only difference is response
    // latency. It marks portal_events('activation_email_1') AFTER a
    // confirmed successful send, not before -- the inverse of the
    // "mark-before-send" convention used elsewhere in this codebase
    // (processWeakArea, processAbandonedCheckouts in send-lifecycle-
    // emails/index.ts). Those have no catch-up mechanism and optimize for
    // "never double-send" above all else; this one specifically needs the
    // opposite property -- a failed or not-yet-finished send must stay
    // eligible for processActivationEmail1CatchUp's cron retry (same
    // file, "Email #1 catch-up" section), so the flag can only mean
    // "confirmed delivered," never "attempted."
    const sendWelcomeEmail = async (): Promise<boolean> => {
      try {
        const emailResult = await supabase.functions.invoke('send-email', {
          body: {
            to: email,
            subject,
            html: emailTemplate(bodyHtml),
            ...(requestedDest ? {} : { replyTo: ACTIVATION_REPLY_TO }),
          },
        })
        if (emailResult.error) {
          console.error('create-free-account: send-email failed', {
            profile_id: created.user.id, email_type: 'activation_email_1', at: new Date().toISOString(),
            provider_error: emailResult.error?.message || String(emailResult.error), retry_eligible: !requestedDest,
          })
          return false
        }
        if (!requestedDest) {
          // Server-side send record for the activation funnel (signup ->
          // email sent -> CTA click -> first meaningful activity) --
          // same analytics_events table and shape as checkout_abandoned
          // in send-lifecycle-emails/index.ts. Only logged for the
          // actual activation-sequence copy, not the lead-magnet
          // variant, so the funnel isn't diluted by a structurally
          // different email.
          await supabase.from('analytics_events').insert({
            event_name: 'activation_email_1_sent', profile_id: created.user.id, properties: { checkride_timing: safeCheckrideTiming, via: 'signup' },
          })
        }
        // Idempotency flag for processActivationEmail1CatchUp (send-
        // lifecycle-emails/index.ts) -- set for BOTH branches (generic
        // activation copy AND the lead-magnet welcome variant), unlike
        // the analytics_events insert above. This one's job is purely
        // "was SOME welcome email confirmed delivered to this profile,"
        // so the cron catch-up knows not to layer a second, different
        // welcome email on top of an already-successful lead-magnet
        // send. The one accepted tradeoff: if a lead-magnet send is the
        // one that actually fails, catch-up still can't reproduce its
        // specific dest (never persisted) and falls back to the generic
        // copy -- documented in RETENTION_SYSTEM.md, not worth a new
        // column for a rare recovery path.
        // Deliberately NOT portal_email_log for this specific check
        // (that table is the immutable per-send audit trail); this
        // profile_id+event_type row is the "confirmed delivered" flag,
        // same shape as every hasMilestoneFired()/markMilestoneSent()
        // milestone in send-lifecycle-emails/index.ts, duplicated here
        // since these two functions share no module today.
        await supabase.from('portal_events').insert({ profile_id: created.user.id, event_type: 'activation_email_1' })
        await supabase.from('portal_email_log').insert({ profile_id: created.user.id, email_type: 'activation_email_1' })
        return true
      } catch (err) {
        console.error('create-free-account: send-email threw', {
          profile_id: created.user.id, email_type: 'activation_email_1', at: new Date().toISOString(),
          error: String(err), retry_eligible: !requestedDest,
        })
        return false
      }
    }

    // Bounded race, not an unconditional background dispatch: Resend
    // typically responds in well under a second, so the common case still
    // gets an accurate, synchronous emailSent value in the response (the
    // exact behavior signupSuccessResetBtn's fallback UI already depends
    // on in portal-login.html). Only a genuinely slow or hung provider
    // call falls back to the optimistic path below -- and even then, the
    // real send keeps running via EdgeRuntime.waitUntil() where the
    // runtime supports it, so its outcome still gets marked/logged
    // correctly once it actually finishes.
    const EMAIL_SEND_TIMEOUT_MS = 5000
    const sendPromise = sendWelcomeEmail()
    let settledInTime = false
    const trackedSendPromise = sendPromise.then((v) => { settledInTime = true; return v })
    const emailSent = await Promise.race([
      trackedSendPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), EMAIL_SEND_TIMEOUT_MS)),
    ])
    if (!settledInTime) {
      // Do not assume the promise survives past this point unless the
      // runtime explicitly says it will -- EdgeRuntime is a real Supabase
      // Edge Functions global for exactly this case, but only used when
      // actually present. With no such guarantee, the in-flight send may
      // or may not finish before the container tears down; if it doesn't,
      // the cron catch-up path (send-lifecycle-emails/index.ts) is the
      // safety net, since portal_events('activation_email_1') was never
      // marked.
      if (typeof EdgeRuntime !== 'undefined' && typeof (EdgeRuntime as any).waitUntil === 'function') {
        ;(EdgeRuntime as any).waitUntil(trackedSendPromise)
      }
    }

    return new Response(JSON.stringify({ ok: true, id: created.user.id, emailSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
