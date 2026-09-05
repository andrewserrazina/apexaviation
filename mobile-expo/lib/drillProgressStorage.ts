// Lightweight LOCAL-ONLY persistence for in-progress Daily Drill
// self-ratings, keyed by session_id. This is NOT a progress-sync system --
// it exists only so a learner who force-closes the app mid-drill and
// reopens it doesn't lose ratings they already made for the same session
// (Sprint 1A section 15: "you MAY add lightweight local persistence for
// in-progress ratings if it is simple and clearly keyed to session_id...
// do not introduce a complex offline sync system").
//
// The authoritative write is still exactly one server call --
// mobile-practice's `complete` action -- when the learner finishes the
// drill. This storage is discarded once that call succeeds; it is never
// itself sent to the server and never treated as a second source of
// truth. Plain AsyncStorage is intentional here (not the encrypted
// LargeSecureStore used for the auth session) -- these are ordinary
// non-sensitive self-ratings, not credentials.
//
// Deliberately persists RATINGS ONLY, never "revealed" state. The
// server's reveal debrief content (model_answer/common_mistakes/etc.) is
// never itself persisted locally, so restoring a question as already
// "revealed" without that content would strand the learner: the Reveal
// button hides once revealed, but there's no debrief to show and no way
// to trigger fetching it again. Restoring ratings only, and always
// requiring a fresh Reveal Answer tap after a restart, keeps the
// hook/screen in a state that can always make forward progress (Sprint
// 1A Rev2 section 1).
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SelfRating } from '../../shared/mobile-dto'

const KEY_PREFIX = 'apex-advantage-drill-progress:'

export interface DrillProgress {
  sessionId: string
  ratings: Record<string, SelfRating>
}

export async function saveDrillProgress(progress: DrillProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + progress.sessionId, JSON.stringify(progress))
  } catch {
    // Best-effort only -- losing this write just means a force-close
    // loses in-progress ratings for this session, the documented Sprint
    // 1A limitation, not a crash.
  }
}

export async function loadDrillProgress(sessionId: string): Promise<DrillProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + sessionId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DrillProgress
    if (parsed.sessionId !== sessionId) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearDrillProgress(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + sessionId)
  } catch {
    // No-op -- a stale leftover entry for a completed session is harmless.
  }
}
