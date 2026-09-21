// Mobile Ground School -- Phase 3 of the mobile feature-parity roadmap.
// A thin sibling of get-module-companion-content: same two-table
// companion/quiz read, same per-module requireModuleAccess() gate,
// action-routed to match this codebase's mobile-* convention.
//
// Actions:
//   catalog (default) -- every curriculum module's has_authored_content
//                         (does module_companion_content have a row yet)
//                         and unlocked (full pack, or this specific
//                         module's paid class enrollment) flags. Module
//                         titles/order are NOT sent -- mobile's own
//                         constants/groundSchool.ts hand-ports that same
//                         static metadata web's GUIDED_NOTES_MODULES
//                         already hardcodes client-side.
//   content             -- {module_id} -> companion content + quiz +
//                         content_version, gated by requireModuleAccess().
//
// get_my_ground_school_enrollments() is auth.uid()-scoped internally (no
// caller-suppliable profile id), so it's called through the caller's own
// JWT-forwarding client, same reasoning as every other mobile-* RPC call
// in this codebase.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// The 20-module PPL curriculum -- mirrors mobile-expo/constants/
// groundSchool.ts's own module id list (kept independently, same as
// get-module-companion-content/site/portal-stable.js never sharing a
// canonical module list with the server today).
const COURSE_ID = 'PPL'
const MODULE_IDS = Array.from({ length: 20 }, (_, i) => `PPL-M${String(i + 1).padStart(2, '0')}`)

class AccessError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'Missing Authorization header' }, 401)

    const { data: userData, error: userErr } = await serviceClient.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Invalid or expired session' }, 401)
    const userId = userData.user.id

    // Auth-forwarding client -- get_my_ground_school_enrollments() is
    // auth.uid()-bound.
    const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const body = await req.json().catch(() => ({}))
    const action = body?.action ?? 'catalog'

    if (action === 'content') {
      const moduleId = body?.module_id
      if (!moduleId || typeof moduleId !== 'string') return json({ error: 'module_id is required' }, 400)

      const [{ data: profile }, { data: enrollmentRows, error: enrErr }] = await Promise.all([
        serviceClient.from('profiles').select('private_pilot_ground_school_pack_unlocked').eq('id', userId).maybeSingle(),
        serviceClient
          .from('scheduled_ground_class_enrollments')
          .select('id, payment_status, scheduled_ground_classes!inner(lesson_id)')
          .eq('profile_id', userId)
          .eq('scheduled_ground_classes.lesson_id', moduleId)
          .in('payment_status', ['paid', 'ground_school_pack'])
          .limit(1),
      ])
      if (enrErr) throw enrErr
      const unlocked = !!profile?.private_pilot_ground_school_pack_unlocked || !!enrollmentRows?.length
      if (!unlocked) throw new AccessError('This Ground School module is not unlocked on this account', 403)

      const [companion, quiz] = await Promise.all([
        serviceClient.from('module_companion_content').select('content, updated_at').eq('course_id', COURSE_ID).eq('module_id', moduleId).maybeSingle(),
        serviceClient.from('module_quiz_questions').select('*').eq('course_id', COURSE_ID).eq('module_id', moduleId).order('sort_order'),
      ])
      if (companion.error) throw companion.error
      if (quiz.error) throw quiz.error

      return json({
        content: companion.data ? companion.data.content : null,
        quiz: quiz.data || [],
        content_version: companion.data ? companion.data.updated_at : null,
      })
    }

    // Default action: catalog.
    const [{ data: profile }, { data: enrollments, error: enrErr }, { data: contentRows, error: contentErr }] = await Promise.all([
      serviceClient.from('profiles').select('private_pilot_ground_school_pack_unlocked').eq('id', userId).maybeSingle(),
      authedClient.rpc('get_my_ground_school_enrollments'),
      serviceClient.from('module_companion_content').select('module_id').eq('course_id', COURSE_ID),
    ])
    if (enrErr) throw enrErr
    if (contentErr) throw contentErr

    const packUnlocked = !!profile?.private_pilot_ground_school_pack_unlocked
    const enrolledModuleIds = new Set(
      (enrollments || [])
        .filter((e: { payment_status: string }) => e.payment_status === 'paid' || e.payment_status === 'ground_school_pack')
        .map((e: { lesson_id: string }) => e.lesson_id)
    )
    const contentModuleIds = new Set((contentRows || []).map((r: { module_id: string }) => r.module_id))

    return json({
      modules: MODULE_IDS.map((id) => ({
        module_id: id,
        has_authored_content: contentModuleIds.has(id),
        unlocked: packUnlocked || enrolledModuleIds.has(id),
      })),
    })
  } catch (err) {
    if (err instanceof AccessError) return json({ error: err.message }, err.status)
    console.error('mobile-ground-school error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
