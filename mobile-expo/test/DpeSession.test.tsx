// Phase 1 (AI DPE mobile): oral/session/[sessionId] can be reached
// directly (a deep link, or a cold-started app resuming its last route)
// without ever passing through the Oral hub's own gating, so this screen
// must independently obey the same bootstrap/entitlement ordering before
// it will call resume. Mirrors AdHocPracticeSessionScreen.test.tsx's
// approach of mocking the session hook entirely.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import OralSessionScreen from '../app/(app)/oral/session/[sessionId]'
import { ApiError } from '../lib/api/errors'

const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ sessionId: 'session-1' }),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseAuth = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

const mockUseDpeSession = jest.fn()
jest.mock('../hooks/useDpeSession', () => ({
  useDpeSession: (...args: unknown[]) => mockUseDpeSession(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
      training: { certificate_type: 'private_pilot', aircraft_class: 'ASEL', acs_version: '2024', checkride_date: null },
      access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
      progress: { xp: 0, current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null },
      home: { todays_drill: null, weak_areas: [] },
    },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    ready: true,
    entitled: true,
    ...overrides,
  }
}

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    resuming: false,
    resumeError: null,
    retryResume: jest.fn(),
    turns: [{ role: 'dpe', message: 'Opening question.', at: '2026-01-01T00:00:00Z' }],
    status: 'in_progress',
    questionsAsked: 1,
    debrief: null,
    sending: false,
    sendError: null,
    sendMessage: jest.fn(),
    ending: false,
    endError: null,
    endSession: jest.fn(),
    ...overrides,
  }
}

describe('OralSessionScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockReplace.mockReset()
    mockUseBootstrapContext.mockReset()
    mockUseAuth.mockReset().mockReturnValue({ user: { id: 'u1' } })
    mockUseDpeSession.mockReset().mockReturnValue(baseSession())
  })

  it('never calls useDpeSession with enabled=true while bootstrap has not resolved', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext({ loading: true, ready: false }))

    await render(<OralSessionScreen />)

    expect(mockUseDpeSession).toHaveBeenCalledWith('session-1', { enabled: false, userId: 'u1' })
  })

  it('shows LockedState and passes enabled=false when the learner is not entitled', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ entitled: false, data: { ...bootstrapContext().data, access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } } })
    )

    await render(<OralSessionScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
    expect(mockUseDpeSession).toHaveBeenCalledWith('session-1', { enabled: false, userId: 'u1' })
  })

  it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
    const refresh = jest.fn()
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ data: null, error: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }), entitled: false, refresh })
    )

    await render(<OralSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows a loading state while resuming', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(baseSession({ resuming: true }))

    await render(<OralSessionScreen />)

    expect(screen.getByText('Resuming your oral practice session…')).toBeTruthy()
  })

  it('shows a retryable error when resume fails', async () => {
    const retryResume = jest.fn()
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(
      baseSession({ resumeError: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }), retryResume })
    )

    await render(<OralSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(retryResume).toHaveBeenCalledTimes(1)
  })

  it('renders the chat turns from the hook', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(
      baseSession({
        turns: [
          { role: 'dpe', message: 'Tell me about your certificate.', at: '2026-01-01T00:00:00Z' },
          { role: 'student', message: 'It is a private pilot certificate.', at: '2026-01-01T00:01:00Z' },
        ],
      })
    )

    await render(<OralSessionScreen />)

    expect(screen.getByText('Tell me about your certificate.')).toBeTruthy()
    expect(screen.getByText('It is a private pilot certificate.')).toBeTruthy()
  })

  // Note: a "type into the input, then press Send" interaction test is
  // intentionally omitted here -- this jest-expo/@testing-library/react-native
  // environment does not commit state updates from a controlled TextInput's
  // fireEvent.changeText (confirmed via an isolated minimal repro; no
  // existing test anywhere in this suite exercises that pattern either,
  // e.g. app/(auth)/sign-in.tsx's own TextInputs have no test coverage of
  // typing). sendMessage's actual send/optimistic-append/rollback behavior
  // is fully covered at the hook level in useDpeSession.test.tsx; this
  // file covers the screen's OWN wiring (gating, rendering, button
  // enablement, End Session, debrief render) instead.
  it('disables Send while the input is empty', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(baseSession())

    await render(<OralSessionScreen />)

    const sendButton = screen.getByRole('button', { name: 'Send' })
    expect(sendButton.props.accessibilityState.disabled).toBe(true)
  })

  it('pressing End Session calls endSession', async () => {
    const endSession = jest.fn()
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(baseSession({ endSession }))

    await render(<OralSessionScreen />)

    fireEvent.press(screen.getByRole('button', { name: 'End Session' }))
    expect(endSession).toHaveBeenCalledTimes(1)
  })

  it('renders the DebriefView once the session completes with a debrief, instead of the chat', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(
      baseSession({
        status: 'completed',
        debrief: {
          overallReadiness: 'ready',
          summary: 'Great job overall.',
          strengths: ['Airspace'],
          weaknesses: [],
          perDomain: [],
        },
      })
    )

    await render(<OralSessionScreen />)

    expect(screen.getByText('Ready for Checkride')).toBeTruthy()
    expect(screen.getByText('Great job overall.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('DebriefView\'s "Back to Oral" navigates to the Oral hub', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDpeSession.mockReturnValue(
      baseSession({
        status: 'completed',
        debrief: { overallReadiness: 'not_yet', summary: 'x', strengths: [], weaknesses: [], perDomain: [] },
      })
    )

    await render(<OralSessionScreen />)

    fireEvent.press(screen.getByRole('button', { name: 'Back to Oral' }))
    expect(mockReplace).toHaveBeenCalledWith('/(app)/oral')
  })
})
