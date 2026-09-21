// Phase 3 (Ground School mobile) -- the ONE deliberate place mobile
// bypasses the mobile-* Edge Function convention. guided_notes and
// module_quiz_attempts both carry full own-row CRUD RLS (`auth.uid() =
// profile_id`) with no entitlement decision happening at write time, and
// record_ground_school_evidence() is already its own SECURITY DEFINER
// boundary regardless of transport -- these are high-frequency, low-
// stakes writes (every checkbox/rating/free-text field) where round-
// tripping through a cold-start-prone Edge Function is worse UX for zero
// security benefit. Mirrors site/portal-stable.js's own direct
// apexSupabase.from(...)/apexSupabase.rpc(...) calls exactly (same
// upsert conflict target, same evidence content_id/source_id encoding).
//
// Every read-back here still goes through validate.ts's fail-closed
// guards, and every failure still normalizes to the same ApiError shape
// every mobile-* wrapper produces -- this file only skips the Edge
// Function hop, not the app's error-handling contract.
import { supabase } from '../supabase'
import type { MobileGuidedNoteRow, MobileModuleQuizAttemptSummary } from '../../../shared/mobile-dto'
import { ApiError, logDevError } from './errors'
import { assertShape, isValidGuidedNoteRows, isValidModuleQuizAttemptSummary } from './validate'

function toApiError(context: string, error: unknown): ApiError {
  logDevError(context, error)
  return new ApiError({ kind: 'server', userMessage: 'Something went wrong saving that. Please try again.', raw: error })
}

export async function fetchGuidedNotes(profileId: string, courseId: string, moduleId: string): Promise<MobileGuidedNoteRow[]> {
  const { data, error } = await supabase
    .from('guided_notes')
    .select('module_id, section_id, prompt_id, response_text, updated_at')
    .eq('profile_id', profileId)
    .eq('course_id', courseId)
    .eq('module_id', moduleId)
  if (error) throw toApiError('fetchGuidedNotes', error)
  assertShape(isValidGuidedNoteRows(data), 'fetchGuidedNotes', data)
  return data
}

// onConflict target matches guided_notes' real unique constraint exactly
// -- see site/portal-stable.js's own identical upsert calls.
export async function upsertGuidedNote(
  profileId: string,
  courseId: string,
  moduleId: string,
  sectionId: string,
  promptId: string,
  responseText: string
): Promise<void> {
  const { error } = await supabase.from('guided_notes').upsert(
    {
      profile_id: profileId,
      course_id: courseId,
      module_id: moduleId,
      section_id: sectionId,
      prompt_id: promptId,
      response_text: responseText,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,course_id,module_id,section_id,prompt_id' }
  )
  if (error) throw toApiError('upsertGuidedNote', error)
}

// record_ground_school_evidence() is a no-op for any content_id with no
// content_acs_mappings row -- safe to call unconditionally, matching
// web's own unconditional-call convention. Callers await/allSettle this
// themselves; it never throws for a routine "no mapping" case (the RPC
// itself returns void either way), only for a genuine call failure.
export async function recordGroundSchoolEvidence(
  profileId: string,
  contentType: 'checkride_corner' | 'scenario_workshop' | 'module_quiz_question',
  contentId: string,
  sourceId: string,
  isCorrect: boolean | null,
  selfConfidence: number | null
): Promise<void> {
  const { error } = await supabase.rpc('record_ground_school_evidence', {
    p_profile_id: profileId,
    p_content_type: contentType,
    p_content_id: contentId,
    p_source_id: sourceId,
    p_is_correct: isCorrect,
    p_self_confidence: selfConfidence,
  })
  if (error) throw toApiError('recordGroundSchoolEvidence', error)
}

export async function fetchLatestModuleQuizAttempt(
  profileId: string,
  courseId: string,
  moduleId: string
): Promise<MobileModuleQuizAttemptSummary | null> {
  const { data, error } = await supabase
    .from('module_quiz_attempts')
    .select('id, module_id, score, total, completed_at')
    .eq('profile_id', profileId)
    .eq('course_id', courseId)
    .eq('module_id', moduleId)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw toApiError('fetchLatestModuleQuizAttempt', error)
  if (data === null) return null
  assertShape(isValidModuleQuizAttemptSummary(data), 'fetchLatestModuleQuizAttempt', data)
  return data
}

export async function submitModuleQuizAttempt(
  profileId: string,
  courseId: string,
  moduleId: string,
  answers: Record<string, string>,
  results: Record<string, boolean>,
  score: number,
  total: number
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('module_quiz_attempts')
    .insert({
      profile_id: profileId,
      course_id: courseId,
      module_id: moduleId,
      answers,
      results,
      score,
      total,
    })
    .select('id')
    .single()
  if (error) throw toApiError('submitModuleQuizAttempt', error)
  assertShape(isPlainObjectWithId(data), 'submitModuleQuizAttempt', data)
  return data as { id: string }
}

function isPlainObjectWithId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}
