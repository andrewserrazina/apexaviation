// Phase 1 (AI DPE mobile): the Resume -> chat (send/receive) -> End ->
// Debrief controller for one AI DPE oral-practice session. Mirrors
// test/useAdHocPracticeSession.test.tsx's renderHook approach and
// mocking shape.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { dpeFriendlyError, useDpeSession } from '../hooks/useDpeSession'
import { ApiError } from '../lib/api/errors'

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

  // Nov 2026 incident: start/message/end can now fail with a classified
  // ai_dpe_* code on a 502/503 ApiError (see dpeChatCore.ts). sendError
  // and endError must surface the specific, already-vetted-safe message
  // for a known code -- never the raw provider/billing text, and never an
  // indefinite loading state or an unrecognizable crash.
  it('sendMessage surfaces the specific insufficient-credits message instead of the generic server one', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockSendDpeMessage.mockRejectedValue(
      new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 503, code: 'ai_dpe_insufficient_credits' })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('My answer.')
    })

    expect(result.current.sendError?.userMessage).toBe('Oral Practice is temporarily unavailable. Please try again in a little while.')
    expect(result.current.sendError?.code).toBe('ai_dpe_insufficient_credits')
  })

  it('sendMessage surfaces the specific rate-limited message', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockSendDpeMessage.mockRejectedValue(
      new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 503, code: 'ai_dpe_rate_limited' })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('My answer.')
    })

    expect(result.current.sendError?.userMessage).toBe('Oral Practice is experiencing high demand right now. Please wait a moment and try again.')
  })

  it('sendMessage leaves an unrecognized server error with its original generic message', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockSendDpeMessage.mockRejectedValue(
      new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 500, code: null })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.sendMessage('My answer.')
    })

    expect(result.current.sendError?.userMessage).toBe('Something went wrong on our end. Please try again in a moment.')
  })

  it('endSession surfaces the specific provider-outage message instead of the generic server one', async () => {
    mockResumeDpeSession.mockResolvedValue(resumeFixture())
    mockEndDpeSession.mockRejectedValue(
      new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 503, code: 'ai_dpe_provider_unavailable' })
    )

    const { result } = await renderHook(() => useDpeSession('session-1', { enabled: true, userId: 'u1' }))
    await waitFor(() => expect(result.current.resuming).toBe(false))

    await act(async () => {
      await result.current.endSession()
    })

    expect(result.current.endError?.userMessage).toBe('Oral Practice is temporarily unavailable. Please try again in a little while.')
  })
})

describe('dpeFriendlyError', () => {
  it.each([
    ['ai_dpe_insufficient_credits', 'Oral Practice is temporarily unavailable. Please try again in a little while.'],
    ['ai_dpe_provider_unavailable', 'Oral Practice is temporarily unavailable. Please try again in a little while.'],
    ['ai_dpe_auth_config_error', 'Oral Practice is temporarily unavailable. Please try again in a little while.'],
    ['ai_dpe_rate_limited', 'Oral Practice is experiencing high demand right now. Please wait a moment and try again.'],
    ['ai_dpe_malformed_response', 'The examiner had trouble responding. Please try again.'],
  ])('maps %s to its specific, safe message', (code, expectedMessage) => {
    const error = new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 503, code })
    expect(dpeFriendlyError(error).userMessage).toBe(expectedMessage)
  })

  it('leaves an unknown code unchanged', () => {
    const error = new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 500, code: 'some_other_code' })
    expect(dpeFriendlyError(error)).toBe(error)
  })

  it('leaves a missing code unchanged', () => {
    const error = new ApiError({ kind: 'server', userMessage: 'Something went wrong on our end. Please try again in a moment.', status: 500 })
    expect(dpeFriendlyError(error)).toBe(error)
  })

  it('never produces a message containing billing, credit, key, or provider-name text', () => {
    const forbidden = ['credit', 'balance', 'billing', 'api key', 'anthropic']
    for (const code of ['ai_dpe_insufficient_credits', 'ai_dpe_rate_limited', 'ai_dpe_provider_unavailable', 'ai_dpe_auth_config_error', 'ai_dpe_malformed_response']) {
      const error = new ApiError({ kind: 'server', userMessage: 'generic', status: 503, code })
      const message = dpeFriendlyError(error).userMessage.toLowerCase()
      for (const word of forbidden) {
        expect(message).not.toContain(word)
      }
    }
  })
})
