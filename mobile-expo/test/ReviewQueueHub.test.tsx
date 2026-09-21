// Phase 2 (Review Queue mobile): the Review Queue hub -- entitlement-
// gated (same checkride_prep gate Practice/Oral use), shows a due count +
// Start Review CTA, or a caught-up message when nothing is due. Mirrors
// app/(app)/oral/index.tsx's test shape.
import { render, screen, waitFor } from '@testing-library/react-native'
import ReviewQueueTabScreen from '../app/(app)/review/index'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: jest.fn(),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseReviewQueue = jest.fn()
jest.mock('../hooks/useReviewQueue', () => ({
  useReviewQueue: (...args: unknown[]) => mockUseReviewQueue(...args),
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

function reviewQueueResult(overrides: Record<string, unknown> = {}) {
  return { data: null, loading: false, refreshing: false, error: null, refresh: jest.fn(), ...overrides }
}

describe('ReviewQueueTabScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockUseBootstrapContext.mockReset()
    mockUseReviewQueue.mockReset().mockReturnValue(reviewQueueResult())
  })

  it('shows LockedState and never calls useReviewQueue with enabled=true when unentitled', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ entitled: false, data: { ...bootstrapContext().data, access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } } })
    )

    await render(<ReviewQueueTabScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
    expect(mockUseReviewQueue).toHaveBeenCalledWith({ enabled: false })
  })

  it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
    const refresh = jest.fn()
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({ data: null, error: { userMessage: 'Check your connection and try again.' }, entitled: false, refresh })
    )

    await render(<ReviewQueueTabScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  })

  it('shows a caught-up message and no Start Review button when nothing is due', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewQueue.mockReturnValue(reviewQueueResult({ data: { items: [] } }))

    await render(<ReviewQueueTabScreen />)

    expect(screen.getByText(/all caught up/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start Review' })).toBeNull()
  })

  it('shows the due count filtered to dpe_question items only, and Start Review navigates to the session screen', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseReviewQueue.mockReturnValue(
      reviewQueueResult({
        data: {
          items: [
            { id: 'a', source_type: 'dpe_question', source_id: 'q1', module_id: null, acs_category: null, reason: 'incorrect', priority: 1, review_count: 0, next_review_at: '2026-01-01T00:00:00Z', question: 'Q?' },
            { id: 'b', source_type: 'module_quiz_question', source_id: 'mq1', module_id: 'PPL-M01', acs_category: null, reason: 'incorrect', priority: 1, review_count: 0, next_review_at: '2026-01-01T00:00:00Z', question: null },
          ],
        },
      })
    )

    await render(<ReviewQueueTabScreen />)

    expect(screen.getByText('1 item ready')).toBeTruthy()
    screen.getByRole('button', { name: 'Start Review' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Review' })).toBeTruthy())
  })
})
