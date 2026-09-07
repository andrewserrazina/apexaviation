// Rev2 blocker 2 (source review, following Sprint 1B.1): the per-user
// active-session pointer is a single slot, not one per session_id. A
// learner with a saved active pointer for "Session B" who happens to act
// on a DIFFERENT session -- deep-links to an older, already-completed
// "Session A"; finishes Session A directly; or hits a permanent resume
// error on Session A and taps "Remove Saved Session" -- must never have
// Session B's still-unfinished pointer silently wiped out as a side
// effect. Unlike useAdHocPracticeSession.test.tsx (which mocks
// activePracticeStorage entirely to prove the hook calls the session-
// matched function with the right args), this file deliberately does NOT
// mock activePracticeStorage -- it uses the real module against the
// official AsyncStorage jest mock, so these are genuine end-to-end proofs
// that Session B's pointer survives, not just proofs of a call shape.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

import { act, renderHook, waitFor } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAdHocPracticeSession } from '../hooks/useAdHocPracticeSession'
import { saveActivePracticeSession, loadActivePracticeSession, type ActivePracticeSession } from '../lib/activePracticeStorage'
import { ApiError } from '../lib/api/errors'

const mockResumePractice = jest.fn()
const mockCompletePractice = jest.fn()
jest.mock('../lib/api/practice', () => ({
  resumePractice: (...args: unknown[]) => mockResumePractice(...args),
  revealQuestion: jest.fn(),
  completePractice: (...args: unknown[]) => mockCompletePractice(...args),
}))

const mockLoadDrillProgress = jest.fn()
const mockSaveDrillProgress = jest.fn()
const mockClearDrillProgress = jest.fn()
jest.mock('../lib/drillProgressStorage', () => ({
  loadDrillProgress: (...args: unknown[]) => mockLoadDrillProgress(...args),
  saveDrillProgress: (...args: unknown[]) => mockSaveDrillProgress(...args),
  clearDrillProgress: (...args: unknown[]) => mockClearDrillProgress(...args),
}))

function sessionBFixture(): ActivePracticeSession {
  return {
    sessionId: 'session-B',
    userId: 'u1',
    kind: 'standard',
    title: 'Standard Practice',
    startedAt: '2026-01-01T00:00:00Z',
    sessionSize: 10,
  }
}

const QUESTIONS = [{ id: 'q1', question: 'Q1', category: null }]

function resumeFixture(overrides: Partial<{ completed_at: string | null }> = {}) {
  return {
    session_id: 'session-A',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: overrides.completed_at ?? null,
    target_acs_tasks: [],
    questions: QUESTIONS,
  }
}

describe('useAdHocPracticeSession session-matched cleanup (Rev2 blocker 2, real storage)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    mockResumePractice.mockReset()
    mockCompletePractice.mockReset()
    mockLoadDrillProgress.mockReset().mockResolvedValue(null)
    mockSaveDrillProgress.mockReset().mockResolvedValue(undefined)
    mockClearDrillProgress.mockReset().mockResolvedValue(undefined)
  })

  it('completing Session A does not clear a saved Session B pointer', async () => {
    await saveActivePracticeSession(sessionBFixture())
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-A', score: 1, total: 1, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-A', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(result.current.completeResult).toEqual({ score: 1, total: 1, alreadyCompleted: false })
    const stillSavedB = await loadActivePracticeSession('u1')
    expect(stillSavedB?.sessionId).toBe('session-B')
  })

  it('completing Session A DOES clear its own saved pointer when the saved pointer is actually Session A', async () => {
    await saveActivePracticeSession({ ...sessionBFixture(), sessionId: 'session-A', kind: 'quick', title: 'Quick Practice', sessionSize: 1 })
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-A', score: 1, total: 1, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-A', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(await loadActivePracticeSession('u1')).toBeNull()
  })

  it('an already-completed resume of Session A does not clear a saved Session B pointer', async () => {
    await saveActivePracticeSession(sessionBFixture())
    mockResumePractice.mockResolvedValue(resumeFixture({ completed_at: '2026-01-01T00:00:00Z' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-A', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.alreadyCompletedOnResume).toBe(true))

    const stillSavedB = await loadActivePracticeSession('u1')
    expect(stillSavedB?.sessionId).toBe('session-B')
  })

  it('"Remove Saved Session" on a non-resumable Session A does not clear a saved Session B pointer', async () => {
    await saveActivePracticeSession(sessionBFixture())
    mockResumePractice.mockRejectedValue(new ApiError({ kind: 'not_found', userMessage: 'This session no longer exists.' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-A', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.removeSavedSession()
    })

    const stillSavedB = await loadActivePracticeSession('u1')
    expect(stillSavedB?.sessionId).toBe('session-B')
  })
})
