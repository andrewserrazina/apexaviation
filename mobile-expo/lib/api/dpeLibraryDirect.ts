// Mobile parity (Phase 5, item 1): favorite/studied/last-viewed writes
// for the DPE Question Library. portal_question_progress carries "Users
// manage their own question progress" RLS (auth.uid() = profile_id) with
// no entitlement decision at write time -- same shape as guided_notes --
// so this follows lib/api/groundSchoolDirect.ts's established precedent
// for bypassing the mobile-* Edge Function convention for exactly this
// kind of high-frequency, low-stakes write. Mirrors web's own
// upsertRow()/toggleFavorite()/toggleStudied()/touchLastViewed() in
// site/portal-stable.js: same table, same onConflict target, same columns.
import { supabase } from '../supabase'
import { ApiError, logDevError } from './errors'

function toApiError(context: string, error: unknown): ApiError {
  logDevError(context, error)
  return new ApiError({ kind: 'server', userMessage: 'Something went wrong saving that. Please try again.', raw: error })
}

async function upsertQuestionProgress(profileId: string, questionId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('portal_question_progress')
    .upsert(
      { profile_id: profileId, question_id: questionId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: 'profile_id,question_id' }
    )
  if (error) throw toApiError('upsertQuestionProgress', error)
}

export async function setQuestionFavorited(profileId: string, questionId: string, favorited: boolean): Promise<void> {
  await upsertQuestionProgress(profileId, questionId, { favorited })
}

export async function setQuestionStudied(profileId: string, questionId: string, completed: boolean): Promise<void> {
  await upsertQuestionProgress(profileId, questionId, { completed })
}

// Mirrors web's touchLastViewed() for the one field the mobile library
// actually displays ("Viewed Xm ago") -- last_viewed_at (and
// first_viewed_at the first time). web's viewed_count increment isn't
// ported: it's written but never rendered in the question list, so
// skipping it avoids needing a client-tracked previous count for no
// visible behavior change.
export async function touchQuestionLastViewed(profileId: string, questionId: string, hasBeenViewedBefore: boolean): Promise<void> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { last_viewed_at: now }
  if (!hasBeenViewedBefore) patch.first_viewed_at = now
  await upsertQuestionProgress(profileId, questionId, patch)
}
