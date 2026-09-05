// Sprint 1A Rev2 section 5: the completion screen must render the actual
// refreshed readiness indicator + evidence level (via the real
// ReadinessCard primitive), and phrase the session score as self-rated
// ("You marked X of Y correct"), never as an objectively-graded result.
import { render, screen } from '@testing-library/react-native'
import DrillSessionScreen from '../app/(app)/practice/[drillId]'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ drillId: 'drill-1' }),
}))

const mockUseDrillSession = jest.fn()
jest.mock('../hooks/useDrillSession', () => ({
  useDrillSession: (...args: unknown[]) => mockUseDrillSession(...args),
}))

const mockUsePostCompleteRefresh = jest.fn()
jest.mock('../hooks/usePostCompleteRefresh', () => ({
  usePostCompleteRefresh: (...args: unknown[]) => mockUsePostCompleteRefresh(...args),
}))

function completedSessionFixture(overrides: Partial<ReturnType<typeof baseSession>> = {}) {
  return { ...baseSession(), ...overrides }
}

function baseSession() {
  return {
    sessionId: 'session-1',
    questions: [],
    drillStatus: 'in_progress' as const,
    starting: false,
    startError: null,
    retryStart: jest.fn(),
    currentQuestion: null,
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
    completeResult: { score: 7, total: 7, alreadyCompleted: false },
    complete: jest.fn(),
  }
}

describe('Drill completion screen', () => {
  beforeEach(() => {
    mockUseDrillSession.mockReset()
    mockUsePostCompleteRefresh.mockReset()
  })

  it('phrases the score as self-rated, not objectively graded', async () => {
    mockUseDrillSession.mockReturnValue(completedSessionFixture())
    mockUsePostCompleteRefresh.mockReturnValue({ loading: false, progress: null, readiness: null })

    await render(<DrillSessionScreen />)

    expect(screen.getByText('You marked 7 of 7 correct')).toBeTruthy()
    expect(screen.queryByText(/graded|objectively/i)).toBeNull()
  })

  it('renders the actual refreshed readiness score and evidence level, not just a generic "updated" line', async () => {
    mockUseDrillSession.mockReturnValue(completedSessionFixture())
    mockUsePostCompleteRefresh.mockReturnValue({
      loading: false,
      progress: { xp: 500, current_rank: 'Solo Pilot', current_streak: 3, longest_streak: 8, readiness_summary: null },
      readiness: {
        overall_score: 63,
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

    await render(<DrillSessionScreen />)

    expect(screen.getByText('63')).toBeTruthy()
    expect(screen.getByText('BUILDING EVIDENCE')).toBeTruthy()
    expect(screen.getByText('500 XP • 3 day streak')).toBeTruthy()
    const banned = /chance of passing|probability of passing|likelihood of passing|you will pass|you'll pass/i
    expect(screen.queryByText(banned)).toBeNull()
  })

  // Rev3 section 4: the screen must forward completeResult.alreadyCompleted
  // through to usePostCompleteRefresh so it knows whether to recompute
  // (refreshReadiness) or just re-fetch (fetchLatestReadiness) -- see
  // test/usePostCompleteRefresh.test.tsx for the hook-level proof of which
  // API action each case actually calls.
  it('forwards alreadyCompleted=false to usePostCompleteRefresh for a genuinely new completion', async () => {
    mockUseDrillSession.mockReturnValue(completedSessionFixture({ completeResult: { score: 5, total: 7, alreadyCompleted: false } }))
    mockUsePostCompleteRefresh.mockReturnValue({ loading: false, progress: null, readiness: null })

    await render(<DrillSessionScreen />)

    expect(mockUsePostCompleteRefresh).toHaveBeenCalledWith(true, false)
  })

  it('forwards alreadyCompleted=true to usePostCompleteRefresh for an idempotent replay', async () => {
    mockUseDrillSession.mockReturnValue(completedSessionFixture({ completeResult: { score: 7, total: 7, alreadyCompleted: true } }))
    mockUsePostCompleteRefresh.mockReturnValue({ loading: false, progress: null, readiness: null })

    await render(<DrillSessionScreen />)

    expect(mockUsePostCompleteRefresh).toHaveBeenCalledWith(true, true)
  })
})
