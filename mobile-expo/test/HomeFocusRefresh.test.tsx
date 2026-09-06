// Sprint 1A Rev2 section 8: Home must refresh bootstrap when it regains
// focus (e.g. "Back to Home" after completing a drill) so XP/streak/
// readiness/today's-drill are current without a manual pull-to-refresh --
// but the very first focus (the initial mount) must NOT trigger a
// redundant second bootstrap call, since BootstrapProvider already
// fetched once on mount.
import { render, screen } from '@testing-library/react-native'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import HomeScreen from '../app/(app)/index'

const mockUseFocusEffect = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (callback: () => void) => mockUseFocusEffect(callback),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseHomeDrill = jest.fn()
jest.mock('../hooks/useHomeDrill', () => ({
  useHomeDrill: (...args: unknown[]) => mockUseHomeDrill(...args),
}))

function bootstrapFixture(): MobileBootstrapDTO {
  return {
    user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
    training: { certificate_type: 'private_pilot', aircraft_class: 'ASEL', acs_version: '2024', checkride_date: null },
    access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
    progress: { xp: 100, current_rank: null, current_streak: 1, longest_streak: 1, readiness_summary: null },
    home: { todays_drill: null, weak_areas: [] },
  }
}

describe('Home refresh-on-focus (Rev2 section 8)', () => {
  it('does not refresh on the very first focus, but does refresh on subsequent focuses', async () => {
    const mockRefresh = jest.fn().mockResolvedValue(undefined)
    mockUseBootstrapContext.mockReturnValue({
      data: bootstrapFixture(),
      loading: false,
      refreshing: false,
      error: null,
      refresh: mockRefresh,
      ready: true,
      entitled: true,
    })
    mockUseHomeDrill.mockReturnValue({ drill: null, loading: false, error: null, retry: jest.fn() })

    await render(<HomeScreen />)
    expect(screen.getByText('Jordan Pilot')).toBeTruthy()

    const focusCallback = mockUseFocusEffect.mock.calls[0][0] as () => void
    expect(mockRefresh).not.toHaveBeenCalled()

    // First focus (the initial mount's own focus event) -- must be a
    // no-op, since BootstrapProvider already fetched once.
    focusCallback()
    expect(mockRefresh).not.toHaveBeenCalled()

    // A later focus (e.g. returning from a completed drill) -- must
    // trigger exactly one refresh.
    focusCallback()
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    // A third focus refreshes again -- this is a per-focus refresh, not
    // a one-time-only bypass.
    focusCallback()
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })
})
