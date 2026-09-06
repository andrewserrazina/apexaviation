// Sprint 1B.1: lightweight LOCAL-ONLY pointer to the current learner's one
// unfinished ad-hoc practice session, so the Practice hub can offer
// "Continue Practice" and the session route (app/(app)/practice/session/
// [sessionId].tsx) always has a session_id to resume -- v119's backend
// intentionally does not expose a "list my unfinished sessions" endpoint,
// so this is the only place that information lives client-side.
//
// This is NOT authoritative session state. The server's `resume` response
// is authoritative for everything about the session itself (question set,
// order, completed_at); this pointer only ever tells the UI WHICH
// session_id to resume and what label to show on the Continue Practice
// card before that resume call returns.
//
// Scoped by profile id -- keyed apex-advantage-active-practice:<userId> --
// specifically so a session started by one learner can never surface as
// "Continue Practice" after a different learner signs in on the same
// physical device. Plain AsyncStorage, matching drillProgressStorage.ts's
// reasoning: this is non-sensitive session metadata, not credentials, so
// it doesn't need the encrypted LargeSecureStore used for the auth session.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'apex-advantage-active-practice:'

export type AdHocPracticeKind = 'quick' | 'standard' | 'weak_area'

export interface ActivePracticeSession {
  sessionId: string
  userId: string
  kind: AdHocPracticeKind
  title: string
  startedAt: string
  sessionSize: number
  acsTaskId?: string
  areaCode?: string
  taskCode?: string
}

function isActivePracticeSession(value: unknown): value is ActivePracticeSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.sessionId === 'string' &&
    v.sessionId.length > 0 &&
    typeof v.userId === 'string' &&
    v.userId.length > 0 &&
    (v.kind === 'quick' || v.kind === 'standard' || v.kind === 'weak_area') &&
    typeof v.title === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.sessionSize === 'number'
  )
}

export async function saveActivePracticeSession(session: ActivePracticeSession): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + session.userId, JSON.stringify(session))
  } catch {
    // Best-effort only, matching drillProgressStorage.ts -- the server
    // session is still valid even if this local pointer never gets
    // written; the learner just won't see a "Continue Practice" card for
    // it (Sprint 1B.1 section 7: "Local persistence is best-effort").
  }
}

// Returns null (never throws) if nothing is stored, the stored JSON is
// corrupt, the stored shape is malformed, or the stored record belongs to
// a DIFFERENT user id than the one asked for -- that last check is the
// actual enforcement behind "a session stored for User A must never
// appear as Continue Practice after User B signs in," since a stale
// per-user key could otherwise theoretically be read under the wrong
// caller if this function's contract were ever loosened.
export async function loadActivePracticeSession(userId: string): Promise<ActivePracticeSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isActivePracticeSession(parsed) || parsed.userId !== userId) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearActivePracticeSession(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // No-op -- a stale leftover pointer is harmless; the next
    // loadActivePracticeSession() call for this user will just resume (or
    // fail closed on) whatever it finds.
  }
}
