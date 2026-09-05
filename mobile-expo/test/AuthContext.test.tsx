import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

const mockGetSession = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockSignOut = jest.fn()
const mockSignInWithPassword = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
    },
  },
}))

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
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } })
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
})
