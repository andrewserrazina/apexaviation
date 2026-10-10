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
  mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledWith('signup-code'))

  expect(mockReplace).not.toHaveBeenCalled()
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

it('exchanges a recovery callback code and routes to the reset-password screen, using the SDK’s own redirectType', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=recovery-code')
  mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))

  expect(mockExchangeCodeForSession).toHaveBeenCalledWith('recovery-code')
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

// Security review finding: the ?type= query param travels through two
// URL hops (the web bounce page, then this custom-scheme link) and must
// never be the deciding signal for whether a recovery session gets
// treated as one -- supabase-js's own redirectType (derived from the
// locally-stored PKCE record, never from the URL) is authoritative.
describe('redirectType is the authoritative signal, not the ?type= query param', () => {
  it('routes to reset-password when the SDK reports redirectType: "recovery", even if the URL said type=signup', async () => {
    mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=signup&code=some-code')
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null })

    await renderHook(() => useAuthDeepLinks())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))
  })

  it('does NOT route to reset-password when the SDK reports a non-recovery redirectType, even if the URL said type=recovery', async () => {
    // The security-relevant direction: a mis-set or (hypothetically)
    // tampered ?type=recovery must never force the reset-password
    // screen for a session the SDK itself did not derive from a
    // recovery flow.
    mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=some-code')
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'signup' }, error: null })

    await renderHook(() => useAuthDeepLinks())
    await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalled())

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('falls back to the ?type= query param only when the SDK reports no redirectType at all', async () => {
    mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=some-code')
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

    await renderHook(() => useAuthDeepLinks())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))
  })
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

// Security review finding: this specific failure (the PKCE code_verifier
// isn't in this app installation's storage -- see
// isPkceCodeVerifierMissingError's own comment) is NOT the same thing as
// an expired/already-used link, and must say so -- the generic message
// would send someone to request a brand new link when the real fix is
// "open this on the device you started on."
it('a code-verifier-missing exchange failure (opened on a different device/app) surfaces a distinct, accurate message', async () => {
  mockGetInitialURL.mockResolvedValue('apexadvantage://auth-callback?type=recovery&code=some-code')
  mockExchangeCodeForSession.mockResolvedValue({
    error: { name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found', message: 'PKCE code verifier not found in storage.' },
  })

  await renderHook(() => useAuthDeepLinks())
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))

  expect(mockSetAuthCallbackError).toHaveBeenCalledWith(
    'That link needs to be opened on the same device where you started creating your account or requesting a password reset. Please try again from this device.'
  )
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
  mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null })

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
