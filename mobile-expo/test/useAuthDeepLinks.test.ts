// Exercises useAuthCallback (hooks/useAuthDeepLinks.ts), the exchange/
// dedup/navigation logic app/auth-callback.tsx delegates to once Expo
// Router has already resolved the apexadvantage://auth-callback deep
// link's `code`/`type` params for it. This hook no longer watches
// Linking itself (see the TestFlight "Unmatched Route" bug this file
// was rewritten for) -- it's given code/type directly, exactly as the
// real route passes them.
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
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
import { useAuthCallback } from '../hooks/useAuthDeepLinks'

const EXPIRED_MESSAGE = 'That link has expired or was already used. Please request a new one.'
const WRONG_DEVICE_MESSAGE =
  'That link needs to be opened on the same device where you started creating your account or requesting a password reset. Please try again from this device.'

beforeEach(() => {
  mockReplace.mockReset()
  mockExchangeCodeForSession.mockReset()
  mockSetAuthCallbackError.mockReset()
})

it('exchanges a signup callback code and routes into the app', async () => {
  mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

  await renderHook(() => useAuthCallback('signup-code', 'signup'))

  await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledWith('signup-code'))
  expect(mockReplace).toHaveBeenCalledWith('/(app)')
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

it('exchanges a recovery callback code and routes to the reset-password screen, using the SDK’s own redirectType', async () => {
  mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null })

  await renderHook(() => useAuthCallback('recovery-code', 'recovery'))

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))
  expect(mockExchangeCodeForSession).toHaveBeenCalledWith('recovery-code')
  expect(mockSetAuthCallbackError).not.toHaveBeenCalled()
})

describe('redirectType is the authoritative signal, not the ?type= query param', () => {
  it('routes to reset-password when the SDK reports redirectType: "recovery", even if the URL said type=signup', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null })

    await renderHook(() => useAuthCallback('redirecttype-wins-code', 'signup'))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))
  })

  it('does NOT route to reset-password when the SDK reports a non-recovery redirectType, even if the URL said type=recovery', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'signup' }, error: null })

    await renderHook(() => useAuthCallback('redirecttype-non-recovery-code', 'recovery'))

    await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalled())
    expect(mockReplace).toHaveBeenCalledWith('/(app)')
  })

  it('falls back to the ?type= query param only when the SDK reports no redirectType at all', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

    await renderHook(() => useAuthCallback('redirecttype-fallback-code', 'recovery'))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/reset-password'))
  })
})

it('a missing code surfaces the expired-link message and returns to sign-in, without ever calling exchange', async () => {
  await renderHook(() => useAuthCallback(null, 'signup'))

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))
  expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  expect(mockSetAuthCallbackError).toHaveBeenCalledWith(EXPIRED_MESSAGE)
})

it('a failed code exchange (expired/already-used) surfaces the expired message and returns to sign-in', async () => {
  mockExchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid flow state' } })

  await renderHook(() => useAuthCallback('stale-code', 'recovery'))

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))
  expect(mockSetAuthCallbackError).toHaveBeenCalledWith(EXPIRED_MESSAGE)
})

it('a code-verifier-missing exchange failure (opened on a different device/app) surfaces a distinct, accurate message', async () => {
  mockExchangeCodeForSession.mockResolvedValue({
    error: { name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found', message: 'PKCE code verifier not found in storage.' },
  })

  await renderHook(() => useAuthCallback('verifier-missing-code', 'recovery'))

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))
  expect(mockSetAuthCallbackError).toHaveBeenCalledWith(WRONG_DEVICE_MESSAGE)
})

it('a thrown exchange error is handled the same way, never left uncaught', async () => {
  mockExchangeCodeForSession.mockRejectedValue(new Error('network down'))

  await renderHook(() => useAuthCallback('thrown-error-code', 'recovery'))

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))
  expect(mockSetAuthCallbackError).toHaveBeenCalledWith(EXPIRED_MESSAGE)
})

// The core "no duplicate PKCE exchange" requirement -- a code already
// attempted once (successfully or not) in this session must never be
// sent to exchangeCodeForSession a second time, module-level across
// mounts (not just within one), since the real route could in
// principle remount with the same params (e.g. a hot reload, or the OS
// redelivering the same URL).
describe('duplicate-code protection', () => {
  it('never re-exchanges the same code across two separate mounts', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

    const first = await renderHook(() => useAuthCallback('reused-code', 'signup'))
    await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1))
    await first.unmount()

    mockReplace.mockClear()
    mockSetAuthCallbackError.mockClear()

    await renderHook(() => useAuthCallback('reused-code', 'signup'))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'))
    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1) // still just the first attempt
    expect(mockSetAuthCallbackError).toHaveBeenCalledWith(EXPIRED_MESSAGE)
  })

  it('never re-exchanges the same code if the effect fires twice within one mount (e.g. Strict Mode double-invoke)', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null })

    const { rerender } = await renderHook(({ code, type }: { code: string; type: string }) => useAuthCallback(code, type), {
      initialProps: { code: 'one-shot-code', type: 'signup' },
    })
    await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1))

    // Same code/type re-supplied on a re-render -- handledRef must stop
    // a second attempt within this same mount.
    rerender({ code: 'one-shot-code', type: 'signup' })

    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1)
  })
})
