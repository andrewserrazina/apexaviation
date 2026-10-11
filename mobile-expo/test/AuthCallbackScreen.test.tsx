// Exercises app/auth-callback.tsx itself -- the real Expo Router route
// that fixes the TestFlight "Unmatched Route" bug (a manual Linking
// listener alone never prevented Expo Router's own linking integration
// from independently trying to navigate to this path and finding no
// match). This test proves the route renders successfully for the
// exact URL shape from the bug report and hands its params straight to
// useAuthCallback -- the "cold start" requirement is satisfied by this
// being a normal file-based route at all: Expo Router resolves a deep
// link's route and params before ever mounting the destination screen,
// cold start or not, so there's no separate code path to test here
// beyond "this screen renders and reads its params correctly."
import { render, screen } from '@testing-library/react-native'
import AuthCallbackScreen from '../app/auth-callback'

const mockUseLocalSearchParams = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

const mockUseAuthCallback = jest.fn()
jest.mock('../hooks/useAuthDeepLinks', () => ({
  useAuthCallback: (...args: unknown[]) => mockUseAuthCallback(...args),
}))

beforeEach(() => {
  mockUseLocalSearchParams.mockReset()
  mockUseAuthCallback.mockReset()
})

it('renders successfully (never an Unmatched Route) for the exact URL shape from the bug report', async () => {
  // apexadvantage://auth-callback?type=signup&code=<redacted>
  mockUseLocalSearchParams.mockReturnValue({ type: 'signup', code: 'redacted-pkce-code' })

  await render(<AuthCallbackScreen />)

  expect(screen.getByText('Verifying…')).toBeTruthy()
  expect(screen.queryByText('Unmatched Route')).toBeNull()
})

it('passes the resolved code and type straight through to useAuthCallback', async () => {
  mockUseLocalSearchParams.mockReturnValue({ type: 'recovery', code: 'abc123' })

  await render(<AuthCallbackScreen />)

  expect(mockUseAuthCallback).toHaveBeenCalledWith('abc123', 'recovery')
})

it('passes null (not undefined) for code/type when Expo Router resolves no params at all', async () => {
  mockUseLocalSearchParams.mockReturnValue({})

  await render(<AuthCallbackScreen />)

  expect(mockUseAuthCallback).toHaveBeenCalledWith(null, null)
})
