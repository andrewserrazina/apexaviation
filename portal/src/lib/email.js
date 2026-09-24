import { supabase } from './supabase'

const ORIGIN = window.location.origin

// Corrected design system (email-system audit): this shell previously
// diverged independently from the one in
// portal/supabase/functions/_shared/emailTemplate.ts -- different
// wordmark treatment (plain text, no logo image), different footer
// address ("San Marcos, TX (KHYI)" vs. the site's own published
// schema.org contact address, "Austin, TX" -- see site/contact.html),
// near-black background with translucent white text, and heavy
// decorative emoji throughout. Brought in line with that shared shell:
// navy header with the real logo asset, white reading area, solid-hex
// text colors (never rgba against a background that might change),
// square corners, no decorative emoji. Kept as its own function (not an
// import of _shared/emailTemplate.ts) because this file ships in the
// portal's browser bundle, not a Supabase Edge Function -- there is no
// cross-runtime module to share directly.
function template(content) {
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
      <tr><td style="padding:20px 24px 28px;border-top:1px solid #E5E7EB;">
        <p style="font-size:12px;color:#4B5563;margin:16px 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          Apex Aviation &middot; Austin, TX &middot; <a href="${ORIGIN}/ground-schedule" style="color:#4B5563;text-decoration:underline;">View Schedule</a>
        </p>
      </td></tr>
    </table>
  </div>
</body></html>`
}

function fmtDate(dt) {
  return new Date(dt).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export async function sendRegistrationConfirmation(registration, session) {
  const checkInUrl = `${ORIGIN}/attend/in/${registration.check_in_token}`
  const checkOutUrl = `${ORIGIN}/attend/out/${registration.check_out_token}`

  const html = template(`
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">You're registered!</h2>
    <p style="color:#4B5563;font-size:14px;margin:0 0 24px;">Here's everything you need for your session.</p>

    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#0B1F3A;">${session.title}</h3>
      ${session.category ? `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8A6B0E;background:#FEF3C7;border-radius:0;padding:2px 8px;">${session.category}</span><br><br>` : ''}
      <p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Date:</strong> ${fmtDate(session.scheduled_at)}</p>
      <p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Duration:</strong> ${session.duration_minutes} minutes</p>
      ${session.location ? `<p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Location:</strong> ${session.location}</p>` : ''}
      ${session.meet_link ? `<a href="${session.meet_link}" style="display:inline-block;margin-top:14px;background:#FFFFFF;border:1.5px solid #0B1F3A;color:#0B1F3A;border-radius:0;padding:9px 18px;text-decoration:none;font-size:14px;font-weight:700;">Join Google Meet &rarr;</a>` : ''}
    </div>

    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:0;padding:16px;margin-bottom:20px;">
      <p style="color:#8A6B0E;font-weight:700;margin:0 0 4px;font-size:15px;">$25 due at the door</p>
      <p style="color:#4B5563;font-size:13px;margin:0;">Cash or card accepted in-person.</p>
    </div>

    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:18px;">
      <p style="font-weight:700;margin:0 0 6px;font-size:15px;color:#0B1F3A;">Your Attendance Links</p>
      <p style="font-size:13px;color:#4B5563;margin:0 0 16px;line-height:1.5;">Click these links at the start and end of class to receive course credit. Keep this email!</p>
      <a href="${checkInUrl}" style="display:block;background:#0B1F3A;color:#FFFFFF;border-radius:0;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;margin-bottom:10px;font-size:14px;">Check In &mdash; click when class starts</a>
      <a href="${checkOutUrl}" style="display:block;background:#FFFFFF;border:1.5px solid #0B1F3A;color:#0B1F3A;border-radius:0;padding:12px 16px;text-decoration:none;font-weight:700;text-align:center;font-size:14px;">Check Out &mdash; click when class ends</a>
    </div>
  `)

  return invoke({ to: registration.email, subject: `Registered: ${session.title}`, html })
}

export async function sendBulkMessage(registrants, session, subject, message) {
  const html = template(`
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">${subject}</h2>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin:20px 0;">
      <p style="font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;color:#1F2937;">${message}</p>
    </div>
    <p style="font-size:13px;color:#4B5563;margin-top:16px;">Session: ${session.title} &middot; ${fmtDate(session.scheduled_at)}</p>
  `)

  return sendPaced(registrants, (r) => invoke({ to: r.email, subject: `[Apex Advantage] ${subject}`, html }))
}

export async function sendWaitlistConfirmation(registration, session) {
  const html = template(`
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">You're on the waitlist</h2>
    <p style="color:#4B5563;font-size:14px;margin:0 0 24px;">This session is full, but you're on the list if a spot opens.</p>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;">
      <h3 style="margin:0 0 8px;color:#0B1F3A;">${session.title}</h3>
      <p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Date:</strong> ${fmtDate(session.scheduled_at)}</p>
      ${session.location ? `<p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Location:</strong> ${session.location}</p>` : ''}
    </div>
    <p style="font-size:13px;color:#4B5563;margin-top:16px;">We'll email you if a spot opens up. No payment is due until you're confirmed.</p>
  `)

  return invoke({ to: registration.email, subject: `Waitlist: ${session.title}`, html })
}

export async function sendWaitlistPromotion(registration, session) {
  const checkInUrl = `${ORIGIN}/attend/in/${registration.check_in_token}`
  const checkOutUrl = `${ORIGIN}/attend/out/${registration.check_out_token}`

  const html = template(`
    <h2 style="color:#15803D;margin:0 0 4px;font-size:22px;line-height:1.3;">Good news &mdash; you're in!</h2>
    <p style="color:#4B5563;font-size:14px;margin:0 0 24px;">A spot opened up and you've been moved from the waitlist.</p>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 8px;color:#0B1F3A;">${session.title}</h3>
      <p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Date:</strong> ${fmtDate(session.scheduled_at)}</p>
      ${session.location ? `<p style="color:#1F2937;font-size:14px;margin:4px 0;"><strong>Location:</strong> ${session.location}</p>` : ''}
      ${session.meet_link ? `<a href="${session.meet_link}" style="display:inline-block;margin-top:14px;background:#FFFFFF;border:1.5px solid #0B1F3A;color:#0B1F3A;border-radius:0;padding:9px 18px;text-decoration:none;font-size:14px;font-weight:700;">Join Google Meet &rarr;</a>` : ''}
    </div>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:18px;">
      <p style="font-weight:700;margin:0 0 12px;color:#0B1F3A;">Your Attendance Links</p>
      <a href="${checkInUrl}" style="display:block;background:#0B1F3A;color:#FFFFFF;border-radius:0;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;margin-bottom:10px;">Check In</a>
      <a href="${checkOutUrl}" style="display:block;background:#FFFFFF;border:1.5px solid #0B1F3A;color:#0B1F3A;border-radius:0;padding:12px 16px;text-decoration:none;font-weight:700;text-align:center;">Check Out</a>
    </div>
  `)

  return invoke({ to: registration.email, subject: `Spot confirmed: ${session.title}`, html })
}

// Resend's plan caps outbound sends at 2 requests/second. A concurrency-
// capped worker pool (the previous mapWithConcurrency, 5-wide) still fires
// that many requests as fast as each slot frees up -- with no pacing
// between them, even 5-wide concurrency blows straight through that limit
// the moment a batch has more than a couple of recipients, and a 429 was
// never retried, just logged and permanently marked failed. This wasn't
// theoretical: a real 113-recipient broadcast came back sent: 57,
// failed: 56 within seconds of launch, once the burst hit Resend's limit.
//
// Fix: serialize sends at a fixed pace comfortably under 2/sec (sendPaced,
// below) instead of firing them concurrently, and retry a failed send
// with backoff (invoke, below) instead of giving up after one try -- a
// rate limit or a dropped connection shouldn't permanently drop someone
// from a broadcast.
const RESEND_MIN_INTERVAL_MS = 600 // ~1.67 req/sec, safely under Resend's 2/sec cap
const RESEND_MAX_ATTEMPTS = 3
const RESEND_RETRY_BASE_MS = 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Returns true/false so callers (sendAdminEmail's batch, in particular)
// can tell a real delivery failure apart from success, rather than every
// send being reported as sent regardless of what actually happened.
async function invoke(payload) {
  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await supabase.functions.invoke('send-email', { body: payload })
      if (!error) return true
      // send-email is a bare passthrough to Resend, so a non-2xx from
      // Resend (429 rate-limited, 5xx transient) comes back as this same
      // non-2xx status on the Edge Function response -- supabase-js
      // surfaces it as a FunctionsHttpError whose .context is the raw
      // Response. A 4xx other than 429 (bad address, malformed payload)
      // won't succeed on retry, so don't waste attempts on it.
      const status = error?.context?.status
      console.warn(`Email send failed (attempt ${attempt}/${RESEND_MAX_ATTEMPTS}, status ${status ?? 'unknown'}):`, error)
      if (status && status !== 429 && status < 500) return false
    } catch (e) {
      console.warn(`Email invoke error (attempt ${attempt}/${RESEND_MAX_ATTEMPTS}):`, e)
    }
    if (attempt < RESEND_MAX_ATTEMPTS) await sleep(RESEND_RETRY_BASE_MS * attempt)
  }
  return false
}

// Sends items one at a time at a fixed pace, not concurrently, so a large
// broadcast can't outrun Resend's rate limit. Slower wall-clock time for a
// big list than the old concurrency-capped version, but "68 seconds for
// 113 people" beats "half of them silently never got it."
async function sendPaced(items, fn) {
  const results = []
  for (const item of items) {
    results.push(await fn(item))
    await sleep(RESEND_MIN_INTERVAL_MS)
  }
  return results
}

// Admin-composed ad-hoc email to one or more students (per-student "Email"
// action on the Students page, or the Broadcast page). Sends via the same
// send-email function as everything else in this file, then logs the
// broadcast + its recipients so admins can see who's already been
// contacted and avoid duplicate outreach.
//
// isHtml controls how `message` drops into the template: plain-text mode
// (default) wraps it in a <p style="white-space:pre-wrap"> so literal
// newlines the admin typed still show up as line breaks. HTML mode skips
// that wrapper entirely and inserts `message` as-is -- wrapping arbitrary
// admin-authored markup (which may contain its own <p>/<div>/<table>
// tags) in another <p> would be invalid nesting, and pre-wrap would turn
// every bit of the admin's own source indentation into visible gaps in
// the sent email. Nothing here escapes or sanitizes `message` in either
// mode -- this has always been true of this function (see send-email's
// own handling), so HTML mode doesn't change the trust boundary, only
// which wrapper is used.
export async function sendAdminEmail({ recipients, subject, message, senderId, isHtml = false }) {
  const body = isHtml
    ? message
    : `<p style="font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;color:#1F2937;">${message}</p>`
  const html = template(`
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">${subject}</h2>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin:20px 0;">
      ${body}
    </div>
  `)

  const outcomes = await sendPaced(recipients, (r) => invoke({ to: r.email, subject, html }))
  const sentCount = outcomes.filter(Boolean).length
  const failedCount = outcomes.length - sentCount

  const { data: broadcast, error: broadcastError } = await supabase
    .from('admin_broadcasts')
    .insert({ sent_by: senderId, subject, body: message, recipient_count: recipients.length })
    .select()
    .single()
  if (broadcastError) throw broadcastError

  // delivered records each recipient's real outcome (v82.sql) -- so a
  // future rate-limit hit or bad address can be found with one query
  // instead of exporting Resend's own send log and diffing it by hand.
  const { error: recipientsError } = await supabase
    .from('admin_broadcast_recipients')
    .insert(recipients.map((r, i) => ({ broadcast_id: broadcast.id, profile_id: r.id, email: r.email, delivered: outcomes[i] })))
  if (recipientsError) throw recipientsError

  return { sent: sentCount, failed: failedCount, broadcastId: broadcast.id }
}

// Audience Builder send path (supabase-portal-schema-v145). Unlike
// sendAdminEmail() above, this never fetches recipients itself --
// admin_create_broadcast_snapshot() re-evaluates segmentDefinition
// server-side (opt-out/missing-email always enforced, no way to bypass
// from here) and returns the exact, already-persisted
// admin_broadcast_recipients rows to send to. This function only sends
// to what that RPC handed back and then records each row's real
// outcome -- it has no path to add, remove, or substitute a recipient.
//
// Reuses the same template()/sendPaced()/invoke() as sendAdminEmail()
// on purpose, so both paths share one Resend-calling, rate-limiting,
// and retry implementation -- the only thing that differs between them
// is how the recipient list and admin_broadcasts row were created.
export async function sendSegmentedBroadcast({ segmentDefinition, subject, message, isHtml = false, audienceLabel }) {
  const { data: rows, error: snapshotError } = await supabase.rpc('admin_create_broadcast_snapshot', {
    p_segment: segmentDefinition,
    p_subject: subject,
    p_body: message,
    p_audience_label: audienceLabel ?? null,
  })
  if (snapshotError) throw snapshotError
  if (!rows || rows.length === 0) throw new Error('No eligible recipients matched this audience.')

  const broadcastId = rows[0].broadcast_id
  const body = isHtml
    ? message
    : `<p style="font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;color:#1F2937;">${message}</p>`
  const html = template(`
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">${subject}</h2>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin:20px 0;">
      ${body}
    </div>
  `)

  const outcomes = await sendPaced(rows, (r) => invoke({ to: r.email, subject, html }))
  const sentIds = rows.filter((_, i) => outcomes[i]).map(r => r.recipient_id)
  const failedIds = rows.filter((_, i) => !outcomes[i]).map(r => r.recipient_id)

  if (sentIds.length) await supabase.from('admin_broadcast_recipients').update({ delivered: true }).in('id', sentIds)
  if (failedIds.length) await supabase.from('admin_broadcast_recipients').update({ delivered: false }).in('id', failedIds)

  const sentCount = outcomes.filter(Boolean).length
  return { sent: sentCount, failed: outcomes.length - sentCount, broadcastId, eligibleCount: rows.length }
}

// Test-send path: composes the exact same template as a real broadcast
// but sends to one address only and never touches admin_broadcasts /
// admin_broadcast_recipients -- a test send is not a campaign and
// should not appear in broadcast history or count against any
// recipient's suppression/recent-email state.
export async function sendTestEmail({ toEmail, subject, message, isHtml = false }) {
  const body = isHtml
    ? message
    : `<p style="font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;color:#1F2937;">${message}</p>`
  const html = template(`
    <div style="background:#FEF3C7;border:1px solid #FDE68A;padding:10px 16px;margin-bottom:16px;font-size:12px;font-weight:700;color:#8A6B0E;">TEST EMAIL -- not sent to any real audience</div>
    <h2 style="color:#0B1F3A;margin:0 0 4px;font-size:22px;line-height:1.3;">${subject}</h2>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:0;padding:20px;margin:20px 0;">
      ${body}
    </div>
  `)
  const ok = await invoke({ to: toEmail, subject: `[TEST] ${subject}`, html })
  if (!ok) throw new Error('Test email failed to send.')
  return { sent: true }
}
