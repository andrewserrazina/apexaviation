import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useDrillSession } from '../hooks/useDrillSession'
import { ApiError } from '../lib/api/errors'

const mockStartDailyDrill = jest.fn()
const mockCompletePractice = jest.fn()
const mockRevealQuestion = jest.fn()

jest.mock('../lib/api/dailyDrill', () => ({
  startDailyDrill: (...args: unknown[]) => mockStartDailyDrill(...args),
}))
jest.mock('../lib/api/practice', () => ({
  completePractice: (...args: unknown[]) => mockCompletePractice(...args),
  revealQuestion: (...args: unknown[]) => mockRevealQuestion(...args),
}))
jest.mock('../lib/drillProgressStorage', () => ({
  loadDrillProgress: jest.fn().mockResolvedValue(null),
  saveDrillProgress: jest.fn().mockResolvedValue(undefined),
  clearDrillProgress: jest.fn().mockResolvedValue(undefined),
}))

const QUESTIONS = [
  { id: 'q1', question: 'Q1', category: null },
  { id: 'q2', question: 'Q2', category: null },
]

function mockStartResponse(overrides: Partial<{ status: string; sessionId: string | null }> = {}) {
  return {
    drill: { id: 'drill-1', drill_date: '2026-01-01', status: overrides.status ?? 'in_progress', estimated_minutes: 7, target_acs_tasks: [], started_at: null, completed_at: null, session_id: overrides.sessionId ?? 'session-1' },
    session_id: overrides.sessionId ?? 'session-1',
    questions: QUESTIONS,
  }
}

describe('useDrillSession', () => {
  beforeEach(() => {
    mockStartDailyDrill.mockReset()
    mockCompletePractice.mockReset()
    mockRevealQuestion.mockReset()
  })

  it('starts the drill and exposes the first question', async () => {
    mockStartDailyDrill.mockResolvedValue(mockStartResponse())
    const { result } = await renderHook(() => useDrillSession('drill-1'))

    await waitFor(() => expect(result.current.starting).toBe(false))
    expect(result.current.sessionId).toBe('session-1')
    expect(result.current.currentQuestion?.id).toBe('q1')
    expect(result.current.total).toBe(2)
  })

  // Z: duplicate Complete taps produce exactly one in-flight client call.
  // (complete() itself has no rating-completeness gate -- that's a UI-level
  // concern in the screen, not this hook -- so this drives complete()
  // directly without going through reveal()/rate() first.)
  it('debounces concurrent complete() calls into exactly one network request', async () => {
    mockStartDailyDrill.mockResolvedValue(mockStartResponse())
    let resolveComplete: (value: unknown) => void = () => {}
    mockCompletePractice.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = resolve
      })
    )

    const { result, unmount } = await renderHook(() => useDrillSession('drill-1'))
    await waitFor(() => expect(result.current.starting).toBe(false))

    let call1: Promise<void>, call2: Promise<void>, call3: Promise<void>
    await act(async () => {
      call1 = result.current.complete()
      call2 = result.current.complete()
      call3 = result.current.complete()
      // Yield one microtask so complete()'s synchronous guard section
      // (setting the in-flight ref before its first internal await) runs
      // for all three calls before this act() block itself resolves.
      await Promise.resolve()
    })

    expect(mockCompletePractice).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveComplete({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
      await Promise.all([call1, call2, call3])
    })

    expect(result.current.completing).toBe(false)
    expect(mockCompletePractice).toHaveBeenCalledTimes(1)
    unmount()
  })

  // AB: already_completed is treated as a success outcome, not an error.
  it('treats already_completed=true as a successful completion result', async () => {
    mockStartDailyDrill.mockResolvedValue(mockStartResponse())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: true })

    const { result } = await renderHook(() => useDrillSession('drill-1'))
    await waitFor(() => expect(result.current.starting).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(result.current.completeError).toBeNull()
    expect(result.current.completeResult).toEqual({ score: 2, total: 2, alreadyCompleted: true })
  })

  // AC: a network failure on complete() surfaces an error but leaves the
  // session in a state where the learner can retry (completing resets to
  // false, no completeResult is set, and a second complete() call is not
  // blocked by the debounce guard).
  it('surfaces a network failure and permits a retry', async () => {
    mockStartDailyDrill.mockResolvedValue(mockStartResponse())
    mockCompletePractice
      .mockRejectedValueOnce(new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }))
      .mockResolvedValueOnce({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useDrillSession('drill-1'))
    await waitFor(() => expect(result.current.starting).toBe(false))

    await act(async () => {
      await result.current.complete()
    })
    expect(result.current.completeError?.kind).toBe('network')
    expect(result.current.completeResult).toBeNull()

    await act(async () => {
      await result.current.complete()
    })
    expect(mockCompletePractice).toHaveBeenCalledTimes(2)
    expect(result.current.completeResult).toEqual({ score: 2, total: 2, alreadyCompleted: false })
  })

  // AD: the client never computes or stores its own XP value -- the only
  // fields useDrillSession's completeResult ever carries are exactly the
  // server's own score/total/already_completed, nothing XP-shaped.
  it('completeResult never carries an XP field -- only server score/total/already_completed', async () => {
    mockStartDailyDrill.mockResolvedValue(mockStartResponse())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useDrillSession('drill-1'))
    await waitFor(() => expect(result.current.starting).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(Object.keys(result.current.completeResult ?? {}).sort()).toEqual(['alreadyCompleted', 'score', 'total'])
  })
})
