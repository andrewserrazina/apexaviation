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
import { isStaleRefreshTokenError, isExistingAccountError, isRateLimitError } from '../lib/authErrors'
import { logDevError } from '../lib/api/errors'
import { revokePushToken } from '../lib/api/pushToken'
import { clearPushRegistration, loadPushRegistration } from '../lib/pushRegistrationStorage'
import { closeUserForSignOut, releaseUserGate } from '../lib/notifications/pushMutationCoordinator'

export type AuthSignInResult =
  | { ok: true }
  | { ok: false; message: string }

export type AuthSignUpResult =
  | { ok: true; needsVerification: boolean }
  | { ok: false; message: string }

export type AuthActionResult =
  | { ok: true }
  | { ok: false; message: string }

// Every email-action link (verification, recovery) redirects here first
// -- a plain web page (site/mobile-auth-redirect.html), NOT the
// apexadvantage:// custom scheme directly. That's deliberate: a custom
// scheme with no app installed just fails silently in Mail/Safari with
// no way to show the learner anything, which is exactly the "reasonable
// fallback when a user opens the link outside the app" this Sprint's own
// requirements call for. The web page immediately forwards into
// apexadvantage://auth-callback (see useAuthDeepLinks.ts) when the app
// IS installed, and shows a real fallback message otherwise. `type`
// distinguishes signup vs. recovery all the way through both hops. A
// single base path (rather than one per action) also keeps the Supabase
// Redirect URLs allowlist (dashboard config, documented in this Sprint's
// report) to exactly one new entry.
export const AUTH_CALLBACK_URL_BASE = 'https://apexaviationtx.com/mobile-auth-redirect.html'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  // True once a PASSWORD_RECOVERY auth event has been observed (the
  // learner followed a valid "reset your password" link) and still true
  // until updatePassword() succeeds or clearPasswordRecovery() is called.
  // (auth)/_layout.tsx reads this to avoid redirecting a recovery session
  // straight into the app before a new password is actually set --
  // without it, the mere existence of a session during password recovery
  // would otherwise look identical to a normal signed-in session.
  isPasswordRecovery: boolean
  // Set by useAuthDeepLinks when a verification/recovery link turns out
  // to be expired, already used, or otherwise invalid. Surfaced once on
  // the sign-in screen, then cleared -- see that screen's own effect.
  authCallbackError: string | null
  setAuthCallbackError: (message: string | null) => void
  signIn: (email: string, password: string) => Promise<AuthSignInResult>
  signUp: (email: string, password: string) => Promise<AuthSignUpResult>
  resendVerificationEmail: (email: string) => Promise<AuthActionResult>
  requestPasswordReset: (email: string) => Promise<AuthActionResult>
  updatePassword: (newPassword: string) => Promise<AuthActionResult>
  clearPasswordRecovery: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null)
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
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return
      // Fired exactly once a recovery-type session is established --
      // whether that came from exchangeCodeForSession() handling a
      // "reset your password" deep link (useAuthDeepLinks.ts) or, in
      // principle, any other path that establishes one. See
      // isPasswordRecovery's own doc comment on AuthContextValue for why
      // this must be tracked separately from `session` itself.
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
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

  // Creates the account directly via the client-side Auth API -- unlike
  // the web portal's free-signup form, which calls a server-side
  // create-free-account Edge Function that provisions a password-less
  // account and emails a "set your password" link (site/portal-login.html,
  // portal/supabase/functions/create-free-account/index.ts). That flow
  // exists for web's own reasons (a visitor can start as a lead from a
  // guide/landing page before ever choosing a password) and is NOT
  // reused here on purpose: Apple's Guideline 2.1 note is exactly that
  // this app has no way to create and start using an account without
  // leaving it, and a review team needs to finish registration inside
  // the app in one step. signUp() still inserts into the same auth.users
  // table and fires the same handle_new_user() trigger (portal/
  // supabase-schema.sql) that create-free-account's admin.createUser()
  // call does -- the resulting `profiles` row (role: 'student',
  // checkride_prep_unlocked: false by default -- supabase-portal-schema-
  // v4.sql) is identical either way. This is a second, equally valid way
  // to create a row in the SAME table via the SAME trigger, not a
  // parallel/duplicate auth system.
  async function signUp(email: string, password: string): Promise<AuthSignUpResult> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${AUTH_CALLBACK_URL_BASE}?type=signup` },
    })

    if (error) {
      if (isExistingAccountError(error)) {
        // Matches the web portal's own, already-shipped convention of
        // telling a visitor directly (site/portal-login.html) -- see
        // isExistingAccountError's own comment for why this isn't a new
        // enumeration risk.
        return { ok: false, message: 'An account with this email already exists. Try signing in instead.' }
      }
      // Supabase's own password-policy rejection message (e.g. "Password
      // should be at least 6 characters.") is already learner-safe and
      // more specific than a generic fallback -- surfaced as-is rather
      // than replaced. Any other error (network, 5xx, unexpected shape)
      // falls through to the generic message, never the raw error text.
      if (error.message?.toLowerCase().includes('password')) {
        return { ok: false, message: error.message }
      }
      logDevError('AuthContext.signUp', error)
      return { ok: false, message: 'We couldn’t create your account. Check your connection and try again.' }
    }

    // The OTHER documented shape Supabase uses to signal "this email
    // already belongs to a confirmed account," distinct from the `error`
    // case above: signUp() itself succeeds (no error) but returns an
    // empty `identities` array instead of the normal one -- GoTrue does
    // this specifically so a signup attempt can't be used to probe which
    // emails are already registered via response timing/shape, while
    // still letting a genuine duplicate learner be told plainly (same
    // messaging as the error-shaped case, matching web's convention).
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { ok: false, message: 'An account with this email already exists. Try signing in instead.' }
    }

    // A session came back immediately only when this Supabase project
    // has "Confirm email" turned OFF -- the (auth) layout's existing
    // session-redirect already takes the learner into (app) from here
    // with no further action needed; the caller only needs to know
    // whether to show the Check Your Email screen instead.
    return { ok: true, needsVerification: !data.session }
  }

  async function resendVerificationEmail(email: string): Promise<AuthActionResult> {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${AUTH_CALLBACK_URL_BASE}?type=signup` },
    })
    if (error) {
      if (isRateLimitError(error)) {
        return { ok: false, message: 'Please wait a bit before requesting another email.' }
      }
      logDevError('AuthContext.resendVerificationEmail', error)
      return { ok: false, message: 'We couldn’t resend that email. Check your connection and try again.' }
    }
    return { ok: true }
  }

  // Deliberately returns { ok: true } for almost everything -- Supabase's
  // own resetPasswordForEmail() never reveals whether the given email
  // actually has an account (it responds the same way either way), and
  // this must not either (Delivery requirement: never expose whether an
  // email exists in the system). A rate-limit response is the one
  // exception surfaced distinctly: it still reveals nothing about this
  // specific email (GoTrue rate-limits by IP/action, not by whether the
  // address is real), so showing a "please wait" message instead of the
  // normal success copy is safe.
  async function requestPasswordReset(email: string): Promise<AuthActionResult> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${AUTH_CALLBACK_URL_BASE}?type=recovery`,
      })
      if (error && isRateLimitError(error)) {
        return { ok: false, message: 'Please wait a bit before requesting another reset email.' }
      }
      if (error) logDevError('AuthContext.requestPasswordReset', error)
    } catch (err) {
      // A thrown/rejected call (offline, DNS failure) never reached
      // Supabase at all -- still never distinguishable from "that email
      // doesn't exist" to the learner, so this is dev-logged only, not
      // surfaced as a different-shaped response.
      logDevError('AuthContext.requestPasswordReset', err)
    }
    return { ok: true }
  }

  async function updatePassword(newPassword: string): Promise<AuthActionResult> {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      if (error.message?.toLowerCase().includes('password')) {
        return { ok: false, message: error.message }
      }
      logDevError('AuthContext.updatePassword', error)
      return { ok: false, message: 'We couldn’t update your password. Please try again.' }
    }
    setIsPasswordRecovery(false)
    return { ok: true }
  }

  // Safety valve for the Reset Password screen's Cancel action: a
  // recovery session is a real, active Supabase session (just one this
  // app treats specially -- see isPasswordRecovery's doc comment), so
  // abandoning it without signing it out would otherwise leave the
  // device signed in as that learner despite never actually setting a
  // new password. scope: 'local' matches handleStaleSession's own
  // reasoning above -- never touches any other device's session.
  async function clearPasswordRecovery(): Promise<void> {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (err) {
      logDevError('AuthContext.clearPasswordRecovery', err)
    } finally {
      setIsPasswordRecovery(false)
      setSession(null)
    }
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
  // Rev4 (independent review -- sign-out invariant): a Supabase access
  // token captured before sign-out began can remain valid at the server
  // for the rest of its natural JWT lifetime, so token pinning ALONE
  // cannot stop a registerDevice() call already in flight for this user
  // from completing and upserting an ACTIVE mobile_devices row strictly
  // AFTER this function has already read/revoked whatever row it knew
  // about. `closeUserForSignOut()` closes this user's push-mutation gate
  // to new registration attempts (they abort with zero server mutation --
  // see usePushRegistration.registerDevice/pushMutationCoordinator.ts),
  // then WAITS for any registration that had already entered its
  // critical section to finish -- including saving its local pointer --
  // before the read below ever runs. That is what guarantees `stored`
  // here is genuinely the FINAL registration for this user, not a
  // snapshot that a still-in-flight registration is about to supersede.
  // This ordering is why closeUserForSignOut() must be awaited BEFORE
  // loadPushRegistration(), not merely before supabase.auth.signOut().
  //
  // Failure handling: any failure here (offline, revoke_mobile_device()
  // erroring, a missing local device record) is caught and logged, never
  // rethrown -- sign-out must always complete and must never leave the
  // learner stuck unable to sign out because a network call failed. The
  // local pointer is cleared regardless of whether the server-side revoke
  // itself succeeded, so this app installation never again reports
  // itself as "registered" for a device the server may or may not have
  // actually revoked. `releaseUserGate()` always runs (even on failure)
  // so this same user id starts with a fresh, open gate the next time
  // they sign in on this device.
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
        await closeUserForSignOut(userId)
        const stored = await loadPushRegistration(userId)
        if (stored) {
          try {
            await revokePushToken(stored.deviceId, userId)
          } catch (err) {
            logDevError('AuthContext.signOut.revokePushToken', err)
          }
        }
        await clearPushRegistration(userId)
      } catch (err) {
        logDevError('AuthContext.signOut.pushRevocation', err)
      } finally {
        releaseUserGate(userId)
      }
    }

    await supabase.auth.signOut()
    setSession(null)
    setIsPasswordRecovery(false)
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    isPasswordRecovery,
    authCallbackError,
    setAuthCallbackError,
    signIn,
    signUp,
    resendVerificationEmail,
    requestPasswordReset,
    updatePassword,
    clearPasswordRecovery,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
