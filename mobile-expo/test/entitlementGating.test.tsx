// Sprint 1A Rev2 section 3: an unentitled learner must never generate a
// mobile-daily-drill request from Home OR the Practice tab, and both
// screens must show a polished, intentional locked state rather than a
// retryable "premium API failed" error. Unlike test/Home.test.tsx, this
// file does NOT mock useHomeDrill/useDailyDrill -- it exercises the real
// hooks against a mocked mobile-daily-drill client, so the entitlement
// gate itself (not just its rendered output) is under test.
import { render, screen, waitFor } from '@testing-library/react-native'
import HomeScreen from '../app/(app)/index'
import PracticeTabScreen from '../app/(app)/practice/index'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
}))

const mockFetchDailyDrill = jest.fn()
jest.mock('../lib/api/dailyDrill', () => ({
  fetchDailyDrill: (...args: unknown[]) => mockFetchDailyDrill(...args),
  startDailyDrill: jest.fn(),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

function unentitledBootstrapContext() {
  return {
    data: {
      user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
      training: { certificate_type: 'private_pilot', aircraft_class: 'airplane_single_engine_land', acs_version: '2024', checkride_date: null },
      access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] },
      progress: { xp: 0, current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null },
      home: { todays_drill: null, weak_areas: [] },
    },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    ready: true,
    entitled: false,
  }
}

const FORBIDDEN_STEERING = /https?:\/\/|apexaviationtx|browser|buy|purchase|checkout|price|\$\d/i

describe('entitlement gating (Rev2 section 3)', () => {
  beforeEach(() => {
    mockFetchDailyDrill.mockReset()
    mockUseBootstrapContext.mockReset()
  })

  it('an unentitled Home never calls mobile-daily-drill', async () => {
    mockUseBootstrapContext.mockReturnValue(unentitledBootstrapContext())

    await render(<HomeScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
    expect(mockFetchDailyDrill).not.toHaveBeenCalled()
    expect(screen.queryByText(FORBIDDEN_STEERING)).toBeNull()
  })

  it('an unentitled Practice tab never calls mobile-daily-drill and shows a locked state, not a retryable error', async () => {
    mockUseBootstrapContext.mockReturnValue(unentitledBootstrapContext())

    await render(<PracticeTabScreen />)

    expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
    expect(screen.queryByText('Try again')).toBeNull()
    expect(mockFetchDailyDrill).not.toHaveBeenCalled()
    expect(screen.queryByText(FORBIDDEN_STEERING)).toBeNull()
  })

  it('an entitled Home DOES call mobile-daily-drill once bootstrap resolves with no drill yet', async () => {
    mockFetchDailyDrill.mockResolvedValue({
      drill: { id: 'd1', drill_date: '2026-01-01', status: 'pending', estimated_minutes: 8, target_acs_tasks: [], started_at: null, completed_at: null, session_id: null },
      session_id: null,
      questions: [],
    })
    mockUseBootstrapContext.mockReturnValue({
      ...unentitledBootstrapContext(),
      entitled: true,
      data: {
        ...unentitledBootstrapContext().data,
        access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
      },
    })

    await render(<HomeScreen />)

    await waitFor(() => expect(mockFetchDailyDrill).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Start Drill')).toBeTruthy()
  })
})
