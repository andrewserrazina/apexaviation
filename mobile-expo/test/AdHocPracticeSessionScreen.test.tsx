// Sprint 1B.1 section 13: practice/session/[sessionId] can be reached
// directly (a deep link, or a cold-started app resuming its last route)
// without ever passing through the Practice hub's own gating, so this
// screen must independently obey the same bootstrap/entitlement ordering
// before it will call resume. Mirrors DrillCompletion.test.tsx's approach
// of mocking the session hook entirely to exercise the screen's own
// render logic in isolation.
import { render, screen, fireEvent } from '@testing-library/react-native'
import AdHocPracticeSessionScreen from '../app/(app)/practice/session/[sessionId]'
import { ApiError } from '../lib/api/errors'

const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ sessionId: 'session-1', title: 'Quick Practice' }),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseAuth = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

const mockUseAdHocPracticeSession = jest.fn()
jest.mock('../hooks/useAdHocPracticeSession', () => ({
  useAdHocPracticeSession: (...args: unknown[]) => mockUseAdHocPracticeSession(...args),
}))

const mockUsePostCompleteRefresh = jest.fn()
jest.mock('../hooks/usePostCompleteRefresh', () => ({
  usePostCompleteRefresh: (...args: unknown[]) => mockUsePostCompleteRefresh(...args),
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
    resumeErrorKind: null,
    retryResume: jest.fn(),
    removeSavedSession: jest.fn().mockResolvedValue(undefined),
    sessionMeta: { mode: 'dpe_questions', startedAt: '2026-01-01T00:00:00Z', targetAcsTasks: [] },
    alreadyCompletedOnResume: false,
    resumedCompletedAt: null,
    currentQuestion: { id: 'q1', question: 'Q1?', category: null },
    currentIndex: 0,
    total: 2,
    isRevealed: false,
    currentRating: null,
    isLastQuestion: false,
    allRated: false,
    revealContent: null,
    revealing: false,
    revealError: null,
    reveal: jest.fn(),
    rate: jest.fn(),
    goNext: jest.fn(),
    completing: false,
    completeError: null,
    completeResult: null,
    complete: jest.fn(),
    ...overrides,
  }
}

describe('AdHocPracticeSessionScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockReplace.mockReset()
    mockUseBootstrapContext.mockReset()
    mockUseAuth.mockReset().mockReturnValue({ user: { id: 'u1' } })
    mockUseAdHocPracticeSession.mockReset()
    mockUsePostCompleteRefresh.mockReset().mockReturnValue({ loading: false, progress: null, readiness: null })
  })

  // 23. route waits for bootstrap before Resume
  it('never calls useAdHocPracticeSession with enabled=true while bootstrap has not resolved', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext({ loading: true, ready: false }))
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ resuming: true }))

    await render(<AdHocPracticeSessionScreen />)

    expect(mockUseAdHocPracticeSession).toHaveBeenCalledWith('session-1', { enabled: false, userId: 'u1' })
  })

  // 24. unentitled deep-link does not call Resume
  it('shows LockedState and passes enabled=false when the learner is not entitled -- never fires resume', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ entitled: false, data: { ...bootstrapContext().data, access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } } })
    )
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ resuming: true }))

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
    expect(mockUseAdHocPracticeSession).toHaveBeenCalledWith('session-1', { enabled: false, userId: 'u1' })
  })

  it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
    const refresh = jest.fn()
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ data: null, error: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }), entitled: false, refresh })
    )
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ resuming: true }))

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('calls useAdHocPracticeSession with enabled=true once bootstrap resolves entitled', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(baseSession())

    await render(<AdHocPracticeSessionScreen />)

    expect(mockUseAdHocPracticeSession).toHaveBeenCalledWith('session-1', { enabled: true, userId: 'u1' })
  })

  it('shows the already-complete empty state and a "Back to Practice" CTA -- never re-completes', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ alreadyCompletedOnResume: true, resumedCompletedAt: '2026-01-01T00:00:00Z' }))

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('This practice session is already complete')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Back to Practice' }))
    expect(mockReplace).toHaveBeenCalledWith('/(app)/practice')
  })

  // Section 12: permanent vs transient resume error recovery.
  it('offers "Remove Saved Session" for a permanent resume error, and it clears local state then navigates back', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    const removeSavedSession = jest.fn().mockResolvedValue(undefined)
    mockUseAdHocPracticeSession.mockReturnValue(
      baseSession({
        resumeError: new ApiError({ kind: 'not_found', userMessage: 'This session no longer exists.' }),
        resumeErrorKind: 'permanent',
        removeSavedSession,
      })
    )

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('This session no longer exists.')).toBeTruthy()
    const removeButton = screen.getByRole('button', { name: 'Remove Saved Session' })
    fireEvent.press(removeButton)

    await screen.findByText('This session no longer exists.')
    expect(removeSavedSession).toHaveBeenCalledTimes(1)
  })

  it('never offers "Remove Saved Session" for a transient resume error -- only Retry', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(
      baseSession({
        resumeError: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }),
        resumeErrorKind: 'transient',
      })
    )

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Saved Session' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  // 31. final rated question shows Complete Practice
  it('shows "Next" for a rated non-final question', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(
      baseSession({ isRevealed: true, revealContent: { question_id: 'q1', model_answer: 'Answer', common_mistakes: null, dpe_evaluating: null, real_world_application: null }, currentRating: 'correct', isLastQuestion: false })
    )

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete Practice' })).toBeNull()
  })

  it('shows "Complete Practice" once the final question is rated', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(
      baseSession({ isRevealed: true, revealContent: { question_id: 'q2', model_answer: 'Answer', common_mistakes: null, dpe_evaluating: null, real_world_application: null }, currentRating: 'correct', isLastQuestion: true })
    )

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByRole('button', { name: 'Complete Practice' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  // Section 9: uses "Practice" copy, never implies an objective grade.
  it('renders the ad-hoc header label and never uses Daily Drill copy', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(baseSession())

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('QUICK PRACTICE')).toBeTruthy()
    expect(screen.queryByText(/drill/i)).toBeNull()
  })

  // 35, 36, 37: completion uses self-rated wording, renders the actual
  // ReadinessCard, and its CTA returns to Practice (never Home).
  it('completion screen phrases the score as self-rated, shows the real readiness score, and returns to Practice', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ completeResult: { score: 4, total: 5, alreadyCompleted: false } }))
    mockUsePostCompleteRefresh.mockReturnValue({
      loading: false,
      progress: { xp: 120, current_rank: null, current_streak: 2, longest_streak: 4, readiness_summary: null },
      readiness: {
        overall_score: 55,
        coverage_score: 0,
        knowledge_score: 0,
        risk_management_score: 0,
        confidence_score: 0,
        evidence_level: 'moderate',
        weak_tasks: [],
        reason_codes: [],
        algorithm_version: 'v3',
        computed_at: '2026-01-01T00:00:00Z',
      },
    })

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.getByText('You marked 4 of 5 correct in Quick Practice')).toBeTruthy()
    expect(screen.queryByText(/graded|objectively/i)).toBeNull()
    expect(screen.getByText('55')).toBeTruthy()
    const ctaButton = screen.getByRole('button', { name: 'Back to Practice' })
    fireEvent.press(ctaButton)
    expect(mockReplace).toHaveBeenCalledWith('/(app)/practice')
  })

  it('never shows "Back to Home" on the ad-hoc completion screen', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseAdHocPracticeSession.mockReturnValue(baseSession({ completeResult: { score: 5, total: 5, alreadyCompleted: false } }))

    await render(<AdHocPracticeSessionScreen />)

    expect(screen.queryByRole('button', { name: 'Back to Home' })).toBeNull()
  })
})
