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
import { logDevError } from '../lib/api/errors'

const EXPIRED_LINK_MESSAGE = 'That link has expired or was already used. Please request a new one.'

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
        // ?error=...&error_description=... instead in that case) --
        // there is nothing to exchange, so this is the same "that link
        // doesn't work anymore" outcome as an exchange failure below.
        setAuthCallbackError(EXPIRED_LINK_MESSAGE)
        router.replace('/(auth)/sign-in')
        return
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        logDevError('useAuthDeepLinks.exchangeCodeForSession', error)
        setAuthCallbackError(EXPIRED_LINK_MESSAGE)
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
      if (type === 'recovery') {
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
