// Shared branded HTML shell for every Apex Advantage transactional
// email (Stripe purchase confirmations, the signup welcome email,
// lifecycle nudges). Previously duplicated verbatim across
// create-free-account, stripe-webhook, and send-lifecycle-emails --
// one copy here instead, so branding changes don't have to be applied
// three times and can't drift out of sync.
export function emailTemplate(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#06080f;font-family:'Helvetica Neue',Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;padding-bottom:24px;margin-bottom:28px;border-bottom:2px solid rgba(244,180,0,0.25);">
      <img src="https://apexaviationtx.com/apexwhite.png" alt="Apex Aviation" width="140" style="display:inline-block;margin-bottom:12px;height:auto;" />
      <div style="font-size:15px;font-weight:700;letter-spacing:2px;color:#fff;">
        APEX <span style="font-style:italic;font-weight:400;color:#F4B400;font-family:Georgia,serif;letter-spacing:normal;">Advantage</span>
      </div>
    </div>
    ${content}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">
    <p style="font-size:12px;color:rgba(255,255,255,0.35);margin:0 0 4px;text-align:center;">Apex Aviation · San Marcos, TX (KHYI)</p>
    <p style="font-size:11px;margin:0;text-align:center;">
      <a href="https://apexaviationtx.com" style="color:rgba(255,255,255,0.35);text-decoration:underline;">apexaviationtx.com</a>
    </p>
  </div>
</body></html>`
}
