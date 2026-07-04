import { supabase } from './supabase'

const ORIGIN = window.location.origin

function template(content) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#06080f;font-family:'Helvetica Neue',Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="margin-bottom:28px;">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff;">APEX</span>
      <span style="font-size:22px;font-style:italic;color:#F4B400;font-family:Georgia,serif;"> Advantage</span>
    </div>
    ${content}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">
    <p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">Apex Aviation · San Marcos, TX (KHYI) · <a href="${ORIGIN}/ground-schedule" style="color:rgba(255,255,255,0.3);">View Schedule</a></p>
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
    <h2 style="color:#F4B400;margin:0 0 4px;">You're registered!</h2>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:0 0 24px;">Here's everything you need for your session.</p>

    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#fff;">${session.title}</h3>
      ${session.category ? `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#F4B400;border:1px solid rgba(244,180,0,0.3);border-radius:4px;padding:2px 8px;">${session.category}</span><br><br>` : ''}
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">🗓 ${fmtDate(session.scheduled_at)}</p>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">⏱ ${session.duration_minutes} minutes</p>
      ${session.location ? `<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">📍 ${session.location}</p>` : ''}
      ${session.meet_link ? `<a href="${session.meet_link}" style="display:inline-block;margin-top:14px;background:rgba(66,133,244,0.15);border:1px solid rgba(66,133,244,0.35);color:#60a5fa;border-radius:8px;padding:9px 18px;text-decoration:none;font-size:14px;font-weight:700;">📹 Join Google Meet →</a>` : ''}
    </div>

    <div style="background:rgba(244,180,0,0.07);border:1px solid rgba(244,180,0,0.2);border-radius:10px;padding:16px;margin-bottom:20px;">
      <p style="color:#F4B400;font-weight:700;margin:0 0 4px;font-size:15px;">💵 $25 due at the door</p>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0;">Cash or card accepted in-person.</p>
    </div>

    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px;">
      <p style="font-weight:700;margin:0 0 6px;font-size:15px;color:#fff;">Your Attendance Links</p>
      <p style="font-size:13px;color:rgba(255,255,255,0.45);margin:0 0 16px;line-height:1.5;">Click these links at the start and end of class to receive course credit. Keep this email!</p>
      <a href="${checkInUrl}" style="display:block;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#4ade80;border-radius:8px;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;margin-bottom:10px;font-size:14px;">✓ Check In — click when class starts</a>
      <a href="${checkOutUrl}" style="display:block;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:8px;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;font-size:14px;">↑ Check Out — click when class ends</a>
    </div>
  `)

  return invoke({ to: registration.email, subject: `Registered: ${session.title}`, html })
}

export async function sendBulkMessage(registrants, session, subject, message) {
  const html = template(`
    <h2 style="color:#F4B400;margin:0 0 4px;">${subject}</h2>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin:20px 0;">
      <p style="font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;color:#e0e0e0;">${message}</p>
    </div>
    <p style="font-size:13px;color:rgba(255,255,255,0.35);margin-top:16px;">Session: ${session.title} · ${fmtDate(session.scheduled_at)}</p>
  `)

  return Promise.all(
    registrants.map(r =>
      invoke({ to: r.email, subject: `[Apex Advantage] ${subject}`, html })
    )
  )
}

export async function sendWaitlistConfirmation(registration, session) {
  const html = template(`
    <h2 style="color:#fbbf24;margin:0 0 4px;">You're on the waitlist</h2>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:0 0 24px;">This session is full, but you're on the list if a spot opens.</p>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;">
      <h3 style="margin:0 0 8px;color:#fff;">${session.title}</h3>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">🗓 ${fmtDate(session.scheduled_at)}</p>
      ${session.location ? `<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">📍 ${session.location}</p>` : ''}
    </div>
    <p style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:16px;">We'll email you if a spot opens up. No payment is due until you're confirmed.</p>
  `)

  return invoke({ to: registration.email, subject: `Waitlist: ${session.title}`, html })
}

export async function sendWaitlistPromotion(registration, session) {
  const checkInUrl = `${ORIGIN}/attend/in/${registration.check_in_token}`
  const checkOutUrl = `${ORIGIN}/attend/out/${registration.check_out_token}`

  const html = template(`
    <h2 style="color:#4ade80;margin:0 0 4px;">Good news — you're in!</h2>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:0 0 24px;">A spot opened up and you've been moved from the waitlist.</p>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 8px;color:#fff;">${session.title}</h3>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">🗓 ${fmtDate(session.scheduled_at)}</p>
      ${session.location ? `<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:4px 0;">📍 ${session.location}</p>` : ''}
      ${session.meet_link ? `<a href="${session.meet_link}" style="display:inline-block;margin-top:14px;background:rgba(66,133,244,0.15);border:1px solid rgba(66,133,244,0.35);color:#60a5fa;border-radius:8px;padding:9px 18px;text-decoration:none;font-size:14px;font-weight:700;">📹 Join Google Meet →</a>` : ''}
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px;">
      <p style="font-weight:700;margin:0 0 12px;color:#fff;">Your Attendance Links</p>
      <a href="${checkInUrl}" style="display:block;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#4ade80;border-radius:8px;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;margin-bottom:10px;">✓ Check In</a>
      <a href="${checkOutUrl}" style="display:block;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:8px;padding:13px 16px;text-decoration:none;font-weight:700;text-align:center;">↑ Check Out</a>
    </div>
  `)

  return invoke({ to: registration.email, subject: `Spot confirmed: ${session.title}`, html })
}

async function invoke(payload) {
  try {
    const { error } = await supabase.functions.invoke('send-email', { body: payload })
    if (error) console.warn('Email send failed:', error)
  } catch (e) {
    console.warn('Email invoke error:', e)
  }
}
