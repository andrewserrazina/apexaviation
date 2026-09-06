// Sprint 1B.1: v119's backend intentionally has no "list my unfinished
// sessions" endpoint, so activePracticeStorage.ts's per-user local
// pointer is the ONLY place that "does this learner have an unfinished
// ad-hoc session" answer lives. The one property that actually matters
// here is user-scoping -- a session started by one learner must never
// resurface as "Continue Practice" after a different learner signs in on
// the same device -- so these tests use AsyncStorage's own official Jest
// mock (a real in-memory implementation, not a stub) to exercise genuine
// read/write/corruption behavior rather than just proving mocked calls
// happened.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  clearActivePracticeSession,
  clearActivePracticeSessionIfMatches,
  loadActivePracticeSession,
  saveActivePracticeSession,
  type ActivePracticeSession,
} from '../lib/activePracticeStorage'

function fixture(overrides: Partial<ActivePracticeSession> = {}): ActivePracticeSession {
  return {
    sessionId: 's1',
    userId: 'user-a',
    kind: 'quick',
    title: 'Quick Practice',
    startedAt: '2026-01-01T00:00:00Z',
    sessionSize: 5,
    ...overrides,
  }
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('activePracticeStorage (Sprint 1B.1)', () => {
  // 19. active session is scoped by user id
  it('loads the session back for the exact user id it was saved under', async () => {
    await saveActivePracticeSession(fixture({ userId: 'user-a' }))
    const loaded = await loadActivePracticeSession('user-a')
    expect(loaded?.sessionId).toBe('s1')
    expect(loaded?.userId).toBe('user-a')
  })

  // 20. User A's session never appears for User B
  it('never returns User A’s session when asked for User B', async () => {
    await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'session-a' }))
    const loadedForB = await loadActivePracticeSession('user-b')
    expect(loadedForB).toBeNull()
  })

  it('two different users can each have their own independent active session simultaneously', async () => {
    await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'session-a', title: 'Quick Practice' }))
    await saveActivePracticeSession(fixture({ userId: 'user-b', sessionId: 'session-b', title: 'Standard Practice' }))

    const loadedA = await loadActivePracticeSession('user-a')
    const loadedB = await loadActivePracticeSession('user-b')
    expect(loadedA?.sessionId).toBe('session-a')
    expect(loadedB?.sessionId).toBe('session-b')
  })

  // 21. clear removes only requested user's pointer
  it('clearing one user’s pointer leaves a different user’s pointer intact', async () => {
    await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'session-a' }))
    await saveActivePracticeSession(fixture({ userId: 'user-b', sessionId: 'session-b' }))

    await clearActivePracticeSession('user-a')

    expect(await loadActivePracticeSession('user-a')).toBeNull()
    expect((await loadActivePracticeSession('user-b'))?.sessionId).toBe('session-b')
  })

  // 22. storage corruption fails safely
  it('returns null (never throws) for corrupt, non-JSON stored data', async () => {
    await AsyncStorage.setItem('apex-advantage-active-practice:user-a', 'not valid json{{{')
    await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
  })

  it('returns null for well-formed JSON that is missing required fields', async () => {
    await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify({ sessionId: 's1' }))
    await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
  })

  it('returns null when nothing has ever been saved for this user', async () => {
    await expect(loadActivePracticeSession('never-saved-user')).resolves.toBeNull()
  })

  // Defense in depth: even if a stored record's own userId field were
  // somehow inconsistent with the key it was read from, the loader still
  // refuses to return it rather than trusting the record's self-reported
  // userId over the key it was actually stored/looked-up under.
  it('returns null if the stored record’s own userId field disagrees with the requested user id', async () => {
    await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify(fixture({ userId: 'someone-else' })))
    await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
  })

  // Rev2 blocker 2: clearActivePracticeSessionIfMatches -- the compare-
  // and-clear that every "act on one specific session_id" call site
  // (successful completion, already-completed-on-resume cleanup, Remove
  // Saved Session) must use instead of the blind, per-user
  // clearActivePracticeSession, so acting on one session never wipes out
  // a DIFFERENT session's still-unfinished saved pointer.
  describe('clearActivePracticeSessionIfMatches (Rev2 blocker 2)', () => {
    it('removes the stored pointer when it matches the given sessionId', async () => {
      await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'session-a' }))
      await clearActivePracticeSessionIfMatches('user-a', 'session-a')
      expect(await loadActivePracticeSession('user-a')).toBeNull()
    })

    it('leaves the stored pointer untouched when it does NOT match the given sessionId', async () => {
      await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'session-b' }))
      await clearActivePracticeSessionIfMatches('user-a', 'session-a')
      const stillThere = await loadActivePracticeSession('user-a')
      expect(stillThere?.sessionId).toBe('session-b')
    })

    it('is a safe no-op when nothing is stored for this user at all', async () => {
      await expect(clearActivePracticeSessionIfMatches('never-saved-user', 'session-a')).resolves.toBeUndefined()
      expect(await loadActivePracticeSession('never-saved-user')).toBeNull()
    })

    it('never affects a different user’s pointer, even if that other user happens to have the same sessionId stored', async () => {
      await saveActivePracticeSession(fixture({ userId: 'user-a', sessionId: 'shared-session-id' }))
      await saveActivePracticeSession(fixture({ userId: 'user-b', sessionId: 'shared-session-id' }))

      await clearActivePracticeSessionIfMatches('user-a', 'shared-session-id')

      expect(await loadActivePracticeSession('user-a')).toBeNull()
      expect((await loadActivePracticeSession('user-b'))?.sessionId).toBe('shared-session-id')
    })
  })

  // Rev2 storage hardening: a stored record with an unusable sessionSize
  // (non-integer, zero, negative) or an empty title/startedAt/optional
  // display field is exactly as broken to the UI as a missing field --
  // Continue Practice's "N of `sessionSize` rated" line and header label
  // both depend on these actually being usable values.
  describe('storage-shape hardening (Rev2)', () => {
    it.each([0, -1, 1.5, NaN, Infinity])('rejects a stored record with sessionSize=%p', async (badSize) => {
      await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify(fixture({ sessionSize: badSize })))
      await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
    })

    it('rejects a stored record with an empty title', async () => {
      await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify(fixture({ title: '' })))
      await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
    })

    it('rejects a stored record with an empty startedAt', async () => {
      await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify(fixture({ startedAt: '' })))
      await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
    })

    it('rejects a stored record with an empty optional acsTaskId', async () => {
      await AsyncStorage.setItem('apex-advantage-active-practice:user-a', JSON.stringify(fixture({ kind: 'weak_area', acsTaskId: '', areaCode: 'I', taskCode: 'A' })))
      await expect(loadActivePracticeSession('user-a')).resolves.toBeNull()
    })

    it('accepts a valid weak-area record with all optional display fields populated', async () => {
      await saveActivePracticeSession(fixture({ kind: 'weak_area', acsTaskId: 'task-uuid-1', areaCode: 'I', taskCode: 'A' }))
      const loaded = await loadActivePracticeSession('user-a')
      expect(loaded?.acsTaskId).toBe('task-uuid-1')
    })
  })
})
