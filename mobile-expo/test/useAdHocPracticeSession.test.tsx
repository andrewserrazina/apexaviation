// Sprint 1B.1 sections 6-12: the Resume -> Question -> Reveal -> Self-Rate
// -> Complete controller for one ad-hoc (Quick/Standard/Weak Area) practice
// session. Mirrors test/useDrillSession.test.tsx's renderHook approach --
// this hook is deliberately separate from useDrillSession, but shares its
// reducer, so these tests focus on what's actually different here: v119
// resume (never start), already-completed-on-resume handling, and
// permanent-vs-transient resume error recovery.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { classifyResumeError, useAdHocPracticeSession } from '../hooks/useAdHocPracticeSession'
import { ApiError } from '../lib/api/errors'

const mockResumePractice = jest.fn()
const mockRevealQuestion = jest.fn()
const mockCompletePractice = jest.fn()
jest.mock('../lib/api/practice', () => ({
  resumePractice: (...args: unknown[]) => mockResumePractice(...args),
  revealQuestion: (...args: unknown[]) => mockRevealQuestion(...args),
  completePractice: (...args: unknown[]) => mockCompletePractice(...args),
}))

const mockClearActivePracticeSession = jest.fn()
jest.mock('../lib/activePracticeStorage', () => ({
  clearActivePracticeSession: (...args: unknown[]) => mockClearActivePracticeSession(...args),
}))

const mockLoadDrillProgress = jest.fn()
const mockSaveDrillProgress = jest.fn()
const mockClearDrillProgress = jest.fn()
jest.mock('../lib/drillProgressStorage', () => ({
  loadDrillProgress: (...args: unknown[]) => mockLoadDrillProgress(...args),
  saveDrillProgress: (...args: unknown[]) => mockSaveDrillProgress(...args),
  clearDrillProgress: (...args: unknown[]) => mockClearDrillProgress(...args),
}))

const QUESTIONS = [
  { id: 'q1', question: 'Q1', category: null },
  { id: 'q2', question: 'Q2', category: null },
]

function resumeFixture(overrides: Partial<{ completed_at: string | null; questions: typeof QUESTIONS }> = {}) {
  return {
    session_id: 'session-1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: overrides.completed_at ?? null,
    target_acs_tasks: [],
    questions: overrides.questions ?? QUESTIONS,
  }
}

describe('useAdHocPracticeSession', () => {
  beforeEach(() => {
    mockResumePractice.mockReset()
    mockRevealQuestion.mockReset()
    mockCompletePractice.mockReset()
    mockClearActivePracticeSession.mockReset().mockResolvedValue(undefined)
    mockLoadDrillProgress.mockReset().mockResolvedValue(null)
    mockSaveDrillProgress.mockReset().mockResolvedValue(undefined)
    mockClearDrillProgress.mockReset().mockResolvedValue(undefined)
  })

  // 23. route waits for bootstrap before Resume -- covered at the hook
  // level here (enabled=false never calls resumePractice); the route's own
  // gating-before-render-time ordering is covered by
  // AdHocPracticeSessionScreen.test.tsx.
  it('never calls resumePractice while enabled is false', async () => {
    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: false, userId: 'u1' }))

    expect(mockResumePractice).not.toHaveBeenCalled()
    expect(result.current.resuming).toBe(true)
  })

  // 25. Resume initializes exact question order
  it('resumes and exposes the exact server-provided question order', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))

    await waitFor(() => expect(result.current.resuming).toBe(false))
    expect(mockResumePractice).toHaveBeenCalledWith('session-1')
    expect(result.current.currentQuestion?.id).toBe('q1')
    expect(result.current.total).toBe(2)
  })

  // 26 + 27 + 28. saved ratings restore, revealed state does NOT restore,
  // fresh Reveal is required after restart.
  it('restores a saved rating without restoring revealed state, requiring a fresh Reveal', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockLoadDrillProgress.mockResolvedValue({ sessionId: 'session-1', ratings: { q1: 'correct' } })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(result.current.isRevealed).toBe(false)
    expect(result.current.revealContent).toBeNull()
    expect(result.current.currentRating).toBe('correct')
  })

  // 29. reveal response renders normally
  it('reveal() fetches and exposes the debrief content, then marks the question revealed', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockRevealQuestion.mockResolvedValue({
      question_id: 'q1',
      model_answer: 'The model answer.',
      common_mistakes: null,
      dpe_evaluating: null,
      real_world_application: null,
    })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.reveal()
    })

    expect(mockRevealQuestion).toHaveBeenCalledWith('session-1', 'q1')
    expect(result.current.isRevealed).toBe(true)
    expect(result.current.revealContent?.model_answer).toBe('The model answer.')
  })

  // 30. Next navigates through reducer state
  it('goNext() advances to the next question and clears the previous reveal content', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockRevealQuestion.mockResolvedValue({
      question_id: 'q1',
      model_answer: 'Answer',
      common_mistakes: null,
      dpe_evaluating: null,
      real_world_application: null,
    })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.reveal()
    })
    await act(async () => {
      result.current.rate('correct')
    })
    await act(async () => {
      result.current.goNext()
    })

    expect(result.current.currentQuestion?.id).toBe('q2')
    expect(result.current.revealContent).toBeNull()
    expect(result.current.isRevealed).toBe(false)
  })

  // 31. final rated question shows Complete Practice -- this hook exposes
  // isLastQuestion + currentRating; the screen derives the CTA label from
  // both (see AdHocPracticeSessionScreen.test.tsx for the rendered label).
  it('isLastQuestion is true only once the reducer is positioned on the final question', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture({ questions: [QUESTIONS[0]] }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(result.current.isLastQuestion).toBe(true)
  })

  // 32. double Complete produces one request
  it('debounces concurrent complete() calls into exactly one network request', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    let resolveComplete: (value: unknown) => void = () => {}
    mockCompletePractice.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = resolve
      })
    )

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      result.current.complete()
      result.current.complete()
      result.current.complete()
      await Promise.resolve()
    })

    expect(mockCompletePractice).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveComplete({ session_id: 'session-1', score: 1, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
      await Promise.resolve()
    })

    expect(mockCompletePractice).toHaveBeenCalledTimes(1)
  })

  // 33 + 34. successful Complete clears the active pointer AND local ratings
  it('a successful complete() clears both the active-session pointer and local ratings for this session', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(mockClearDrillProgress).toHaveBeenCalledWith('session-1')
    expect(mockClearActivePracticeSession).toHaveBeenCalledWith('u1')
    expect(result.current.completeResult).toEqual({ score: 2, total: 2, alreadyCompleted: false })
  })

  // 35. completion uses self-rated wording -- the hook's completeResult
  // shape carries only score/total/alreadyCompleted, never an
  // objectively-graded field; the screen's exact copy is covered in
  // AdHocPracticeSessionScreen.test.tsx.
  it('completeResult never carries an XP or objectively-graded field', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture())
    mockCompletePractice.mockResolvedValue({ session_id: 'session-1', score: 2, total: 2, completed_at: '2026-01-01T00:00:00Z', already_completed: false })

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.complete()
    })

    expect(Object.keys(result.current.completeResult ?? {}).sort()).toEqual(['alreadyCompleted', 'score', 'total'])
  })

  // 38. already-completed Resume does not call Complete
  it('an already-completed resume never calls completePractice', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture({ completed_at: '2026-01-01T00:00:00Z' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(result.current.alreadyCompletedOnResume).toBe(true)
    expect(result.current.resumedCompletedAt).toBe('2026-01-01T00:00:00Z')
    expect(mockCompletePractice).not.toHaveBeenCalled()
  })

  // 39. already-completed Resume clears stale local active state
  it('an already-completed resume clears the stale local active-session pointer and local ratings', async () => {
    mockResumePractice.mockResolvedValue(resumeFixture({ completed_at: '2026-01-01T00:00:00Z' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(mockClearActivePracticeSession).toHaveBeenCalledWith('u1')
    expect(mockClearDrillProgress).toHaveBeenCalledWith('session-1')
  })

  // 40. permanent Resume failure offers local-clear recovery (classification)
  it('classifies not_found and forbidden resume errors as permanent', () => {
    expect(classifyResumeError(new ApiError({ kind: 'not_found', userMessage: 'x' }))).toBe('permanent')
    expect(classifyResumeError(new ApiError({ kind: 'forbidden', userMessage: 'x' }))).toBe('permanent')
  })

  // 41. transient Resume failure does not silently discard local session
  it('classifies network/server resume errors as transient, and never clears local state on its own', async () => {
    expect(classifyResumeError(new ApiError({ kind: 'network', userMessage: 'x' }))).toBe('transient')
    expect(classifyResumeError(new ApiError({ kind: 'server', userMessage: 'x' }))).toBe('transient')
    expect(classifyResumeError(null)).toBeNull()

    mockResumePractice.mockRejectedValue(new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(result.current.resumeError?.kind).toBe('network')
    expect(result.current.resumeErrorKind).toBe('transient')
    expect(mockClearActivePracticeSession).not.toHaveBeenCalled()
    expect(mockClearDrillProgress).not.toHaveBeenCalled()
  })

  // Section 12: removeSavedSession clears ONLY local state, never touches
  // the server -- proven here by there being no completePractice/
  // resumePractice call as a side effect of calling it.
  it('removeSavedSession clears local pointer + ratings only, never calling any server endpoint', async () => {
    mockResumePractice.mockRejectedValue(new ApiError({ kind: 'not_found', userMessage: 'This session no longer exists.' }))

    const { result } = await renderHook(() => useAdHocPracticeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.removeSavedSession()
    })

    expect(mockClearActivePracticeSession).toHaveBeenCalledWith('u1')
    expect(mockClearDrillProgress).toHaveBeenCalledWith('session-1')
    expect(mockCompletePractice).not.toHaveBeenCalled()
  })
})
