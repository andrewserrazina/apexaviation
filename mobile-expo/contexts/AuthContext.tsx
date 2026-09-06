// Apex Advantage mobile client -- auth/session context.
//
// Mirrors portal/src/context/AuthContext.jsx's Phase 9B stale-token
// semantics exactly (see this file's own authErrors.ts twin): a
// genuinely dead refresh token (refresh_token_not_found /
// refresh_token_already_used) triggers a LOCAL-ONLY sign-out so the
// learner lands on a normal signed-out screen. Any other error from
// getSession() -- a network hiccup, a momentary Auth outage -- is never
// treated as a reason to destroy a potentially still-valid stored
// session; this app falls through and uses whatever session
// getSession() did return alongside that non-fatal error.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isStaleRefreshTokenError } from '../lib/authErrors'
import { logDevError } from '../lib/api/errors'

export type AuthSignInResult =
  | { ok: true }
  | { ok: false; message: string }

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthSignInResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Guards against the stale-token cleanup path running more than once if
  // both the initial getSession() call and a subsequent auth event
  // somehow observe the same dead token in quick succession.
  const staleCleanupInFlight = useRef(false)

  async function handleStaleSession() {
    if (staleCleanupInFlight.current) return
    staleCleanupInFlight.current = true
    try {
      // scope: 'local' -- never touches this learner's session on any
      // other device, only this app installation's own stored tokens.
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // Best-effort: local state is cleared below regardless of whether
      // this network call itself succeeds.
    } finally {
      setSession(null)
      staleCleanupInFlight.current = false
    }
  }

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error && isStaleRefreshTokenError(error)) {
          if (!cancelled) await handleStaleSession()
          return
        }

        if (cancelled) return
        // Any other error (network hiccup, transient Auth outage) is NOT
        // treated as stale -- fall through and use whatever session
        // getSession() returned, which may still be valid.
        setSession(data.session ?? null)
      } catch (err) {
        // A genuinely thrown/rejected getSession() (e.g. a secure-storage
        // read failure) is unexpected, but it is still not evidence of a
        // stale/invalid refresh token -- never route it into
        // handleStaleSession()/destructive local sign-out. Dev-log it and
        // resolve loading so the app can proceed with whatever `session`
        // state already holds (Sprint 1A Rev2 section 6).
        if (!cancelled) logDevError('AuthContext.initialize', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialize()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  // Official Supabase React Native guidance: auto-refresh must be driven
  // by app foreground/background state, or a backgrounded app can burn
  // through refresh attempts (or fail to refresh in time) once returned
  // to foreground. Synchronizes the initial AppState immediately, then
  // starts/stops on every subsequent transition. Never touches stale-
  // token handling or triggers a sign-out of any kind.
  useEffect(() => {
    function syncAutoRefresh(state: AppStateStatus) {
      if (state === 'active') {
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    }

    syncAutoRefresh(AppState.currentState)
    const subscription = AppState.addEventListener('change', syncAutoRefresh)

    return () => {
      subscription.remove()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<AuthSignInResult> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Never surface a raw Supabase/Postgres error string to a learner.
      if (error.message?.toLowerCase().includes('invalid login credentials')) {
        return { ok: false, message: 'That email or password is incorrect.' }
      }
      return { ok: false, message: 'We couldn’t sign you in. Check your connection and try again.' }
    }
    return { ok: true }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
