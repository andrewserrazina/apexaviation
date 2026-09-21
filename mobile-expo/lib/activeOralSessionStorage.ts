// Phase 1 (AI DPE mobile): lightweight LOCAL-ONLY pointer to the current
// learner's one unfinished AI DPE oral-practice session, mirroring
// activePracticeStorage.ts's exact reasoning and shape (see that file's
// own header comment for the full rationale) -- mobile-dpe intentionally
// exposes no "list my unfinished sessions" endpoint, so this is the only
// place that information lives client-side.
//
// This is NOT authoritative session state. The server's `resume`
// response (mobile-dpe's own reconstructed transcript) is authoritative
// for everything about the session itself; this pointer only ever tells
// the UI WHICH sessionId to resume and when it was started, before that
// resume call returns. It deliberately never stores the transcript
// itself -- that would duplicate server state and risk going stale.
//
// Scoped by profile id -- keyed apex-advantage-active-oral:<userId> --
// so a session started by one learner can never surface as "Continue
// Oral Practice" after a different learner signs in on the same
// physical device.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'apex-advantage-active-oral:'

export interface ActiveOralSession {
  sessionId: string
  userId: string
  startedAt: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isActiveOralSession(value: unknown): value is ActiveOralSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isNonEmptyString(v.sessionId) && isNonEmptyString(v.userId) && isNonEmptyString(v.startedAt)
}

export async function saveActiveOralSession(session: ActiveOralSession): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + session.userId, JSON.stringify(session))
  } catch {
    // Best-effort only, matching activePracticeStorage.ts -- the server
    // session is still valid even if this local pointer never gets
    // written; the learner just won't see a "Continue Oral Practice"
    // card for it.
  }
}

// Returns null (never throws) if nothing is stored, the stored JSON is
// corrupt, the stored shape is malformed, or the stored record belongs
// to a DIFFERENT user id than the one asked for.
export async function loadActiveOralSession(userId: string): Promise<ActiveOralSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isActiveOralSession(parsed) || parsed.userId !== userId) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearActiveOralSession(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // No-op -- a stale leftover pointer is harmless.
  }
}

// Compare-and-clear, mirroring clearActivePracticeSessionIfMatches's
// exact reasoning: only removes the stored pointer when it still points
// at the caller's own sessionId, so acting on one specific session (a
// completion, an already-ended-on-resume cleanup) can never wipe out a
// DIFFERENT, still-unfinished session's saved pointer.
export async function clearActiveOralSessionIfMatches(userId: string, sessionId: string): Promise<void> {
  try {
    const current = await loadActiveOralSession(userId)
    if (!current || current.sessionId !== sessionId) return
    await AsyncStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // No-op, matching clearActiveOralSession's existing failure mode.
  }
}
