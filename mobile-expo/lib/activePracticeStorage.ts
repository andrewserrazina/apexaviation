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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// Rev2 storage hardening: a stored record with a non-integer, zero, or
// negative sessionSize, or an empty title/startedAt, is exactly as
// unusable to the UI as one missing the field entirely (Continue
// Practice's "N of `sessionSize` rated" line, the header label) -- so
// these now fail the same way a missing field already did, rather than
// silently rendering "0 of 0 rated" or a blank title. This stays local
// corruption defense only, not a schema-validation library: the optional
// acsTaskId/areaCode/taskCode fields, when present, only need to be
// non-empty strings too.
function isActivePracticeSession(value: unknown): value is ActivePracticeSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (
    !isNonEmptyString(v.sessionId) ||
    !isNonEmptyString(v.userId) ||
    (v.kind !== 'quick' && v.kind !== 'standard' && v.kind !== 'weak_area') ||
    !isNonEmptyString(v.title) ||
    !isNonEmptyString(v.startedAt) ||
    typeof v.sessionSize !== 'number' ||
    !Number.isInteger(v.sessionSize) ||
    v.sessionSize <= 0
  ) {
    return false
  }
  if (v.acsTaskId !== undefined && !isNonEmptyString(v.acsTaskId)) return false
  if (v.areaCode !== undefined && !isNonEmptyString(v.areaCode)) return false
  if (v.taskCode !== undefined && !isNonEmptyString(v.taskCode)) return false
  return true
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

// Rev2 blocker 2: the per-user pointer is a single slot, not one per
// session -- a blind clearActivePracticeSession(userId) call from an ad-
// hoc session route unconditionally deletes WHATEVER is currently stored
// for that user, even if it belongs to a completely different session
// than the one the route is actually acting on. A learner with saved
// active pointer "Session B" who deep-links to an older, already-
// completed (or otherwise non-resumable) "Session A" would have Session
// B's pointer silently deleted -- orphaning their real, still-unfinished
// practice.
//
// This compare-and-clear only removes the stored pointer when it
// actually still points at the caller's own sessionId; a mismatched or
// absent pointer is left untouched. Use this (never the blind
// clearActivePracticeSession) from anywhere acting on one specific
// session_id: successful completion, already-completed-on-resume
// cleanup, and "Remove Saved Session."
export async function clearActivePracticeSessionIfMatches(userId: string, sessionId: string): Promise<void> {
  try {
    const current = await loadActivePracticeSession(userId)
    if (!current || current.sessionId !== sessionId) return
    await AsyncStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // No-op, matching clearActivePracticeSession's existing failure mode.
  }
}
