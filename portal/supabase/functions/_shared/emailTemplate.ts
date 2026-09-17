// Shared branded HTML shell + reusable components for every Apex
// Advantage transactional and lifecycle email (Stripe purchase
// confirmations, the signup welcome email, lifecycle nudges).
//
// Corrected design system (email-system audit): the shell previously
// used a near-black body background (#06080f) with rgba(255,255,255,N)
// text -- readable in isolation, but off the approved brand standard
// (Deep Navy #0B1F3A / Aviation Gold #F4B400 / White / Soft Gray
// #E5E7EB) and fragile: rgba() text color depends on the exact
// background it's composited over, so copy-pasting a paragraph onto a
// different background (as portal/src/lib/email.js's independent copy
// of this shell had already started to do, with its own drifted
// palette and footer) silently produces low- or zero-contrast text.
// This version uses solid hex colors throughout for exactly that
// reason, and moves the reading area to white so the approved navy/gold
// palette actually appears where the standard says it should: navy
// header band, white body, navy headlines, gold reserved for the one
// primary CTA and small accents.
//
// NOTE: this repo has no Apex_Advantage_Visual_Design_Standards_Manual
// or Graphics_Asset_Standards_Manual on disk (searched exhaustively --
// see EMAIL_SYSTEM_AUDIT_REPORT.md's "Branding references" section).
// The tokens below implement the color table and explicit requirements
// given directly in the audit brief (navy/gold/white/soft-gray, square
// CTA corners, minimum 150px logo width, no decorative emoji, no
// italic-serif wordmark mixing) -- they are not transcribed from a
// manual, because no such manual exists in this workspace.
//
// This file is ALSO duplicated, byte-for-byte, inline in BOTH
// stripe-webhook/index.ts AND create-checkout-session/index.ts (neither
// function's deploy path can resolve a relative import reaching outside
// its own directory -- see the comment in each). Any change here must be
// mirrored in both, not just one -- a byte-identity test in
// portal/test/emailTemplates.test.js checks all three stay in sync.
export const EMAIL_COLORS = {
  navy: '#0B1F3A',
  gold: '#F4B400',
  white: '#FFFFFF',
  softGray: '#E5E7EB',
  bodyText: '#1F2937', // solid dark slate -- high-contrast on white, not rgba
  mutedText: '#4B5563', // solid mid-gray for fine print/secondary lines
} as const

export function emailTemplate(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.softGray};font-family:Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.bodyText};">
  <div style="max-width:560px;margin:0 auto;background:${EMAIL_COLORS.white};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.navy};">
      <tr><td align="center" style="padding:28px 16px;">
        <img src="https://apexaviationtx.com/apexwhite.png" alt="Apex Advantage" width="160" style="display:block;margin:0 auto 10px;height:auto;max-width:160px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:2px;color:${EMAIL_COLORS.white};font-family:Arial,Helvetica,sans-serif;">APEX ADVANTAGE</div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 24px 8px;">
        ${content}
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:20px 24px 28px;border-top:1px solid ${EMAIL_COLORS.softGray};margin-top:12px;">
        <p style="font-size:12px;color:${EMAIL_COLORS.mutedText};margin:16px 0 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Apex Aviation &middot; Austin, TX</p>
        <p style="font-size:11px;margin:0 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com" style="color:${EMAIL_COLORS.mutedText};text-decoration:underline;">apexaviationtx.com</a>
        </p>
        <p style="font-size:11px;margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com/email-preferences.html" style="color:${EMAIL_COLORS.mutedText};text-decoration:underline;">Manage email preferences</a>
        </p>
      </td></tr>
    </table>
  </div>
</body></html>`
}

// ── Reusable content components ──
// Not every existing caller has been converted to use these yet (see
// EMAIL_SYSTEM_AUDIT_REPORT.md's architecture section for which files
// still inline their own <h2>/<p> markup) -- they exist so new and
// newly-rewritten email bodies build on one consistent set of pieces
// instead of each hand-writing its own inline styles, and so a future
// full conversion pass has a real target to convert callers onto.

export function emailHeadline(text: string): string {
  return `<h2 style="color:${EMAIL_COLORS.navy};margin:0 0 12px;font-size:22px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${text}</h2>`
}

export function emailParagraph(text: string, opts?: { muted?: boolean }): string {
  const color = opts?.muted ? EMAIL_COLORS.mutedText : EMAIL_COLORS.bodyText
  const size = opts?.muted ? '13px' : '15px'
  return `<p style="color:${color};font-size:${size};line-height:1.7;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;">${text}</p>`
}

// Square corners per the audit brief's explicit branding correction
// (previous buttons used border-radius:8px). Gold background + navy
// text is the one place gold appears as more than a small accent, per
// "one visually prominent gold primary CTA."
export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:${EMAIL_COLORS.gold};">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;color:${EMAIL_COLORS.navy};text-decoration:none;font-weight:bold;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${label}</a>` +
    `</td></tr></table>`
}

export function emailSecondaryLink(label: string, href: string): string {
  return `<a href="${href}" style="color:${EMAIL_COLORS.navy};text-decoration:underline;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${label}</a>`
}

export function emailDivider(): string {
  return `<hr style="border:none;border-top:1px solid ${EMAIL_COLORS.softGray};margin:20px 0;">`
}

// Andrew's personal sign-off, used by the New Member Activation
// sequence and the welcome note -- kept as one function so every
// first-person send closes the same way rather than each caller
// retyping "Blue skies,<br>Andrew" with its own line-height/color.
export function emailSignoff(closing: string = 'Blue skies,'): string {
  return `<p style="color:${EMAIL_COLORS.mutedText};font-size:13px;line-height:1.6;margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;">${closing}<br>Andrew</p>`
}
