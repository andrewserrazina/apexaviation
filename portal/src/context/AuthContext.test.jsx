import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

// Mirrors the shape supabase-js actually returns from auth.onAuthStateChange:
// { data: { subscription: { unsubscribe } } }, plus a way for each test to
// fire an auth-state event as the real client would (a signed-in listener,
// a SIGNED_OUT after a real signOut, etc.).
let authStateCallback = null
const unsubscribeMock = vi.fn()

const getSessionMock = vi.fn()
const signOutMock = vi.fn()
const signInWithPasswordMock = vi.fn()
const singleMock = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args) => getSessionMock(...args),
      onAuthStateChange: (cb) => {
        authStateCallback = cb
        return { data: { subscription: { unsubscribe: unsubscribeMock } } }
      },
      signOut: (...args) => signOutMock(...args),
      signInWithPassword: (...args) => signInWithPasswordMock(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: (...args) => singleMock(...args),
        }),
      }),
    }),
  },
}))

function TestConsumer() {
  const { user, profile, loading } = useAuth()
  return (
    <div data-testid="state">
      {JSON.stringify({ userId: user?.id ?? null, profileId: profile?.id ?? null, loading })}
    </div>
  )
}

function readState() {
  return JSON.parse(screen.getByTestId('state').textContent)
}

beforeEach(() => {
  // Unmount any still-mounted component from the previous test FIRST -- its
  // cleanup fires subscription.unsubscribe(), which must not count against
  // this test's own assertions on unsubscribeMock's call count.
  cleanup()
  authStateCallback = null
  unsubscribeMock.mockClear()
  getSessionMock.mockReset()
  signOutMock.mockReset()
  signInWithPasswordMock.mockReset()
  singleMock.mockReset()
})

describe('AuthContext initialization', () => {
  it('A: a valid persisted session hydrates normally, loading resolves, no signOut is called', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
    singleMock.mockResolvedValue({ data: { id: 'user-1', full_name: 'Test Member' } })

    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().userId).toBe('user-1')
    expect(readState().profileId).toBe('user-1')
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('B: no stored session resolves to session null, loading resolves, no error loop', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })

    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().userId).toBe(null)
    expect(signOutMock).not.toHaveBeenCalled()
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('C: refresh_token_not_found triggers exactly one local-scope recovery, resolves to a clean signed-out state, no raw error surfaced, no retry loop', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    })
    signOutMock.mockResolvedValue({ error: null })

    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().userId).toBe(null)
    expect(readState().profileId).toBe(null)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
    // No repeated refresh/signOut loop: getSession is only ever called once
    // during initialization (this test's render mounts the provider once).
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('D: a successful password login after stale-session recovery updates the session normally', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    })
    signOutMock.mockResolvedValue({ error: null })
    singleMock.mockResolvedValue({ data: { id: 'user-2', full_name: 'Recovered Member' } })

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().userId).toBe(null)

    // Simulate the real client firing SIGNED_IN after a fresh password login.
    await act(async () => {
      authStateCallback('SIGNED_IN', { user: { id: 'user-2' } })
    })

    await waitFor(() => expect(readState().userId).toBe('user-2'))
    expect(readState().profileId).toBe('user-2')
  })

  it('E: a generic network/transient getSession error is not classified as a stale refresh token; local signOut is not invoked', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    })

    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await waitFor(() => expect(readState().loading).toBe(false))
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('F: normal SIGNED_IN / SIGNED_OUT auth-state events update AuthContext correctly', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    singleMock.mockResolvedValue({ data: { id: 'user-3', full_name: 'Signed In Member' } })

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().userId).toBe(null)

    await act(async () => {
      authStateCallback('SIGNED_IN', { user: { id: 'user-3' } })
    })
    await waitFor(() => expect(readState().userId).toBe('user-3'))

    await act(async () => {
      authStateCallback('SIGNED_OUT', null)
    })
    await waitFor(() => expect(readState().userId).toBe(null))
    expect(readState().profileId).toBe(null)
  })

  it('G: unmounting the provider cleans up the auth-state subscription', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })

    const { unmount } = render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(readState().loading).toBe(false))

    expect(unsubscribeMock).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  // Bug sweep: onAuthStateChange's SIGNED_IN branch used to leave `loading`
  // at whatever it already was (false, once the initial mount resolves)
  // while fetchProfile() was still in flight -- a consumer reading `profile`
  // in that window saw stale/null data under a "not loading" flag. E.g.
  // PortalSelector.jsx defaults an admin's role to 'student' and bounces
  // them out of the app when `profile` is still null right after sign-in.
  it('H: loading stays true for the whole SIGNED_IN -> profile-fetch window, not just the initial mount', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    let resolveSingle
    singleMock.mockImplementation(() => new Promise((resolve) => { resolveSingle = resolve }))

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(readState().loading).toBe(false))

    await act(async () => {
      authStateCallback('SIGNED_IN', { user: { id: 'user-4' } })
    })
    // The profile fetch is still pending -- loading must already be back to
    // true, and the old (wrong) profile/role state must not be readable yet.
    expect(readState().loading).toBe(true)
    expect(readState().profileId).toBe(null)

    await act(async () => {
      resolveSingle({ data: { id: 'user-4', role: 'admin' } })
    })
    await waitFor(() => expect(readState().loading).toBe(false))
    expect(readState().profileId).toBe('user-4')
  })

  // Bug sweep: fetchProfile() had no ordering guard, so whichever of two
  // in-flight requests resolved last won, regardless of which corresponds
  // to the current user -- e.g. a sign-out/sign-in on a shared device, or
  // Students.jsx's admin signUp()/setSession() session-swap flow.
  it('I: an out-of-order (slower) profile response for a superseded user is discarded', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    let resolveFirst
    let resolveSecond
    singleMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(readState().loading).toBe(false))

    await act(async () => {
      authStateCallback('SIGNED_IN', { user: { id: 'user-old' } })
    })
    await act(async () => {
      authStateCallback('SIGNED_IN', { user: { id: 'user-new' } })
    })

    // The newer request's response arrives first; the older, now-stale
    // request resolves after it and must not be allowed to overwrite it.
    await act(async () => {
      resolveSecond({ data: { id: 'user-new', role: 'student' } })
    })
    await waitFor(() => expect(readState().profileId).toBe('user-new'))

    await act(async () => {
      resolveFirst({ data: { id: 'user-old', role: 'admin' } })
    })
    expect(readState().profileId).toBe('user-new')
    expect(readState().loading).toBe(false)
  })
})
