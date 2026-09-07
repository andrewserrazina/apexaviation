// Sprint 1C Phase 11: wires expo-notifications' three tap-delivery paths
// (foregrounded, backgrounded, cold-started/killed) into the one
// validated resolver in lib/notifications/notificationRouting.ts. Mounted
// once at the root layout so it's active regardless of auth state --
// navigating while signed out just lands on whatever the existing
// (app)/_layout.tsx redirect-to-sign-in guard already does, never a
// crash.
import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { navigateToNotificationTarget, resolveNotificationTarget } from '../lib/notifications/notificationRouting'
import { logDevError } from '../lib/api/errors'

function handleResponse(response: Notifications.NotificationResponse): void {
  try {
    const target = resolveNotificationTarget(response.notification.request.content.data)
    if (!target) return
    navigateToNotificationTarget(target)
  } catch (err) {
    logDevError('useNotificationRouting.handleResponse', err)
  }
}

export function useNotificationRouting(): void {
  useEffect(() => {
    // Foreground presentation policy -- idempotent to set repeatedly, so
    // this just lives alongside the listener setup below rather than as
    // a separate module-scope side effect on import.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })

    // Cold start / killed-app tap: the response that launched the app is
    // only available this way, never through the live listener below.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponse(response)
      })
      .catch((err) => logDevError('useNotificationRouting.getLastNotificationResponseAsync', err))

    // Foregrounded or backgrounded (but not killed) tap while the app
    // process is already alive.
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse)
    return () => subscription.remove()
  }, [])
}
