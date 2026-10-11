// Mobile parity gap: the web portal's Checkride Countdown
// (renderCheckrideCountdown() in site/portal-stable.js) reads/writes
// portal_checkride_date directly from the client -- that table's RLS
// ("Users manage their own checkride date", auth.uid() = profile_id)
// already allows full owner CRUD with no entitlement decision at write
// time, so this follows lib/api/groundSchoolDirect.ts's established
// precedent for bypassing the mobile-* Edge Function convention here
// too, rather than building a new Edge Function for a single-row,
// no-business-logic write.
//
// mobile-bootstrap/index.ts already reads this same table into
// training.checkride_date, so there is no separate fetch function here --
// callers read the current value from bootstrap and call
// bootstrap.refresh() after a successful upsert to pick up the change.
import { supabase } from '../supabase'
import { ApiError, logDevError } from './errors'

export async function upsertCheckrideDate(profileId: string, checkrideDate: string): Promise<void> {
  const { error } = await supabase
    .from('portal_checkride_date')
    .upsert({ profile_id: profileId, checkride_date: checkrideDate, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  if (error) {
    logDevError('upsertCheckrideDate', error)
    throw new ApiError({ kind: 'server', userMessage: 'Could not save that date. Please try again.', raw: error })
  }
}
