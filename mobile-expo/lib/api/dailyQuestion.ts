// Mobile parity (Phase 5, item 4): Daily Question of the Day. Calls the
// same get_daily_question() RPC web's computeQotdQuestion() falls back
// to (supabase-portal-schema-v68.sql) -- SECURITY DEFINER, granted to
// `authenticated` with NO checkride_prep_unlocked check, a deliberate
// free preview/habit hook. Mobile always uses the RPC (never web's
// client-side day-of-year-over-the-full-bank shortcut, which only exists
// because web has already fetched the full entitled question bank into
// memory for other reasons) -- this is the one correct, free-tier-safe
// source for both free and entitled mobile accounts.
import { supabase } from '../supabase'
import { ApiError, logDevError } from './errors'
import { isNonEmptyString, isPlainObject } from './validate'
import type { MobileDailyQuestion } from '../../../shared/mobile-dto'

interface DailyQuestionRow {
  id: string
  question: string
  model_answer: string
  dpe_evaluating: string | null
  real_world_application: string | null
  category: string
  category_label: string
}

function isValidDailyQuestionRow(value: unknown): value is DailyQuestionRow {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.question === 'string' &&
    typeof value.model_answer === 'string' &&
    (value.dpe_evaluating === null || typeof value.dpe_evaluating === 'string') &&
    (value.real_world_application === null || typeof value.real_world_application === 'string') &&
    typeof value.category === 'string' &&
    typeof value.category_label === 'string'
  )
}

// Returns null when the bank is empty for this exam type (the RPC's own
// OFFSET/LIMIT 1 then yields zero rows) -- a legitimate "nothing to show
// today" case, never surfaced as an error.
export async function fetchDailyQuestion(examType: string = 'private_pilot'): Promise<MobileDailyQuestion | null> {
  const { data, error } = await supabase.rpc('get_daily_question', { p_exam_type: examType })
  if (error) {
    logDevError('fetchDailyQuestion', error)
    throw new ApiError({ kind: 'server', userMessage: 'We couldn’t load today’s question.', raw: error })
  }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return null
  if (!isValidDailyQuestionRow(row)) {
    throw new ApiError({ kind: 'server', userMessage: 'We couldn’t load today’s question.', raw: row })
  }
  return {
    id: row.id,
    question: row.question,
    model_answer: row.model_answer,
    dpe_evaluating: row.dpe_evaluating,
    real_world_application: row.real_world_application,
    category: row.category,
    category_label: row.category_label,
  }
}
