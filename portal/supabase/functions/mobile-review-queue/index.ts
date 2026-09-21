// Mobile Review Queue -- Phase 2 of the mobile feature-parity roadmap.
// Thin mobile-facing surface over the exact same spaced-repetition tables
// and RPCs web's Review Queue already drives (sync_review_queue(),
// record_review_outcome(), portal_review_items) -- no new scheduling
// logic, no new schema. Dispatched by `action`, matching this codebase's
// existing action-routed Edge Function convention (see dpe-chat/
// mobile-practice/mobile-dpe).
//
// Gated by requirePremiumAccess() (checkride_prep), same as
// mobile-practice/mobile-readiness -- the ONLY source_type the mobile
// client renders in this phase is 'dpe_question', which itself requires
// checkride_prep on web too, so gating the whole function this way loses
// nothing today. Ground-School-sourced review items (module_quiz_question/
// checkride_corner/scenario) are still returned unfiltered by `list` (see
// shared/mobile-dto's comment) for forward compatibility, but the mobile
// client cannot yet render or act on them -- that arrives with Phase 3's
// own Ground School entitlement model, not a change to this gate.
//
// Actions:
//   list (default)  -- syncs the queue (sync_review_queue()) then returns
//                       every active/due item, unfiltered by source_type.
//   reveal           -- ownership + source_type='dpe_question' checked
//                       server-side before returning any answer content.
//   outcome          -- thin wrapper over record_review_outcome(), a
//                       client-supplied idempotency key required on every
//                       call (never optional, never server-generated).
//
// sync_review_queue()/record_review_outcome() are both auth.uid()-scoped
// internally (they raise/compare against auth.uid() directly), so both
// RPC calls below go through the caller's own JWT-forwarding client, same
// reasoning as mobile-readiness's/mobile-practice's own RPC calls.
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

interface ReviewItemRow {
  id: string
  source_type: string
  source_id: string
  module_id: string | null
  acs_category: string | null
  reason: string
  priority: number
  review_count: number
  next_review_at: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // Auth-forwarding client -- sync_review_queue() and
  // record_review_outcome() are both auth.uid()-bound, so these RPC calls
  // must run as the caller's own JWT, never the service-role client.
  const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const { userId } = await requirePremiumAccess(serviceClient, authHeader)
    const body = await req.json().catch(() => ({}))
    const action = body?.action ?? 'list'

    if (action === 'list') {
      const { error: syncErr } = await authedClient.rpc('sync_review_queue', { p_profile_id: userId })
      if (syncErr) throw syncErr

      const { data: rows, error: listErr } = await serviceClient
        .from('portal_review_items')
        .select('id, source_type, source_id, module_id, acs_category, reason, priority, review_count, next_review_at')
        .eq('profile_id', userId)
        .eq('status', 'active')
        .lte('next_review_at', new Date().toISOString())
        .order('priority', { ascending: false })
      if (listErr) throw listErr

      const items = (rows || []) as ReviewItemRow[]
      const dpeQuestionIds = items.filter((it) => it.source_type === 'dpe_question').map((it) => it.source_id)

      let questionById = new Map<string, string>()
      if (dpeQuestionIds.length) {
        const { data: questions, error: qErr } = await serviceClient
          .from('dpe_questions')
          .select('id, question')
          .in('id', dpeQuestionIds)
        if (qErr) throw qErr
        questionById = new Map((questions || []).map((q: { id: string; question: string }) => [q.id, q.question]))
      }

      return json({
        items: items.map((it) => ({
          id: it.id,
          source_type: it.source_type,
          source_id: it.source_id,
          module_id: it.module_id,
          acs_category: it.acs_category,
          reason: it.reason,
          priority: it.priority,
          review_count: it.review_count,
          next_review_at: it.next_review_at,
          question: it.source_type === 'dpe_question' ? questionById.get(it.source_id) ?? null : null,
        })),
      })
    }

    if (action === 'reveal') {
      const reviewItemId = body?.review_item_id
      if (!reviewItemId || typeof reviewItemId !== 'string') return json({ error: 'review_item_id is required' }, 400)

      const { data: item, error: itemErr } = await serviceClient
        .from('portal_review_items')
        .select('id, profile_id, source_type, source_id')
        .eq('id', reviewItemId)
        .maybeSingle()
      if (itemErr) throw itemErr
      if (!item) return json({ error: 'Review item not found' }, 404)
      if (item.profile_id !== userId) return json({ error: 'Not your review item' }, 403)
      if (item.source_type !== 'dpe_question') {
        return json({ error: 'This review item type is not yet supported on mobile' }, 400)
      }

      const { data: question, error: qErr } = await serviceClient
        .from('dpe_questions')
        .select('id, model_answer, common_mistakes, dpe_evaluating, real_world_application')
        .eq('id', item.source_id)
        .maybeSingle()
      if (qErr) throw qErr
      if (!question) return json({ error: 'Question not found' }, 404)

      return json({
        review_item_id: item.id,
        model_answer: question.model_answer,
        common_mistakes: question.common_mistakes,
        dpe_evaluating: question.dpe_evaluating,
        real_world_application: question.real_world_application,
      })
    }

    if (action === 'outcome') {
      const reviewItemId = body?.review_item_id
      const outcome = body?.outcome
      const idempotencyKey = body?.idempotency_key
      if (!reviewItemId || typeof reviewItemId !== 'string') return json({ error: 'review_item_id is required' }, 400)
      if (outcome !== 'reinforced' && outcome !== 'needs_another_pass') {
        return json({ error: 'outcome must be reinforced or needs_another_pass' }, 400)
      }
      if (!idempotencyKey || typeof idempotencyKey !== 'string') return json({ error: 'idempotency_key is required' }, 400)

      const { data, error } = await authedClient.rpc('record_review_outcome', {
        p_review_item_id: reviewItemId,
        p_outcome: outcome,
        p_idempotency_key: idempotencyKey,
      })
      if (error) {
        const msg = error.message || ''
        const codeMatch = msg.match(/^(invalid_outcome|review_item_not_found|review_outcome_in_progress|idempotency_key_conflict):?\s*(.*)$/)
        if (codeMatch) {
          const [, code, detail] = codeMatch
          const status = code === 'review_item_not_found' ? 404 : code === 'invalid_outcome' ? 400 : 409
          return json({ error: detail || code, code }, status)
        }
        if (/not authorized/i.test(msg)) {
          return json({ error: 'Not authorized to update this review item', code: 'not_authorized' }, 403)
        }
        throw error
      }

      return json({
        review_item_id: data.id,
        outcome,
        next_review_at: data.next_review_at,
        was_replay: !!data.was_replay,
      })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-review-queue error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
