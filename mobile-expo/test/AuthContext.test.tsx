import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

const mockGetSession = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockSignOut = jest.fn()
const mockSignInWithPassword = jest.fn()
const mockStartAutoRefresh = jest.fn()
const mockStopAutoRefresh = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      startAutoRefresh: (...args: unknown[]) => mockStartAutoRefresh(...args),
      stopAutoRefresh: (...args: unknown[]) => mockStopAutoRefresh(...args),
    },
  },
}))

// Sprint 1C Phase 8: signOut() now reads pushRegistrationStorage (real
// AsyncStorage-backed, per activePracticeStorage.test.ts's own precedent
// for exercising genuine read/write behavior) and calls revokePushToken
// (mocked here so these tests control success/failure independently of
// the real mobile-push-token network call).
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockRevokePushToken = jest.fn()
jest.mock('../lib/api/pushToken', () => ({
  revokePushToken: (...args: unknown[]) => mockRevokePushToken(...args),
}))

import AsyncStorage from '@react-native-async-storage/async-storage'
import { savePushRegistration } from '../lib/pushRegistrationStorage'

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

const FAKE_SESSION = { access_token: 't', user: { id: 'u1', email: 'pilot@example.com' } } as any

describe('AuthContext', () => {
  beforeEach(() => {
    mockGetSession.mockReset()
    mockOnAuthStateChange.mockReset()
    mockSignOut.mockReset()
    mockSignInWithPassword.mockReset()
    mockStartAutoRefresh.mockReset()
    mockStopAutoRefresh.mockReset()
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } })
    ;(AppState.addEventListener as jest.Mock).mockReset()
    ;(AppState.addEventListener as jest.Mock).mockReturnValue({ remove: jest.fn() })
    AppState.currentState = 'active'
  })

  // A: a valid stored session restores.
  it('restores a valid stored session on launch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
    const { result } = await renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual(FAKE_SESSION)
    expect(result.current.user?.id).toBe('u1')
  })

  // B: no session -> the app has nothing to show as signed in.
  it('resolves to no session when none is stored', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    const { result } = await renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toBeNull()
  })

  // C: refresh_token_not_found triggers local cleanup exactly once.
  it('signs out locally exactly once on refresh_token_not_found', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', code: 'refresh_token_not_found', message: 'Refresh Token Not Found' },
    })
    mockSignOut.mockResolvedValue({ error: null })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(result.current.session).toBeNull()
  })

  // D: refresh_token_already_used triggers local cleanup exactly once.
  it('signs out locally exactly once on refresh_token_already_used', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', code: 'refresh_token_already_used', message: 'Already Used' },
    })
    mockSignOut.mockResolvedValue({ error: null })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  // E: a transient/network error must never destroy a potentially-valid
  // stored session -- the session getSession() returned alongside the
  // error is still used.
  it('does not sign out or discard the session on a transient/network error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: FAKE_SESSION },
      error: { name: 'AuthRetryableFetchError', message: 'Network request failed' },
    })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(result.current.session).toEqual(FAKE_SESSION)
  })

  // F: successful sign in.
  it('signIn succeeds and reports ok:true', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    mockSignInWithPassword.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let signInResult
    await act(async () => {
      signInResult = await result.current.signIn('pilot@example.com', 'correct-password')
    })
    expect(signInResult).toEqual({ ok: true })
  })

  it('signIn surfaces a safe message on invalid credentials, never the raw Supabase error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    mockSignInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let signInResult
    await act(async () => {
      signInResult = await result.current.signIn('pilot@example.com', 'wrong')
    })
    expect(signInResult).toEqual({ ok: false, message: 'That email or password is incorrect.' })
  })

  // G: sign out clears the session.
  it('signOut clears the session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
    mockSignOut.mockResolvedValue({ error: null })

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.session).toBeNull()
  })

  // Sprint 1C Phase 8: revocation must be attempted BEFORE the auth
  // session is destroyed (revoke_mobile_device() requires auth), scoped
  // to exactly the signed-in user's own stored device, and must never
  // block or corrupt sign-out if it fails or there's nothing to revoke.
  describe('signOut push-registration revocation (Phase 8)', () => {
    beforeEach(async () => {
      mockRevokePushToken.mockReset()
      await AsyncStorage.clear()
    })

    it('revokes the current device before destroying the auth session', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })
      mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1' } })
      await savePushRegistration({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })

      const callOrder: string[] = []
      mockRevokePushToken.mockImplementation(async (...args: unknown[]) => {
        callOrder.push('revoke')
        return { device: { id: args[0] } }
      })
      mockSignOut.mockImplementation(async () => {
        callOrder.push('auth-sign-out')
        return { error: null }
      })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockRevokePushToken).toHaveBeenCalledWith('device-1')
      expect(callOrder).toEqual(['revoke', 'auth-sign-out'])
      expect(result.current.session).toBeNull()
    })

    it('only revokes the signed-in user’s own device, ignoring a different user’s stored registration', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })
      await savePushRegistration({ userId: 'some-other-user', deviceId: 'device-not-mine', expoPushToken: 'ExponentPushToken[other]', platform: 'android' })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockRevokePushToken).not.toHaveBeenCalled()
      expect(result.current.session).toBeNull()
    })

    it('missing local device metadata is handled -- sign-out still completes with no revoke call', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockRevokePushToken).not.toHaveBeenCalled()
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(result.current.session).toBeNull()
    })

    it('a revoke failure does not corrupt auth state or block sign-out', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })
      mockRevokePushToken.mockRejectedValue(new Error('network down'))
      await savePushRegistration({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockRevokePushToken).toHaveBeenCalledWith('device-1')
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(result.current.session).toBeNull()
    })
  })

  // Rev2 section 6: an unexpected thrown/rejected getSession() (not a
  // returned {error}, an actual exception) must be dev-logged only --
  // never routed into stale-token cleanup, never a destructive sign-out.
  it('does not sign out when getSession() unexpectedly rejects during initialization', async () => {
    mockGetSession.mockRejectedValue(new Error('secure storage read failed'))

    const { result } = await renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(result.current.session).toBeNull()
  })

  // Rev2 section 6: AppState-driven auto-refresh lifecycle.
  describe('AppState-driven auto-refresh', () => {
    it('starts auto-refresh when the app is active on mount', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      AppState.currentState = 'active'

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(mockStartAutoRefresh).toHaveBeenCalled()
      expect(mockStopAutoRefresh).not.toHaveBeenCalled()
    })

    it('stops auto-refresh when the app is backgrounded, and restarts it when active again', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      AppState.currentState = 'active'

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))
      mockStartAutoRefresh.mockClear()

      const addEventListenerMock = AppState.addEventListener as jest.Mock
      const handler = addEventListenerMock.mock.calls[0][1] as (state: string) => void

      await act(async () => {
        handler('background')
      })
      expect(mockStopAutoRefresh).toHaveBeenCalledTimes(1)

      await act(async () => {
        handler('active')
      })
      expect(mockStartAutoRefresh).toHaveBeenCalledTimes(1)
    })

    it('removes the AppState listener on unmount', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      const removeMock = jest.fn()
      ;(AppState.addEventListener as jest.Mock).mockReturnValue({ remove: removeMock })

      const { result, unmount } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      await unmount()
      expect(removeMock).toHaveBeenCalledTimes(1)
    })
  })
})
