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
})
