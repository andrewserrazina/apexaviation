// One-time email blast nudging existing members about the referral
// program. Built because the dormancy was confirmed real: 304 members,
// 191 referral codes issued, 0 rows in portal_referrals, even after the
// in-app dashboard banner (renderReferralPromoBanner(), site/portal-
// stable.js) shipped and the reward was repointed at Free Checkride Prep
// (v164). That banner only reaches someone who happens to be logged in
// that week and can be dismissed forever -- this is the first time the
// program has ever been pushed to members who aren't already looking at
// the dashboard.
//
// Not wired into send-lifecycle-emails's cron/dedup machinery on
// purpose: this is a single deliberate send, not an ongoing trigger.
// Reuses that file's HTML template conventions (template()/emailHeadline/
// emailParagraph/emailButton, inlined here for the same reason
// send-lifecycle-emails and stripe-webhook inline it -- this project's
// single-file MCP deploy path can't resolve a relative import reaching
// outside this function's own directory) and the same send-email
// Edge Function as its delivery path, so it shows up in Resend/inbox
// exactly like every other Apex Advantage email.
//
// Eligibility (mirrors renderReferralPromoBanner()'s own exclusions, so
// this doesn't pitch a reward to someone the in-app banner already
// considers "not a fit"):
//   - role = 'student' (never instructors/admins)
//   - email_marketing_opt_out is not true
//   - checkride_prep_unlocked is not true -- the reward has no value to
//     someone who already has it
//   - no portal_email_log row for EMAIL_TYPE yet, so re-running this
//     function (e.g. to finish a batch the global cap cut off) never
//     double-sends to the same member
//
// Every member in scope gets a referral code minted on the spot if they
// don't already have one (112 of 301 students had never opened the
// referral card client-side, so ensureReferralCode() in portal-
// stable.js never ran for them) -- same code shape as that function's
// own makeReferralCode(), so a member who later visits the portal page
// sees the identical code this email already sent them, not a second,
// different one.
//
// Auth: public endpoint, no Supabase session exists for this kind of
// trigger (same reasoning as send-lifecycle-emails/andrewos-metrics) --
// enforced via the X-Referral-Nudge-Secret header, checked against
// internal_admin_secrets (key='referral_nudge_secret') rather than a
// Deno env secret. That's a deliberate deviation from this repo's usual
// LIFECYCLE_CRON_SECRET-style env var: the normal Supabase Edge Function
// secret manager's interactive value-entry flow was unavailable when
// this shipped, so the token lives in Postgres instead (service-role-
// only, no RLS policies -- see v166_internal_admin_secrets). Fails
// closed if no row is found, same as LIFECYCLE_CRON_SECRET's own
// fail-closed design.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-referral-nudge-secret',
}

const EMAIL_TYPE = 'referral_nudge_2026_11'
// Keeps one invocation well inside the Edge Function timeout and away
// from Resend rate limits -- same bounded-batch reasoning as send-
// lifecycle-emails's GLOBAL_SEND_SUCCESS_CAP, just simpler since this
// is a single deliberate run, not a recurring job juggling many
// campaigns at once. Call again (same secret) to pick up the next
// batch; `remaining` in the response says whether there is one.
const DEFAULT_BATCH_LIMIT = 60

// Inlined -- see header comment. Must stay visually consistent with
// send-lifecycle-emails/index.ts's own template(), not byte-identical
// (no shared test enforces that here, unlike _shared/emailTemplate.ts).
function template(content: string): string {
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

function emailHeadline(text: string): string {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${text}</h2>`
}

function emailParagraph(text: string, opts?: { muted?: boolean }): string {
  const color = opts?.muted ? '#4B5563' : '#1F2937'
  const size = opts?.muted ? '13px' : '15px'
  return `<p style="color:${color};font-size:${size};line-height:1.7;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;">${text}</p>`
}

function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:#F4B400;">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;color:#0B1F3A;text-decoration:none;font-weight:bold;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${label}</a>` +
    `</td></tr></table>`
}

// Same shape as site/portal-stable.js's own makeReferralCode() (first
// name, A-Z only, 8 chars max, + 4 random digits) so a member who later
// opens the portal's referral card sees this exact code, not a second
// one minted by ensureReferralCode()'s own upsert racing this one.
function makeReferralCode(fullName: string | null): string {
  const base = (fullName || 'PILOT').split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'PILOT'
  return base + String(Math.floor(1000 + Math.random() * 9000))
}

// Mirrors renderReferralPromoBanner()'s own exclusions (see that
// function in site/portal-stable.js) -- see header comment for why.
// Declared as a named type (not inlined in the parameter list) so the
// extraction in sendReferralNudge.test.js, which brace-matches from
// this function's own name, doesn't trip over the type's braces.
type ReferralEligibilityProfile = {
  role: string
  email: string | null
  email_marketing_opt_out: boolean | null
  checkride_prep_unlocked: boolean | null
}

function isEligibleProfile(profile: ReferralEligibilityProfile): boolean {
  return profile.role === 'student'
    && !!profile.email
    && profile.email_marketing_opt_out !== true
    && profile.checkride_prep_unlocked !== true
}

function emailTemplateReferralNudge(firstName: string, referralLink: string): string {
  return emailHeadline(`${firstName}, know someone chasing their checkride?`) +
    emailParagraph(
      `Share your personal referral link below. The moment a friend you refer enrolls at Apex Advantage, you unlock the <strong>Checkride Prep System free</strong> &mdash; a $29 value, instant access to 300+ DPE-style oral questions, model answers, and AI DPE Practice.`,
    ) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:#F5F7FA;border:1px solid #E5E7EB;border-radius:6px;padding:14px 16px;">` +
    `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#4B5563;margin-bottom:6px;font-family:Arial,Helvetica,sans-serif;">Your referral link</div>` +
    `<div style="font-size:14px;color:#0B1F3A;font-family:Arial,Helvetica,sans-serif;word-break:break-all;">${referralLink}</div>` +
    `</td></tr></table>` +
    emailButton('Go to Your Referral Dashboard', 'https://apexaviationtx.com/portal.html#account') +
    emailParagraph(
      `Already referred someone? Log in to check your reward status &mdash; rewards show up automatically once a referral enrolls.`,
      { muted: true },
    )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // See header comment: this checks internal_admin_secrets instead of
    // a Deno env secret. Fails closed if no row is stored yet.
    const { data: secretRow, error: secretError } = await supabase
      .from('internal_admin_secrets')
      .select('value')
      .eq('key', 'referral_nudge_secret')
      .maybeSingle()
    if (secretError) throw secretError
    if (!secretRow?.value) {
      return new Response(JSON.stringify({ error: 'referral_nudge_secret is not configured in internal_admin_secrets -- refusing to run' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (req.headers.get('x-referral-nudge-secret') !== secretRow.value) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    const limit = Number.isFinite(body?.limit) && body.limit > 0 ? Math.min(body.limit, 200) : DEFAULT_BATCH_LIMIT

    // Test mode: sends exactly one preview email to an address the
    // caller controls, using sample data -- no DB reads/writes of any
    // real member row, no portal_email_log entry, completely separate
    // from the real run below. Lets a human review the actual rendered
    // email before any real member is ever touched.
    if (typeof body?.testEmail === 'string' && body.testEmail) {
      const html = emailTemplateReferralNudge('Alex', 'https://apexaviationtx.com/contact.html?ref=ALEX4821')
      const res = await supabase.functions.invoke('send-email', {
        body: { to: body.testEmail, subject: 'Know someone chasing their checkride? [PREVIEW]', html: template(html) },
      })
      return new Response(JSON.stringify({ ok: !res.error, testMode: true, error: res.error ?? null }), {
        status: res.error ? 500 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: alreadySent, error: logError } = await supabase
      .from('portal_email_log')
      .select('profile_id')
      .eq('email_type', EMAIL_TYPE)
    if (logError) throw logError
    const alreadySentIds = new Set((alreadySent ?? []).map((r: { profile_id: string }) => r.profile_id))

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, email_marketing_opt_out, checkride_prep_unlocked')
      .eq('role', 'student')
    if (profilesError) throw profilesError

    const eligible = (profiles ?? [])
      .filter((p: any) => isEligibleProfile(p) && !alreadySentIds.has(p.id))
      .slice(0, limit)

    const results = { sent: 0, failed: 0, errors: [] as string[] }

    for (const profile of eligible) {
      try {
        const { data: existingCode } = await supabase
          .from('portal_referral_codes')
          .select('code')
          .eq('profile_id', profile.id)
          .maybeSingle()

        let code = existingCode?.code ?? null
        if (!code) {
          // Retry a couple of times on a (rare) unique-constraint
          // collision against another member's code -- same reasoning
          // as any other random-token generator racing a unique index.
          for (let attempt = 0; attempt < 3 && !code; attempt++) {
            const candidate = makeReferralCode(profile.full_name)
            const { data: inserted, error: insertErr } = await supabase
              .from('portal_referral_codes')
              .insert({ profile_id: profile.id, code: candidate })
              .select('code')
              .single()
            if (!insertErr) code = inserted.code
            else if (insertErr.code !== '23505') throw insertErr
          }
        }
        if (!code) {
          results.failed++
          results.errors.push(`${profile.id}: could not mint a referral code after retries`)
          continue
        }

        const firstName = (profile.full_name || 'there').split(/\s+/)[0]
        const referralLink = `https://apexaviationtx.com/contact.html?ref=${code}`
        const html = emailTemplateReferralNudge(firstName, referralLink)

        const sendRes = await supabase.functions.invoke('send-email', {
          body: { to: profile.email, subject: "Know someone chasing their checkride?", html: template(html) },
        })
        if (sendRes.error) {
          results.failed++
          results.errors.push(`${profile.id}: ${sendRes.error.message ?? JSON.stringify(sendRes.error)}`)
          continue
        }

        await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: EMAIL_TYPE })
        results.sent++
      } catch (err) {
        results.failed++
        results.errors.push(`${profile.id}: ${String(err)}`)
      }
    }

    const totalEligibleRemaining = (profiles ?? []).filter((p: any) => isEligibleProfile(p) && !alreadySentIds.has(p.id)).length - eligible.length

    return new Response(JSON.stringify({ ok: true, ...results, batchSize: eligible.length, remaining: Math.max(totalEligibleRemaining, 0) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
