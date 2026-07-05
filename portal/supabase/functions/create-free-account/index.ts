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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { name, email } = await req.json()
    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name, email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    const actionLink = linkData?.properties?.action_link

    await supabase.functions.invoke('send-email', {
      body: {
        to: email,
        subject: 'Welcome to Apex Advantage — set your password',
        html: template(`
          <h2 style="color:#F4B400;margin:0 0 4px;">Welcome to Apex Advantage, ${name.split(' ')[0]}!</h2>
          <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your free member portal account is ready. Set your password to get in:</p>
          <a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Your Password →</a>
          <p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Once that's done, sign in any time at apexaviationtx.com/portal-login.html. From your dashboard you can register for live ground school sessions right away — and unlock the full Checkride Prep System (DPE question bank, scenario training, progress tracking) whenever you're ready.</p>
        `),
      },
    })

    return new Response(JSON.stringify({ ok: true, id: created.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
