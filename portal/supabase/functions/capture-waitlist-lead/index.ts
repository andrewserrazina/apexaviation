// Captures marketing-site waitlist signups (home.html, landing.html)
// as real rows in the CRM's leads table, so sales follow-up doesn't
// depend on someone checking the Formspree inbox. Both waitlist forms
// still also submit to Formspree independently -- this is a second,
// parallel destination, not a replacement.
//
// Public, unauthenticated form -- runs with the service role key
// server-side (same pattern as create-free-account) since the `leads`
// table's RLS only allows admin/instructor access, not anonymous
// inserts.
//
// Env vars required (auto-provided by Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
    const zip = typeof body.zip === 'string' ? body.zip.trim() : ''
    const services = Array.isArray(body.services) ? body.services.filter((s: unknown) => typeof s === 'string') : []
    // 'Website' matches CRM.jsx's own REFERRAL_SOURCES dropdown exactly --
    // the specific page lives in notes instead, so this doesn't create a
    // value the CRM's own lead-creation form can't also produce.
    const pageSource = typeof body.source === 'string' && body.source ? body.source : 'Website waitlist form'

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'A valid email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Don't create a second lead row for the same email re-submitting
    // the waitlist form -- silently succeed either way so the visitor
    // never sees an error for something that isn't their problem.
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fullName = [firstName, lastName].filter(Boolean).join(' ') || email

    const noteParts = [pageSource]
    if (zip) noteParts.push(`Zip: ${zip}`)
    if (services.length) noteParts.push(`Interested in: ${services.join(', ')}`)
    const notes = noteParts.join('. ')

    const { error: insertError } = await supabase.from('leads').insert({
      full_name: fullName,
      email,
      stage: 'inquiry',
      referral_source: 'Website',
      notes,
    })
    if (insertError) throw insertError

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
