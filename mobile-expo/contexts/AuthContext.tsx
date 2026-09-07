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
import { revokePushToken } from '../lib/api/pushToken'
import { clearPushRegistration, loadPushRegistration } from '../lib/pushRegistrationStorage'

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

  // Sprint 1C Phase 8: best-effort push-registration revocation BEFORE
  // the Supabase session is destroyed -- revoke_mobile_device() (v116)
  // requires auth (see mobile-push-token/index.ts), so this must run
  // while `session` is still valid, never after.
  //
  // `userId` is read from the CURRENT render's `session` closure before
  // anything below awaits, so this can never revoke a device belonging
  // to a user other than the one actually signing out, even if signOut()
  // itself is somehow invoked again before this one settles.
  //
  // Failure handling: any failure here (offline, revoke_mobile_device()
  // erroring, a missing local device record) is caught and logged, never
  // rethrown -- sign-out must always complete and must never leave the
  // learner stuck unable to sign out because a network call failed. The
  // local pointer is cleared regardless of whether the server-side revoke
  // itself succeeded, so this app installation never again reports
  // itself as "registered" for a device the server may or may not have
  // actually revoked.
  //
  // Future stop gate (documented here, not implemented by this Sprint):
  // this app does not yet send server-initiated push notifications, and
  // this best-effort sign-out revocation is NOT a complete guarantee
  // against every stale-token scenario -- mobile_devices' unique
  // (profile_id, expo_push_token) constraint means a shared physical
  // device where a second account signs in after this one signs out
  // could, in principle, still be reasoned about incorrectly by a naive
  // future sender if this revocation failed offline. Before any future
  // system that actually sends push from the server is turned on, that
  // cross-account/shared-device token-ownership question must be
  // explicitly re-reviewed -- see the Sprint 1C report.
  async function signOut() {
    const userId = session?.user.id ?? null
    if (userId) {
      try {
        const stored = await loadPushRegistration(userId)
        if (stored) {
          try {
            await revokePushToken(stored.deviceId)
          } catch (err) {
            logDevError('AuthContext.signOut.revokePushToken', err)
          }
        }
        await clearPushRegistration(userId)
      } catch (err) {
        logDevError('AuthContext.signOut.pushRevocation', err)
      }
    }

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
