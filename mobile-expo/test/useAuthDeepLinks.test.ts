// Exercises useAuthDeepLinks.ts's handling of the one deep-link path
// every verification/recovery email eventually lands on --
// apexadvantage://auth-callback?type=signup|recovery&code=<pkce-code>.
// Mirrors useNotificationRouting.test.tsx's own mocking shape for
// useRootNavigationState (never navigate before the root navigator
// exists) and expo-router's `router`.
const mockGetInitialURL = jest.fn()
const mockAddEventListener = jest.fn()
const mockParse = jest.fn()
jest.mock('expo-linking', () => ({
  getInitialURL: (...args: unknown[]) => mockGetInitialURL(...args),
  addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
  parse: (...args: unknown[]) => mockParse(...args),
}))

const mockUseRootNavigationState = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRootNavigationState: () => mockUseRootNavigationState(),
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}))

const mockExchangeCodeForSession = jest.fn()
jest.mock('../lib/supabase', () => ({
  supabase: { auth: { exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args) } },
}))

const mockSetAuthCallbackError = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ setAuthCallbackError: mockSetAuthCallbackError }),
}))

import { renderHook, waitFor } from '@testing-library/react-native'
import { useAuthDeepLinks } from '../hooks/useAuthDeepLinks'

const mockRemove = jest.fn()

function queryParamsFor(url: string): Record<string, string> {
  const query = url.split('?')[1] ?? ''
  const params: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const [k, v] = pair.split('=')
    params[k] = decodeURIComponent(v ?? '')
  }
  return params
}

beforeEach(() => {
  mockGetInitialURL.mockReset()
  mockAddEventListener.mockReset()
  mockParse.mockReset()
  mockRemove.mockReset()
  mockUseRootNavigationState.mockReset()
  mockReplace.mockReset()
  mockExchangeCodeForSession.mockReset()
  mockSetAuthCallbackError.mockReset()

  mockGetInitialURL.mockResolvedValue(null)
  mockAddEventListener.mockReturnValue({ remove: mockRemove })
  mockParse.mockImplementation((url: string) => ({ queryParams: queryParamsFor(url) }))
  // Ready by default, matching useNotificationRouting.test.tsx's own
  // convention -- individual tests override to simulate the
  // not-ready-yet window.
  mockUseRootNavigationState.mockReturnValue({ key: 'root' })
})

it('does nothing while the root navigator is not yet ready', async () => {
  mockUseRootNavigationState.mockReturnValue(undefined)
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=abc123')

  await renderHook(() => useAuthDeepLinks())

  expect(mockGetInitialURL).not.toHaveBeenCalled()
  expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
})

it('ignores a cold-start URL unrelated to the auth callback (e.g. a notification deep link)', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://practice/drill-1')

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockGetInitialURL).toHaveBeenCalled())

  expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  expect(mockReplace).not.toHaveBeenCalled()
})

it('exchanges a signup callback code and does not force navigation -- the session-redirect already handles it', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=signup&code=signup-code')
  mockExchangeCodeForSession.mockResolvedValue({ error: null })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledWith('signup-code'))

  expect(mockReplace).not.toHaveBeenCalled()
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

it('exchanges a recovery callback code and routes to the reset-password screen', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=recovery-code')
  mockExchangeCodeForSession.mockResolvedValue({ error: null })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))

  expect(mockExchangeCodeForSession).toHaveBeenCalledWith('recovery-code')
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

it('a URL with no code (already-used/expired link) surfaces the expired-link message and returns to sign-in', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?error=access_denied&error_description=Email+link+is+invalid')

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))

  expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  expect(mockSetAuthCallbackError).toHaveBeenCalledWith('That link has expired or was already used. Please request a new one.')
})

it('a failed code exchange (expired/already-used) surfaces the same message and returns to sign-in', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=stale-code')
  mockExchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid flow state' } })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))

  expect(mockSetAuthCallbackError).toHaveBeenCalledWith('That link has expired or was already used. Please request a new one.')
})

it('a thrown exchange error is handled the same way, never left uncaught', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=stale-code')
  mockExchangeCodeForSession.mockRejectedValue(new Error('network down'))

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))

  expect(mockSetAuthCallbackError).toHaveBeenCalledWith('That link has expired or was already used. Please request a new one.')
})

it('processes the SAME url only once, even if delivered via both getInitialURL and a live url event', async () => {
  const url = 'apexadvantage://auth-callback?type=recovery&code=recovery-code'
  mockGetInitialURL.mockResolvedValue(url)
  mockExchangeCodeForSession.mockResolvedValue({ error: null })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1))

  const liveHandler = mockAddEventListener.mock.calls[0][1] as (event: { url: string }) => void
  liveHandler({ url })
  await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1))
})

it('removes the url event listener on unmount', async () => {
  const { unmount } = await renderHook(() => useAuthDeepLinks())
  await unmount()
  expect(mockRemove).toHaveBeenCalledTimes(1)
})
