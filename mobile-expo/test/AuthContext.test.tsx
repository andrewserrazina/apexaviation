import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

const mockGetSession = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockSignOut = jest.fn()
const mockSignInWithPassword = jest.fn()
const mockSignUp = jest.fn()
const mockResend = jest.fn()
const mockResetPasswordForEmail = jest.fn()
const mockUpdateUser = jest.fn()
const mockStartAutoRefresh = jest.fn()
const mockStopAutoRefresh = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      resend: (...args: unknown[]) => mockResend(...args),
      resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
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
import { beginRegistrationMutation, releaseUserGate } from '../lib/notifications/pushMutationCoordinator'

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
    mockSignUp.mockReset()
    mockResend.mockReset()
    mockResetPasswordForEmail.mockReset()
    mockUpdateUser.mockReset()
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

  describe('signUp', () => {
    it('succeeds and reports needsVerification when no session comes back ("Confirm email" is ON)', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{ id: 'identity-1' }] }, session: null }, error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('new@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: true, needsVerification: true })
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'abc123',
        options: { emailRedirectTo: 'https://apexaviationtx.com/mobile-auth-redirect.html?type=signup' },
      })
    })

    it('succeeds and reports no verification needed when a session comes back immediately ("Confirm email" is OFF)', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{ id: 'identity-1' }] }, session: FAKE_SESSION }, error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('new@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: true, needsVerification: false })
    })

    it('surfaces a safe, non-enumerating message when the error shape signals an existing account', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'user_already_exists', message: 'User already registered' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('existing@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: false, message: 'An account with this email already exists. Try signing in instead.' })
    })

    it('surfaces the same safe existing-account message via the empty-identities success shape', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('existing@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: false, message: 'An account with this email already exists. Try signing in instead.' })
    })

    it('surfaces Supabase’s own weak-password message as-is', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Password should be at least 6 characters.' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('new@example.com', 'ab')
      })
      expect(signUpResult).toEqual({ ok: false, message: 'Password should be at least 6 characters.' })
    })

    it('surfaces a generic message for an unrelated returned error, never the raw text', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'relation "auth.users" does not exist' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('new@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: false, message: 'We couldn’t create your account. Check your connection and try again.' })
    })

    // Matches signIn's own established convention for modeling a network
    // failure (see "does not sign out or discard the session on a
    // transient/network error" above) -- supabase-js's auth methods
    // never throw for a connectivity failure, they resolve with an
    // AuthRetryableFetchError.
    it('surfaces the same generic, safe message on a network failure', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { name: 'AuthRetryableFetchError', message: 'Network request failed' },
      })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let signUpResult
      await act(async () => {
        signUpResult = await result.current.signUp('new@example.com', 'abc123')
      })
      expect(signUpResult).toEqual({ ok: false, message: 'We couldn’t create your account. Check your connection and try again.' })
    })
  })

  describe('resendVerificationEmail', () => {
    it('reports ok:true on success', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockResend.mockResolvedValue({ error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let resendResult
      await act(async () => {
        resendResult = await result.current.resendVerificationEmail('new@example.com')
      })
      expect(resendResult).toEqual({ ok: true })
      expect(mockResend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'new@example.com',
        options: { emailRedirectTo: 'https://apexaviationtx.com/mobile-auth-redirect.html?type=signup' },
      })
    })

    it('surfaces a friendly cooldown message on rate limiting', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockResend.mockResolvedValue({ error: { status: 429, message: 'For security purposes, you can only request this after 42 seconds.' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let resendResult
      await act(async () => {
        resendResult = await result.current.resendVerificationEmail('new@example.com')
      })
      expect(resendResult).toEqual({ ok: false, message: 'Please wait a bit before requesting another email.' })
    })
  })

  describe('requestPasswordReset', () => {
    it('reports ok:true regardless of whether the email has an account (never reveals existence)', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockResetPasswordForEmail.mockResolvedValue({ error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let resetResult
      await act(async () => {
        resetResult = await result.current.requestPasswordReset('whoever@example.com')
      })
      expect(resetResult).toEqual({ ok: true })
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('whoever@example.com', {
        redirectTo: 'https://apexaviationtx.com/mobile-auth-redirect.html?type=recovery',
      })
    })

    it('still reports ok:true when the request throws outright (never a distinguishable response shape)', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockResetPasswordForEmail.mockRejectedValue(new Error('Network request failed'))

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let resetResult
      await act(async () => {
        resetResult = await result.current.requestPasswordReset('whoever@example.com')
      })
      expect(resetResult).toEqual({ ok: true })
    })

    it('surfaces a friendly cooldown message on rate limiting -- the one response shape allowed to differ', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockResetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'For security purposes, you can only request this after 42 seconds.' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      let resetResult
      await act(async () => {
        resetResult = await result.current.requestPasswordReset('whoever@example.com')
      })
      expect(resetResult).toEqual({ ok: false, message: 'Please wait a bit before requesting another reset email.' })
    })
  })

  describe('password recovery session handling', () => {
    it('isPasswordRecovery becomes true when a PASSWORD_RECOVERY auth event fires', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.isPasswordRecovery).toBe(false)

      const onAuthStateChangeCallback = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
      await act(async () => {
        onAuthStateChangeCallback('PASSWORD_RECOVERY', FAKE_SESSION)
      })

      expect(result.current.isPasswordRecovery).toBe(true)
      expect(result.current.session).toEqual(FAKE_SESSION)
    })

    it('updatePassword succeeds and clears isPasswordRecovery', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockUpdateUser.mockResolvedValue({ error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const onAuthStateChangeCallback = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
      await act(async () => {
        onAuthStateChangeCallback('PASSWORD_RECOVERY', FAKE_SESSION)
      })
      expect(result.current.isPasswordRecovery).toBe(true)

      let updateResult
      await act(async () => {
        updateResult = await result.current.updatePassword('new-strong-password')
      })
      expect(updateResult).toEqual({ ok: true })
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'new-strong-password' })
      expect(result.current.isPasswordRecovery).toBe(false)
    })

    it('updatePassword surfaces Supabase’s own weak-password message and leaves isPasswordRecovery true', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockUpdateUser.mockResolvedValue({ error: { message: 'Password should be at least 6 characters.' } })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const onAuthStateChangeCallback = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
      await act(async () => {
        onAuthStateChangeCallback('PASSWORD_RECOVERY', FAKE_SESSION)
      })

      let updateResult
      await act(async () => {
        updateResult = await result.current.updatePassword('ab')
      })
      expect(updateResult).toEqual({ ok: false, message: 'Password should be at least 6 characters.' })
      expect(result.current.isPasswordRecovery).toBe(true)
    })

    it('clearPasswordRecovery signs out locally and clears both session and isPasswordRecovery', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
      mockSignOut.mockResolvedValue({ error: null })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const onAuthStateChangeCallback = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
      await act(async () => {
        onAuthStateChangeCallback('PASSWORD_RECOVERY', FAKE_SESSION)
      })
      expect(result.current.isPasswordRecovery).toBe(true)

      await act(async () => {
        await result.current.clearPasswordRecovery()
      })

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' })
      expect(result.current.isPasswordRecovery).toBe(false)
      expect(result.current.session).toBeNull()
    })
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

      expect(mockRevokePushToken).toHaveBeenCalledWith('device-1', 'u1')
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

      expect(mockRevokePushToken).toHaveBeenCalledWith('device-1', 'u1')
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(result.current.session).toBeNull()
    })
  })

  // Sprint 1C Rev4 (independent review -- sign-out invariant): sign-out
  // must structurally WAIT for an already-in-flight registration to
  // finish (not merely rely on token pinning or a disabled button) before
  // it decides which device row is "final" and revokes it. These tests
  // drive the coordinator directly to simulate the registration side
  // (usePushRegistration.registerDevice's own real usage is exercised in
  // usePushRegistration.test.tsx), since AuthContext's job is only to
  // coordinate with it correctly.
  describe('signOut coordination with an in-flight registration (Rev4)', () => {
    beforeEach(async () => {
      mockRevokePushToken.mockReset()
      await AsyncStorage.clear()
      releaseUserGate('u1')
    })

    // Test A: registration entered its critical section first.
    it('signOut waits for an already-in-flight registration critical section, then revokes the FINAL device id -- never the reverse order', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      await savePushRegistration({ userId: 'u1', deviceId: 'device-OLD', expoPushToken: 'tok-old', platform: 'ios' })

      // Simulates registerDevice() having already entered its critical
      // section (past OS permission + token acquisition) before signOut
      // is pressed.
      const release = beginRegistrationMutation('u1')
      expect(release).not.toBeNull()

      const callOrder: string[] = []
      mockRevokePushToken.mockImplementation(async (deviceId: string) => {
        callOrder.push(`revoke:${deviceId}`)
        return { device: { id: deviceId } }
      })
      mockSignOut.mockImplementation(async () => {
        callOrder.push('auth-sign-out')
        return { error: null }
      })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      const signOutPromise = result.current.signOut()

      // signOut has started and is now waiting on the coordinator --
      // give the microtask queue every chance to let it proceed early.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(mockRevokePushToken).not.toHaveBeenCalled()
      expect(mockSignOut).not.toHaveBeenCalled()

      // The "registration" now finishes: it saves the FINAL local
      // pointer, THEN releases its critical section -- exactly the order
      // registerDevice() itself follows.
      await savePushRegistration({ userId: 'u1', deviceId: 'device-NEW', expoPushToken: 'tok-new', platform: 'ios' })
      release!()

      await act(async () => {
        await signOutPromise
      })

      // The final server-intent sequence is register -> revoke -> auth
      // signOut -- NEVER revoke -> auth signOut -> register. Revoking
      // device-NEW (not the stale device-OLD) IS that proof: it can only
      // have read device-NEW after this "registration" finished.
      expect(mockRevokePushToken).toHaveBeenCalledWith('device-NEW', 'u1')
      expect(callOrder).toEqual(['revoke:device-NEW', 'auth-sign-out'])
      expect(result.current.session).toBeNull()
    })

    // Test B: sign-out's closing gate starts first.
    it('once signOut has begun, a new registration attempt for that user aborts immediately with zero mutation', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })
      mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1' } })
      await savePushRegistration({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      const signOutPromise = result.current.signOut()

      // closeUserForSignOut() marks the gate closing SYNCHRONOUSLY as its
      // very first action -- by the time control returns here, a
      // registration attempting to enter must already be rejected.
      const release = beginRegistrationMutation('u1')
      expect(release).toBeNull()

      await act(async () => {
        await signOutPromise
      })
    })

    // Test D (partial -- the revoke-failure half; registerDevice's own
    // release-on-failure is covered in usePushRegistration.test.tsx): a
    // failed revoke must never prevent auth sign-out, and the gate must
    // still be released so the same user can sign back in cleanly.
    it('releases the coordinator gate even when the push cleanup fails, so the same user can sign back in with an open gate', async () => {
      mockGetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null })
      mockSignOut.mockResolvedValue({ error: null })
      mockRevokePushToken.mockRejectedValue(new Error('network down'))
      await savePushRegistration({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })

      const { result } = await renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.session).toEqual(FAKE_SESSION))

      await act(async () => {
        await result.current.signOut()
      })

      expect(result.current.session).toBeNull()
      // The gate is open again -- proof releaseUserGate() ran despite
      // the revoke failure above.
      const release = beginRegistrationMutation('u1')
      expect(release).not.toBeNull()
      release!()
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
