// Handles the one real Expo Router route every verification/recovery
// email eventually lands on -- app/auth-callback.tsx, reached via
// apexadvantage://auth-callback?type=signup|recovery&code=<pkce-code>.
// The email link itself actually points at a web page first
// (site/mobile-auth-redirect.html, AuthContext.AUTH_CALLBACK_URL_BASE)
// so there's a real fallback when the app isn't installed; that page
// forwards into this exact custom-scheme URL when it is. flowType:
// 'pkce' (lib/supabase.ts) is what makes Supabase hand back a
// short-lived `code` here instead of raw tokens in the URL.
//
// TestFlight finding (the bug this file was rewritten to fix): this
// used to subscribe to `Linking.addEventListener('url', ...)` directly
// and call router.replace() itself once processing finished. That
// doesn't work -- Expo Router's OWN linking integration
// (useLinking.native.js) subscribes to the exact same native Linking
// event independently, and tries to navigate to whatever path the
// incoming URL resolves to as soon as it arrives, regardless of what
// any other listener does with that same event. With no file-based
// route at /auth-callback, THAT navigation is what produced the
// "Unmatched Route" screen seen on a physical device -- a manual
// Linking listener can process the URL correctly and still lose the
// race to Expo Router's own built-in one.
//
// The fix: app/auth-callback.tsx is now a real route, so Expo Router
// navigates there itself (handling cold start automatically, since
// route+params resolution happens before this screen ever mounts).
// This hook no longer watches Linking at all -- it's called BY that
// screen with the params Expo Router already resolved for it, and owns
// only the exchange/dedup/follow-up-navigation logic, so there is
// exactly one place in the whole app that ever calls
// exchangeCodeForSession for a given code.
import { useEffect, useRef } from 'react'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { isPkceCodeVerifierMissingError } from '../lib/authErrors'
import { logDevError } from '../lib/api/errors'

const EXPIRED_LINK_MESSAGE = 'That link has expired or was already used. Please request a new one.'
// Security review finding: the generic message above is actively WRONG
// for this specific, real failure mode -- see isPkceCodeVerifierMissingError's
// own comment. Telling someone their link "expired" when it's actually
// fine (just opened somewhere the original code_verifier never reached)
// sends them to request a new one, which works around the real problem
// instead of explaining it.
const WRONG_DEVICE_MESSAGE =
  'That link needs to be opened on the same device where you started creating your account or requesting a password reset. Please try again from this device.'

// Module-level, not component state: a PKCE code is single-use
// server-side regardless, but this stops a second LOCAL attempt before
// it ever reaches the network -- the same `code` arriving twice (the
// link tapped again, or this screen somehow remounting with the same
// params within one app session) must never fire a second exchange.
// Deliberately never cleared/pruned within a session: each code is only
// ever meant to be seen once, so "seen before" should stay true for the
// lifetime of the process, not just long enough to dedupe a quick
// double-fire.
const processedCodes = new Set<string>()

// Called directly by app/auth-callback.tsx with the params Expo Router
// already resolved -- no Linking subscription of its own (see this
// file's header comment for why that was the actual bug). `handledRef`
// additionally guards against this SAME mount's effect running twice
// (e.g. React 18 Strict Mode's intentional double-invoke in
// development), on top of the module-level, cross-mount `processedCodes`
// guard above.
export function useAuthCallback(code: string | null | undefined, type: string | null | undefined): void {
  const { setAuthCallbackError } = useAuth()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    async function run() {
      if (!code || processedCodes.has(code)) {
        // No code at all (a malformed/incomplete deep link -- the real
        // expired/invalid-link case is already shown on the web bounce
        // page itself before the app is ever opened, per that page's
        // own hash-fragment handling) or a code this session has
        // already attempted once -- either way, nothing left to
        // exchange.
        setAuthCallbackError(EXPIRED_LINK_MESSAGE)
        router.replace('/(auth)/sign-in')
        return
      }
      processedCodes.add(code)

      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          logDevError('useAuthCallback.exchangeCodeForSession', error)
          setAuthCallbackError(isPkceCodeVerifierMissingError(error) ? WRONG_DEVICE_MESSAGE : EXPIRED_LINK_MESSAGE)
          router.replace('/(auth)/sign-in')
          return
        }

        // `data.redirectType` is supabase-js's OWN authoritative answer
        // to "was this a recovery flow?" -- derived from the PKCE
        // verifier record it stored locally when
        // resetPasswordForEmail()/signUp() started, not from anything
        // that travelled through the email link. Preferred over this
        // function's own `type` param (still read as a fallback only,
        // since `redirectType` could in principle be absent on an older
        // SDK) because `type` is hand-threaded through two URL hops
        // (the web bounce page, then this custom-scheme link) where it
        // could be stripped or mis-set; `redirectType` cannot be, since
        // it never came from the URL at all.
        const redirectType = (data as { redirectType?: string | null } | null)?.redirectType ?? null
        const isRecovery = redirectType ? redirectType === 'recovery' : type === 'recovery'

        // A successful recovery exchange already fired AuthContext's
        // own PASSWORD_RECOVERY listener, which set isPasswordRecovery
        // -- both (auth)/_layout.tsx and (app)/_layout.tsx read that to
        // keep a recovery session out of the authenticated app until a
        // new password is actually set. A signup exchange is a normal
        // sign-in with no special state to set.
        router.replace(isRecovery ? '/(auth)/reset-password' : '/(app)')
      } catch (err) {
        logDevError('useAuthCallback.run', err)
        setAuthCallbackError(EXPIRED_LINK_MESSAGE)
        router.replace('/(auth)/sign-in')
      }
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, type])
}
