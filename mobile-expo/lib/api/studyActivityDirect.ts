// Mobile parity (Phase 5, item 4): Daily Question of the Day needs to
// feed the SAME streak the Home dashboard already shows
// (progress.current_streak, computed server-side by get_member_streak()
// from portal_study_activity -- see mobile-bootstrap/index.ts) rather
// than inventing a second, disconnected streak concept. portal_study_
// activity carries a column-scoped grant restored by v148 after v143's
// accidental blanket revoke ("insert(profile_id, activity_date,
// seconds), update(seconds)"), matching web's own direct-client
// bumpStudyDay() upsert in site/portal-stable.js.
//
// This deliberately does NOT replicate bumpStudyDay()'s seconds-
// accumulation behavior (web tracks a running in-memory seconds-today
// value from a page-visibility heartbeat mobile has no equivalent of).
// It only ensures a row exists for today -- the one thing
// get_member_streak() actually reads (a date's presence, not its
// seconds value) -- without ever overwriting an existing row's seconds
// (e.g. one a completed drill/practice session already wrote via
// complete_mobile_practice_session()).
import { supabase } from '../supabase'
import { logDevError } from './errors'

function todayLocalDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Best-effort, matching web's own unawaited bumpStudyDay() calls --
// never throws, since missing a single streak-day touch is far less
// harmful than surfacing an error for what the learner sees as "I just
// read a question."
export async function ensureStudyActivityToday(profileId: string): Promise<void> {
  try {
    const today = todayLocalDateString()
    const { data: existing, error: selectError } = await supabase
      .from('portal_study_activity')
      .select('activity_date')
      .eq('profile_id', profileId)
      .eq('activity_date', today)
      .maybeSingle()
    if (selectError) throw selectError
    if (existing) return

    const { error: insertError } = await supabase.from('portal_study_activity').insert({ profile_id: profileId, activity_date: today, seconds: 0 })
    if (insertError) throw insertError
  } catch (err) {
    logDevError('ensureStudyActivityToday', err)
  }
}
