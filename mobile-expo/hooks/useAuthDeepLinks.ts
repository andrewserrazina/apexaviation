// Handles the one deep-link path every verification/recovery email
// eventually lands on -- apexadvantage://auth-callback?type=signup|
// recovery&code=<pkce-code>. The email link itself actually points at a
// web page first (site/mobile-auth-redirect.html, AuthContext.
// AUTH_CALLBACK_URL_BASE) so there's a real fallback when the app isn't
// installed; that page forwards into this exact custom-scheme URL when
// it is. flowType: 'pkce' (lib/supabase.ts) is what makes Supabase hand
// back a short-lived `code` here instead of raw tokens in the URL.
//
// Mirrors useNotificationRouting.ts's own shape: wait for the root
// navigator to exist before ever calling router.replace() (a cold start
// opened directly via this deep link would otherwise race Expo Router's
// own mount), and dedupe by the exact URL string so the same link can't
// be processed twice (e.g. the OS redelivering the initial URL alongside
// a live 'url' event).
import { useEffect, useRef } from 'react'
import * as Linking from 'expo-linking'
import { router, useRootNavigationState } from 'expo-router'
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

export function useAuthDeepLinks(): void {
  const rootNavigationState = useRootNavigationState()
  const isReady = !!rootNavigationState?.key
  const { setAuthCallbackError } = useAuth()
  const handledUrlsRef = useRef<Set<string>>(new Set())

  async function handleUrl(url: string | null): Promise<void> {
    if (!url || !url.includes('auth-callback')) return
    if (handledUrlsRef.current.has(url)) return
    handledUrlsRef.current.add(url)

    try {
      const { queryParams } = Linking.parse(url)
      const code = typeof queryParams?.code === 'string' ? queryParams.code : null
      const type = typeof queryParams?.type === 'string' ? queryParams.type : null

      if (!code) {
        // A link that was already used once, or is otherwise malformed,
        // can arrive with no `code` at all (Supabase's own redirect adds
        // ?error=...&error_description=... instead in that case, in the
        // URL HASH not the query string -- site/mobile-auth-redirect.html
        // reads and shows that directly on the web page itself, so by the
        // time the app is ever launched there's nothing more specific
        // left to surface here) -- there is nothing to exchange, so this
        // is the same "that link doesn't work anymore" outcome as an
        // exchange failure below.
        setAuthCallbackError(EXPIRED_LINK_MESSAGE)
        router.replace('/(auth)/sign-in')
        return
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        logDevError('useAuthDeepLinks.exchangeCodeForSession', error)
        setAuthCallbackError(isPkceCodeVerifierMissingError(error) ? WRONG_DEVICE_MESSAGE : EXPIRED_LINK_MESSAGE)
        router.replace('/(auth)/sign-in')
        return
      }

      // A successful exchange of a recovery-type link fires
      // AuthContext's own PASSWORD_RECOVERY listener, which sets
      // isPasswordRecovery -- (auth)/_layout.tsx reads that to let this
      // navigation through instead of redirecting straight to (app) just
      // because a session now exists. A signup-type link's exchange is a
      // perfectly normal sign-in; that same layout's existing
      // session-redirect handles it with no special-casing needed here.
      //
      // Security review finding (fixed here): `data.redirectType` is
      // supabase-js's OWN authoritative answer to "was this a recovery
      // flow?" -- derived from the PKCE verifier record it stored
      // locally when resetPasswordForEmail()/signUp() started, not from
      // anything that travelled through the email link. Preferred over
      // this function's own `type` query param (still read as a
      // fallback only, since `redirectType` could in principle be absent
      // on an older SDK) because `type` is hand-threaded through two URL
      // hops (the web bounce page, then this custom-scheme link) where it
      // could be stripped, mis-set, or -- if a future change ever let it
      // -- tampered with; `redirectType` cannot be spoofed via the URL at
      // all, since it never came from the URL in the first place.
      const redirectType = (data as { redirectType?: string | null } | null)?.redirectType ?? null
      const isRecovery = redirectType ? redirectType === 'recovery' : type === 'recovery'
      if (isRecovery) {
        router.replace('/(auth)/reset-password')
      }
    } catch (err) {
      logDevError('useAuthDeepLinks.handleUrl', err)
      setAuthCallbackError(EXPIRED_LINK_MESSAGE)
      router.replace('/(auth)/sign-in')
    }
  }

  useEffect(() => {
    if (!isReady) return
    let cancelled = false

    Linking.getInitialURL().then((url) => {
      if (!cancelled) handleUrl(url)
    })

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url)
    })

    return () => {
      cancelled = true
      subscription.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])
}
