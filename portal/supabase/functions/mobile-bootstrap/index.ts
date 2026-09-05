// Mobile bootstrap -- the ONE call the Expo app makes right after sign-in
// to learn who the learner is, what they've unlocked, and what to show on
// the home screen. This is the mobile-facing contract layer Sprint 0
// Phase C calls for: the phone never queries `profiles` (or any other
// internal table) directly and never decides its own entitlement state --
// every field below is resolved server-side, from the same tables the web
// portal already uses, and reshaped into a stable external DTO.
//
// NOT YET DEPLOYED. Source-controlled only, per the Phase C stop gate --
// see SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT.md.
//
// Explicitly excluded from this response (never queried, never returned):
// staff-only profile fields (role, is_staff/is_admin), instructor pay
// rates, admin flags, any Stripe session/payment-intent id, signup_utm_*/
// attribution fields, service-role metadata. profiles.role is the one
// exception -- see the `role` field in `user` below, included ONLY so the
// app can distinguish an admin/instructor test account for app-role
// handling; it is never used to gate mobile content beyond that (that's
// still every underlying table/RPC's own RLS and entitlement logic).
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'Missing Authorization header' }, 401)

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Invalid or expired session' }, 401)
    const userId = userData.user.id

    const [
      { data: profile },
      { data: entitlements },
      { data: latestReadiness },
      { data: todaysDrill },
      { data: streakRow },
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, checkride_prep_unlocked, private_pilot_ground_school_pack_unlocked, current_rank, total_xp')
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('study_pack_entitlements').select('pack_id').eq('profile_id', userId),
      supabase
        .from('readiness_snapshots')
        .select('overall_score, coverage_score, knowledge_score, risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes, algorithm_version, created_at')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('daily_drills')
        .select('id, drill_date, status, estimated_minutes, target_acs_tasks')
        .eq('profile_id', userId)
        .order('drill_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc('get_member_streak', { p_profile_id: userId }),
    ])

    if (!profile) return json({ error: 'Profile not found' }, 404)

    // portal_checkride_date is a separate table in the existing schema
    // (see Phase 1B's Mobile Data Reuse Matrix) -- read it directly here
    // rather than joining it onto profiles, matching how the web portal
    // already treats it as its own record.
    const { data: checkrideDateRow } = await supabase
      .from('portal_checkride_date')
      .select('checkride_date')
      .eq('profile_id', userId)
      .maybeSingle()

    const streak = Array.isArray(streakRow) ? streakRow[0] : streakRow

    const bootstrap = {
      user: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        role: profile.role, // app-role handling only (e.g. show an instructor-specific screen) -- never a content gate on its own
      },
      training: {
        checkride_date: checkrideDateRow?.checkride_date ?? null,
      },
      access: {
        checkride_prep: !!profile.checkride_prep_unlocked,
        ground_school_pack: !!profile.private_pilot_ground_school_pack_unlocked,
        study_pack_entitlements: (entitlements || []).map((e: { pack_id: string }) => e.pack_id),
      },
      progress: {
        xp: profile.total_xp ?? 0,
        current_rank: profile.current_rank ?? null,
        current_streak: streak?.current_streak ?? 0,
        longest_streak: streak?.longest_streak ?? 0,
        readiness_summary: latestReadiness
          ? {
              overall_score: latestReadiness.overall_score,
              evidence_level: latestReadiness.evidence_level,
              algorithm_version: latestReadiness.algorithm_version,
              reason_codes: latestReadiness.reason_codes,
              computed_at: latestReadiness.created_at,
            }
          : null,
      },
      home: {
        todays_drill: todaysDrill
          ? {
              id: todaysDrill.id,
              status: todaysDrill.status,
              estimated_minutes: todaysDrill.estimated_minutes,
              target_acs_tasks: todaysDrill.target_acs_tasks,
            }
          : null,
        weak_areas: latestReadiness?.weak_tasks ?? [],
      },
    }

    return json(bootstrap)
  } catch (err) {
    console.error('mobile-bootstrap error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
