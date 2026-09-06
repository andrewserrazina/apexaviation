import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useDrillSession } from '../hooks/useDrillSession'
import { ApiError } from '../lib/api/errors'

const mockStartDailyDrill = jest.fn()
const mockCompletePractice = jest.fn()
const mockRevealQuestion = jest.fn()
const mockLoadDrillProgress = jest.fn()
const mockSaveDrillProgress = jest.fn()
const mockClearDrillProgress = jest.fn()

jest.mock('../lib/api/dailyDrill', () => ({
  startDailyDrill: (...args: unknown[]) => mockStartDailyDrill(...args),
}))
jest.mock('../lib/api/practice', () => ({
  completePractice: (...args: unknown[]) => mockCompletePractice(...args),
  revealQuestion: (...args: unknown[]) => mockRevealQuestion(...args),
}))
jest.mock('../lib/drillProgressStorage', () => ({
  loadDrillProgress: (...args: unknown[]) => mockLoadDrillProgress(...args),
  saveDrillProgress: (...args: unknown[]) => mockSaveDrillProgress(...args),
  clearDrillProgress: (...args: unknown[]) => mockClearDrillProgress(...args),
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
    mockLoadDrillProgress.mockReset().mockResolvedValue(null)
    mockSaveDrillProgress.mockReset().mockResolvedValue(undefined)
    mockClearDrillProgress.mockReset().mockResolvedValue(undefined)
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

  // Rev2 section 1 regression: restart/resume must never deadlock. A
  // learner who revealed and rated Q1, then force-closed the app, must
  // come back to a restorable state -- never `isRevealed === true` with
  // no debrief content and no way to trigger Reveal again.
  describe('restart/resume regression (Rev2 section 1)', () => {
    it('restores a saved rating without restoring revealed state, then lets the learner reveal again and continue', async () => {
      mockLoadDrillProgress.mockResolvedValue({ sessionId: 'session-1', ratings: { q1: 'correct' } })
      mockStartDailyDrill.mockResolvedValue(mockStartResponse())
      mockRevealQuestion.mockResolvedValue({
        question_id: 'q1',
        model_answer: 'The model answer for Q1.',
        common_mistakes: null,
        dpe_evaluating: null,
        real_world_application: null,
      })

      const { result } = await renderHook(() => useDrillSession('drill-1'))
      await waitFor(() => expect(result.current.starting).toBe(false))

      // The core deadlock this guards against: a restored question must
      // never present as already revealed with no content and no way to
      // trigger Reveal again.
      expect(result.current.isRevealed).toBe(false)
      expect(result.current.revealContent).toBeNull()

      // The saved rating IS retained, even before this session's first
      // reveal call.
      expect(result.current.currentRating).toBe('correct')

      // Reveal can always be called from this restored state.
      await act(async () => {
        await result.current.reveal()
      })

      // The returned answer content becomes visible...
      expect(result.current.isRevealed).toBe(true)
      expect(result.current.revealContent?.model_answer).toBe('The model answer for Q1.')
      // ...and the previously saved rating is still shown as selected.
      expect(result.current.currentRating).toBe('correct')

      // The learner can continue past this question.
      await act(async () => {
        result.current.goNext()
      })
      expect(result.current.currentQuestion?.id).toBe('q2')
    })

    it('never persists revealed state locally -- only ratings', async () => {
      mockStartDailyDrill.mockResolvedValue(mockStartResponse())
      mockRevealQuestion.mockResolvedValue({
        question_id: 'q1',
        model_answer: 'Answer',
        common_mistakes: null,
        dpe_evaluating: null,
        real_world_application: null,
      })

      const { result } = await renderHook(() => useDrillSession('drill-1'))
      await waitFor(() => expect(result.current.starting).toBe(false))

      await act(async () => {
        await result.current.reveal()
      })
      await act(async () => {
        result.current.rate('correct')
      })

      await waitFor(() => expect(result.current.currentRating).toBe('correct'))
      const lastCall = mockSaveDrillProgress.mock.calls.at(-1)?.[0]
      expect(lastCall).toEqual({ sessionId: 'session-1', ratings: { q1: 'correct' } })
      expect(lastCall).not.toHaveProperty('revealedQuestionIds')
    })
  })
})
