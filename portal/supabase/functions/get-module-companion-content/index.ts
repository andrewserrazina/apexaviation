// Serves a single Ground School module's companion content -- the
// workbook material (objectives, guided-notes prompts, key concepts,
// scenario worksheet, Checkride Corner questions, Apex Challenge) and
// its scored Knowledge Check quiz (questions + answer key). Real
// server-side enforcement, same trust model as get-premium-content:
// nothing in this response reaches the browser unless requireModuleAccess()
// confirms the caller's own account is entitled to this specific module
// (full Ground School pack, or a paid enrollment in this module's
// scheduled class) -- an unentitled caller gets a 403 with no content
// body at all, never a partial or redacted payload.
//
// Env vars required (set as Supabase Edge Function secrets):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireModuleAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

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
    const body = await req.json().catch(() => ({}))
    const courseId = typeof body.course_id === 'string' && body.course_id ? body.course_id : 'PPL'
    const moduleId = body.module_id
    if (!moduleId || typeof moduleId !== 'string') {
      return new Response(JSON.stringify({ error: 'module_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await requireModuleAccess(supabase, req.headers.get('Authorization'), moduleId)

    const [companion, quiz] = await Promise.all([
      supabase.from('module_companion_content').select('content').eq('course_id', courseId).eq('module_id', moduleId).maybeSingle(),
      supabase.from('module_quiz_questions').select('*').eq('course_id', courseId).eq('module_id', moduleId).order('sort_order'),
    ])

    if (companion.error) throw companion.error
    if (quiz.error) throw quiz.error

    return new Response(JSON.stringify({
      content: companion.data ? companion.data.content : null,
      quiz: quiz.data,
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
    console.error('get-module-companion-content error', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
