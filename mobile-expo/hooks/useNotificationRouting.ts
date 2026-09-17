// Sprint 1C Phase 11 (Rev2 hardened): wires expo-notifications' three
// tap-delivery paths (foregrounded, backgrounded, cold-started/killed)
// into the one validated resolver in
// lib/notifications/notificationRouting.ts. Mounted once at the root
// layout so it's active regardless of auth state -- navigating while
// signed out just lands on whatever the existing (app)/_layout.tsx
// redirect-to-sign-in guard already does, never a crash.
//
// Rev2: RootLayout can render `null` while fonts are still loading, so
// `router.push()` must never fire before Expo Router's root navigator is
// actually mounted -- otherwise a cold-start tap races the app's own
// startup. `useRootNavigationState()` is the documented way to know that
// (its `.key` is undefined until the navigator exists). Also deduped: a
// handled notification's identifier is remembered for the life of this
// mount (so the exact same response can't route twice, e.g. if the
// platform surfaces it to both the cold-start check and the live
// listener), and the cold-start response itself is explicitly cleared
// via clearLastNotificationResponseAsync() once handled, so a LATER app
// start (with no new tap) can never replay it.
import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { useRootNavigationState } from 'expo-router'
import { navigateToNotificationTarget, resolveNotificationTarget } from '../lib/notifications/notificationRouting'
import { logDevError } from '../lib/api/errors'

export function useNotificationRouting(): void {
  const rootNavigationState = useRootNavigationState()
  const isReady = !!rootNavigationState?.key
  const handledIdsRef = useRef<Set<string>>(new Set())
  const coldStartCheckedRef = useRef(false)

  function handleResponse(response: Notifications.NotificationResponse): void {
    try {
      const id = response.notification.request.identifier
      if (id && handledIdsRef.current.has(id)) return
      if (id) handledIdsRef.current.add(id)
      const target = resolveNotificationTarget(response.notification.request.content.data)
      if (!target) return
      navigateToNotificationTarget(target)
    } catch (err) {
      logDevError('useNotificationRouting.handleResponse', err)
    }
  }

  // Foreground presentation policy -- idempotent to set repeatedly.
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })
  }, [])

  // Foregrounded or backgrounded (but not killed) tap while the app
  // process is already alive. A live tap can only occur once the app is
  // already running, so the navigator is always mounted in practice by
  // the time this fires -- still gated on `isReady` defensively, never
  // navigating before the root navigator exists.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isReady) return
      handleResponse(response)
    })
    return () => subscription.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  // Cold start / killed-app tap: the response that launched the app is
  // only available this way, never through the live listener above.
  // Deferred until the root navigator is ready, and only ever consulted
  // once per mount (`coldStartCheckedRef`) so a later readiness
  // transition (e.g. a font-load re-render) can't re-process it.
  useEffect(() => {
    if (!isReady || coldStartCheckedRef.current) return
    coldStartCheckedRef.current = true

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return
        handleResponse(response)
        // Prevents this exact response from replaying on a LATER app
        // start that has no new notification tap of its own.
        return Notifications.clearLastNotificationResponseAsync()
      })
      .catch((err) => logDevError('useNotificationRouting.getLastNotificationResponseAsync', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])
}
