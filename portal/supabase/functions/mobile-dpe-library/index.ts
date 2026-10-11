// Mobile DPE Question Library -- Phase 5 (mobile parity) item 1. Thin
// mobile-facing surface over the exact same dpe_categories/dpe_questions
// query web's get-premium-content already serves (the same
// exam_type='private_pilot' filter, the same requirePremiumAccess()
// gate), plus the caller's own portal_question_progress rows so the
// client can render favorite/studied state without a second round trip.
//
// Unlike mobile-review-queue's two-step list/reveal, this returns every
// question's full content (including the answer fields) in one call --
// there's no per-item ownership check to enforce here, just the one
// checkride_prep_unlocked gate on the whole list, same as web's own
// get-premium-content behavior (full payload, client-side expand/
// collapse). Search/category filtering also stays client-side, matching
// web's renderDpeLibrary() exactly -- this is a small, fully-fetched
// content set, not something that needs server-side pagination.
//
// Favorite/studied/last-viewed writes do NOT go through this function --
// portal_question_progress already carries "Users manage their own
// question progress" RLS (auth.uid() = profile_id, same shape as
// guided_notes), so the mobile client writes those directly via
// lib/api/dpeLibraryDirect.ts, mirroring lib/api/groundSchoolDirect.ts's
// established precedent for exactly this kind of high-frequency,
// low-stakes, already-RLS-scoped write.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

interface ProgressRow {
  question_id: string
  favorited: boolean
  completed: boolean
  last_viewed_at: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { userId } = await requirePremiumAccess(supabase, req.headers.get('Authorization'))

    // exam_type hard-coded to 'private_pilot', same deliberate scope
    // boundary as get-premium-content -- see that function's own comment.
    const [categories, questions, progressRows] = await Promise.all([
      supabase.from('dpe_categories').select('id, label, section_label, sort_order').eq('exam_type', 'private_pilot').order('sort_order'),
      supabase
        .from('dpe_questions')
        .select('id, category, question, model_answer, common_mistakes, dpe_evaluating, real_world_application, acs_reference, sort_order')
        .eq('exam_type', 'private_pilot')
        .order('sort_order'),
      supabase
        .from('portal_question_progress')
        .select('question_id, favorited, completed, last_viewed_at')
        .eq('profile_id', userId),
    ])

    if (categories.error) throw categories.error
    if (questions.error) throw questions.error
    if (progressRows.error) throw progressRows.error

    const progress: Record<string, { favorited: boolean; completed: boolean; last_viewed_at: string | null }> = {}
    for (const row of (progressRows.data ?? []) as ProgressRow[]) {
      progress[row.question_id] = { favorited: row.favorited, completed: row.completed, last_viewed_at: row.last_viewed_at }
    }

    return json({
      categories: categories.data,
      questions: questions.data,
      progress,
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-dpe-library error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
