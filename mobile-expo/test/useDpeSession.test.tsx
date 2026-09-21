// Phase 1 (AI DPE mobile): the Resume -> chat (send/receive) -> End ->
// Debrief controller for one AI DPE oral-practice session. Mirrors
// test/useAdHocPracticeSession.test.tsx's renderHook approach and
// mocking shape.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useDpeSession } from '../hooks/useDpeSession'

const mockResumeDpeSession = jest.fn()
const mockSendDpeMessage = jest.fn()
const mockEndDpeSession = jest.fn()
jest.mock('../lib/api/dpe', () => ({
  resumeDpeSession: (...args: unknown[]) => mockResumeDpeSession(...args),
  sendDpeMessage: (...args: unknown[]) => mockSendDpeMessage(...args),
  endDpeSession: (...args: unknown[]) => mockEndDpeSession(...args),
}))

const mockClearActiveOralSessionIfMatches = jest.fn()
jest.mock('../lib/activeOralSessionStorage', () => ({
  clearActiveOralSessionIfMatches: (...args: unknown[]) => mockClearActiveOralSessionIfMatches(...args),
}))

function resumeFixture(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    status: 'in_progress',
    questionsAsked: 1,
    debrief: null,
    turns: [{ role: 'dpe', message: 'Opening question.', at: '2026-01-01T00:00:00Z' }],
    ...overrides,
  }
}

describe('useDpeSession', () => {
  beforeEach(() => {
    mockResumeDpeSession.mockReset()
    mockSendDpeMessage.mockReset()
    mockEndDpeSession.mockReset()
    mockClearActiveOralSessionIfMatches.mockReset().mockResolvedValue(undefined)
  })

  it('never calls resumeDpeSession while enabled is false', async () => {
    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: false, userId: 'u1' }))

    expect(mockResumeDpeSession).not.toHaveBeenCalled()
    expect(result.current.resuming).toBe(true)
  })

  it('resumes and exposes the reconstructed chat turns in server order', async () => {
    mockResumeDpeSession.mockResolvedValue(
      resumeFixture({
        turns: [
          { role: 'dpe', message: 'Q1', at: '2026-01-01T00:00:00Z' },
          { role: 'student', message: 'A1', at: '2026-01-01T00:01:00Z' },
        ],
      })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))

    await waitFor(() => expect(result.current.resuming).toBe(false))
    expect(mockResumeDpeSession).toHaveBeenCalledWith('session-1')
    expect(result.current.turns).toEqual([
      { role: 'dpe', message: 'Q1', at: '2026-01-01T00:00:00Z' },
      { role: 'student', message: 'A1', at: '2026-01-01T00:01:00Z' },
    ])
    expect(result.current.status).toBe('in_progress')
  })

  it('a completed resume clears the local active-session pointer', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture({ status: 'completed', debrief: { overallReadiness: 'ready', summary: 's', strengths: [], weaknesses: [], perDomain: [] } }))

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    expect(mockClearActiveOralSessionIfMatches).toHaveBeenCalledWith('u1', 'session-1')
  })

  it('sendMessage optimistically appends the student turn, then appends the confirmed dpe turn on success', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockSendDpeMessage.mockResolvedValue({
      sessionId: 'session-1',
      phase: 'question',
      message: 'Follow-up question.',
      debrief: null,
      questionsAsked: 2,
      status: 'in_progress',
    })

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('My answer.')
    })

    expect(mockSendDpeMessage).toHaveBeenCalledWith('session-1', 'My answer.')
    expect(result.current.turns).toHaveLength(3)
    expect(result.current.turns[1]).toMatchObject({ role: 'student', message: 'My answer.', pending: false })
    expect(result.current.turns[2]).toMatchObject({ role: 'dpe', message: 'Follow-up question.' })
    expect(result.current.questionsAsked).toBe(2)
  })

  it('never sends a blank/whitespace-only message', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('   ')
    })

    expect(mockSendDpeMessage).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic student bubble and surfaces an error when the server call fails', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockSendDpeMessage.mockRejectedValue(new Error('network blip'))

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('My answer.')
    })

    expect(result.current.turns).toHaveLength(1) // only the original dpe turn -- the optimistic student turn was rolled back
    expect(result.current.sendError).not.toBeNull()
  })

  it('debounces concurrent sendMessage calls into exactly one network request', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    let resolveSend: (value: unknown) => void = () => {}
    mockSendDpeMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      result.current.sendMessage('answer')
      result.current.sendMessage('answer')
      await Promise.resolve()
    })

    expect(mockSendDpeMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSend({ sessionId: 'session-1', phase: 'question', message: 'Next.', debrief: null, questionsAsked: 2, status: 'in_progress' })
      await Promise.resolve()
    })
  })

  it('never sends a new message once the session has completed', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture({ status: 'completed', debrief: { overallReadiness: 'ready', summary: 's', strengths: [], weaknesses: [], perDomain: [] } }))

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('too late')
    })

    expect(mockSendDpeMessage).not.toHaveBeenCalled()
  })

  it('endSession appends the closing dpe turn, publishes the debrief, and clears the local pointer', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    const debrief = { overallReadiness: 'almost', summary: 'Good effort.', strengths: ['x'], weaknesses: ['y'], perDomain: [] }
    mockEndDpeSession.mockResolvedValue({
      sessionId: 'session-1',
      phase: 'debrief',
      message: 'That concludes our oral.',
      debrief,
      questionsAsked: 1,
      status: 'completed',
    })

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.endSession()
    })

    expect(result.current.status).toBe('completed')
    expect(result.current.debrief).toEqual(debrief)
    expect(mockClearActiveOralSessionIfMatches).toHaveBeenCalledWith('u1', 'session-1')
  })

  it('never calls endDpeSession once the session has already completed', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture({ status: 'completed', debrief: { overallReadiness: 'ready', summary: 's', strengths: [], weaknesses: [], perDomain: [] } }))

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.endSession()
    })

    expect(mockEndDpeSession).not.toHaveBeenCalled()
  })
})
