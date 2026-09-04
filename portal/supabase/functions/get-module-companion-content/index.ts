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

// Inlined (not imported from ../_shared/premiumAccess.ts) because the
// Supabase deploy path used for this function cannot resolve a relative
// import that reaches outside this function's own directory -- same
// issue and same fix as create-checkout-session/stripe-webhook's
// emailTemplate inlining. Must be kept in sync with _shared/
// premiumAccess.ts's own PremiumAccessError/requireModuleAccess if that
// file ever changes.
class PremiumAccessError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

interface CapabilityResult {
  userId: string
  email: string | null
}

// For Ground School module companion content (module_companion_content,
// module_quiz_questions) -- entitlement here is per-module, not a flat
// flag: a member either bought the full private_pilot_ground_school_
// pack_unlocked, or paid individually for this specific module's
// scheduled class (scheduled_ground_class_enrollments, payment_status in
// ('paid','ground_school_pack'), joined through scheduled_ground_classes.
// lesson_id -- the same real curriculum module id used everywhere else,
// e.g. 'PPL-M01'). Mirrors the client's own hasModuleAccess() (site/
// portal-stable.js) exactly, but this is the actual security boundary --
// that client check is UI convenience only.
async function requireModuleAccess(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  moduleId: string
): Promise<CapabilityResult> {
  const token = (authHeader || '').replace('Bearer ', '').trim()
  if (!token) throw new PremiumAccessError('Missing Authorization header', 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) throw new PremiumAccessError('Invalid or expired session', 401)

  const [{ data: profile }, { data: enrollmentRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('private_pilot_ground_school_pack_unlocked')
      .eq('id', userData.user.id)
      .maybeSingle(),
    supabase
      .from('scheduled_ground_class_enrollments')
      .select('id, payment_status, scheduled_ground_classes!inner(lesson_id)')
      .eq('profile_id', userData.user.id)
      .eq('scheduled_ground_classes.lesson_id', moduleId)
      .in('payment_status', ['paid', 'ground_school_pack'])
      .limit(1),
  ])

  const unlocked = !!profile?.private_pilot_ground_school_pack_unlocked || !!enrollmentRows?.length
  if (!unlocked) throw new PremiumAccessError('This Ground School module is not unlocked on this account', 403)

  return { userId: userData.user.id, email: userData.user.email ?? null }
}

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
