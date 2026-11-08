// Captures marketing-site waitlist signups (home.html -- landing.html
// is now just a redirect stub, see its own comment) as real rows in
// the CRM's leads table, so sales follow-up doesn't depend on someone
// checking the Formspree inbox. The waitlist form still also submits
// to Formspree independently -- this is a second, parallel
// destination, not a replacement.
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

// Escapes ilike's own wildcard characters so the dedup check below only
// ever matches the literal email -- same helper and reasoning as
// create-checkout-session/index.ts's own escapeIlike(), duplicated here
// since these functions share no module today. Without this, an email
// containing a literal % or _ (rare but RFC-valid) is treated as a
// wildcard and can false-positive match an unrelated lead, silently
// dropping this submission as a "duplicate" that was never inserted.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}

// The exact service checkbox values home.html's waitlist form submits
// (site/home.html's #waitlistForm) -- kept here, not trusted from the
// client, so a lead's location_segment can't be spoofed or drift out
// of sync with what's actually selected. A service value that matches
// neither set (an old cached page still submitting a retired label, or
// a future new one not yet added here) simply doesn't count toward
// either side, rather than throwing -- this never blocks the lead from
// being captured.
const IN_PERSON_SERVICES = new Set(['Private Pilot Training', 'Instrument Rating', 'Commercial Pilot', 'IPC / BFR / Currency'])
const VIRTUAL_SERVICES = new Set(['Private Instruction', 'Checkride Prep System', 'Mock Oral Exam'])

function classifyLocationSegment(services: string[]): 'austin_in_person' | 'virtual' | 'both' | null {
  const wantsInPerson = services.some((s) => IN_PERSON_SERVICES.has(s))
  const wantsVirtual = services.some((s) => VIRTUAL_SERVICES.has(s))
  if (wantsInPerson && wantsVirtual) return 'both'
  if (wantsInPerson) return 'austin_in_person'
  if (wantsVirtual) return 'virtual'
  return null
}

// Extracted into its own function (rather than left inline in serve())
// so it's independently testable -- see captureWaitlistLead.test.js.
// Every field past pageSource is optional, appended only when present,
// so this produces the exact same notes string as before for any
// caller (home.html's waitlist form) that doesn't send the newer
// Hutto/Taylor-landing-page fields at all.
function buildNotes(
  pageSource: string,
  zip: string,
  services: string[],
  trainingGoal: string,
  targetStartMonth: string,
  ratesWork: string,
  lessonWindow1: string,
  lessonWindow2: string,
): string {
  const noteParts = [pageSource]
  if (zip) noteParts.push(`Zip: ${zip}`)
  if (services.length) noteParts.push(`Interested in: ${services.join(', ')}`)
  if (trainingGoal) noteParts.push(`Training goal: ${trainingGoal}`)
  if (targetStartMonth) noteParts.push(`Target start: ${targetStartMonth}`)
  if (ratesWork) noteParts.push(`Proposed rates work for them: ${ratesWork}`)
  if (lessonWindow1 || lessonWindow2) {
    noteParts.push(`Preferred lesson windows: ${[lessonWindow1, lessonWindow2].filter(Boolean).join(' / ')}`)
  }
  return noteParts.join('. ')
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
    // Added for the Hutto/Taylor landing page's more detailed waitlist
    // ask (flight-training-hutto-taylor.html) -- all optional so the
    // original home.html waitlist form, which never sends these, keeps
    // working unchanged.
    const trainingGoal = typeof body.trainingGoal === 'string' ? body.trainingGoal.trim() : ''
    const targetStartMonth = typeof body.targetStartMonth === 'string' ? body.targetStartMonth.trim() : ''
    const ratesWork = typeof body.ratesWork === 'string' ? body.ratesWork.trim() : ''
    const lessonWindow1 = typeof body.lessonWindow1 === 'string' ? body.lessonWindow1.trim() : ''
    const lessonWindow2 = typeof body.lessonWindow2 === 'string' ? body.lessonWindow2.trim() : ''

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
      .ilike('email', escapeIlike(email))
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fullName = [firstName, lastName].filter(Boolean).join(' ') || email

    const notes = buildNotes(pageSource, zip, services, trainingGoal, targetStartMonth, ratesWork, lessonWindow1, lessonWindow2)

    const { error: insertError } = await supabase.from('leads').insert({
      full_name: fullName,
      email,
      stage: 'inquiry',
      referral_source: 'Website',
      notes,
      location_segment: classifyLocationSegment(services),
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
