// Phase 2 (Review Queue mobile): the session screen -- Load -> Question
// -> Reveal -> Reinforced/Needs Another Pass -> next -> completion.
// Mirrors test/DpeSession.test.tsx's approach of mocking the session hook
// entirely.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import ReviewSessionScreen from '../app/(app)/review/session'
import { ApiError } from '../lib/api/errors'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseReviewSession = jest.fn()
jest.mock('../hooks/useReviewSession', () => ({
  useReviewSession: (...args: unknown[]) => mockUseReviewSession(...args),
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
    loading: false,
    loadError: null,
    retryLoad: jest.fn(),
    item: { reviewItemId: 'item-1', title: 'Airspace', prompt: 'What class of airspace surrounds a Class B primary airport?', submissionKey: 'key-0', processed: false },
    index: 0,
    total: 1,
    complete: false,
    reinforcedCount: 0,
    needsPassCount: 0,
    revealed: false,
    revealContent: null,
    revealing: false,
    revealError: null,
    reveal: jest.fn(),
    submitting: false,
    submitError: null,
    submitOutcome: jest.fn(),
    ...overrides,
  }
}

describe('ReviewSessionScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockUseBootstrapContext.mockReset()
    mockUseReviewSession.mockReset().mockReturnValue(baseSession())
  })

  it('shows LockedState when the learner is not entitled', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ entitled: false, data: { ...bootstrapContext().data, access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } } })
    )

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
  })

  it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
    const refresh = jest.fn()
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ data: null, error: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }), entitled: false, refresh })
    )

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows a loading state while the session is being built', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(baseSession({ loading: true }))

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Building your review session…')).toBeTruthy()
  })

  it('shows a retryable error when the session fails to load', async () => {
    const retryLoad = jest.fn()
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(
      baseSession({ loadError: new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }), retryLoad })
    )

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(retryLoad).toHaveBeenCalledTimes(1)
  })

  it('shows a caught-up message when there is nothing due', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(baseSession({ total: 0, item: null }))

    await render(<ReviewSessionScreen />)

    expect(screen.getByText(/all caught up/)).toBeTruthy()
  })

  it('renders the current prompt and a Reveal button before reveal', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('What class of airspace surrounds a Class B primary airport?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reinforced' })).toBeNull()
  })

  it('pressing Reveal calls reveal', async () => {
    const reveal = jest.fn()
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(baseSession({ reveal }))

    await render(<ReviewSessionScreen />)
    fireEvent.press(screen.getByRole('button', { name: 'Reveal' }))

    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('shows RevealContent and outcome buttons once revealed', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(
      baseSession({
        revealed: true,
        revealContent: { model_answer: 'Class B.', common_mistakes: null, dpe_evaluating: null, real_world_application: null },
      })
    )

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Class B.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reinforced' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs Another Pass' })).toBeTruthy()
  })

  it('pressing Reinforced calls submitOutcome with reinforced', async () => {
    const submitOutcome = jest.fn()
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(
      baseSession({
        revealed: true,
        revealContent: { model_answer: 'Class B.', common_mistakes: null, dpe_evaluating: null, real_world_application: null },
        submitOutcome,
      })
    )

    await render(<ReviewSessionScreen />)
    fireEvent.press(screen.getByRole('button', { name: 'Reinforced' }))

    await waitFor(() => expect(submitOutcome).toHaveBeenCalledWith('reinforced'))
  })

  it('shows a Retry button (not the outcome buttons) after a failed submission', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(
      baseSession({
        revealed: true,
        revealContent: { model_answer: 'Class B.', common_mistakes: null, dpe_evaluating: null, real_world_application: null },
        submitError: new ApiError({ kind: 'network', userMessage: 'Connection issue — your answer wasn’t confirmed. Tap to try again.' }),
      })
    )

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Connection issue — your answer wasn’t confirmed. Tap to try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reinforced' })).toBeNull()
  })

  it('renders the completion view once the session is complete', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(baseSession({ complete: true, reinforcedCount: 1, total: 1, item: null }))

    await render(<ReviewSessionScreen />)

    expect(screen.getByText('Review Complete')).toBeTruthy()
    expect(screen.getByText('1 / 1 reinforced')).toBeTruthy()
  })

  it('the completion view’s CTA navigates back to the Review Queue hub', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewSession.mockReturnValue(baseSession({ complete: true, reinforcedCount: 0, total: 1, item: null }))

    await render(<ReviewSessionScreen />)
    fireEvent.press(screen.getByRole('button', { name: 'Back to Review Queue' }))

    expect(mockReplace).toHaveBeenCalledWith('/(app)/review')
  })
})
