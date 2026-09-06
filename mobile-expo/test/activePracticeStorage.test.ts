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
import { clearActivePracticeSession, loadActivePracticeSession, saveActivePracticeSession, type ActivePracticeSession } from '../lib/activePracticeStorage'

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
})
