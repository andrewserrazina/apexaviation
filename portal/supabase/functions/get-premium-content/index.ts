// Serves the Checkride Prep premium content (DPE question library,
// quick-reference sheets, lessons) — the actual server-side enforcement
// for portal access. Nothing in this response reaches the browser
// unless requirePremiumAccess() confirms the caller's own account has
// checkride_prep_unlocked = true; unpaid callers get a 403 with no
// content body at all, never a partial or redacted payload.
//
// Env vars required (set as Supabase Edge Function secrets):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    await requirePremiumAccess(supabase, req.headers.get('Authorization'))

    const [categories, questions, quickRef, lessons] = await Promise.all([
      supabase.from('dpe_categories').select('*').order('sort_order'),
      supabase.from('dpe_questions').select('*').order('sort_order'),
      supabase.from('quick_reference_sheets').select('*').order('sort_order'),
      supabase.from('portal_lessons').select('*').order('sort_order'),
    ])

    if (categories.error) throw categories.error
    if (questions.error) throw questions.error
    if (quickRef.error) throw quickRef.error
    if (lessons.error) throw lessons.error

    return new Response(JSON.stringify({
      categories: categories.data,
      questions: questions.data,
      quickReference: quickRef.data,
      lessons: lessons.data,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.error('get-premium-content error', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
