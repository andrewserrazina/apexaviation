import { useCallback, useEffect, useRef, useState } from 'react'
import Constants from 'expo-constants'
import type { MobileNotificationPreferences } from '../../shared/mobile-dto'
import { getNotificationPreferences, registerPushToken, revokePushToken, updateNotificationPreferences } from '../lib/api/pushToken'
import { clearPushRegistration, loadPushRegistration, savePushRegistration, type StoredPushRegistration } from '../lib/pushRegistrationStorage'
import { currentPlatform, getExpoPushToken, getPermissionState, PushNotConfiguredError, requestPermission, type PermissionState } from '../lib/notifications/pushRegistration'
import { logDevError } from '../lib/api/errors'

type PreferenceUpdate = Partial<Omit<MobileNotificationPreferences, never>>

interface UsePushRegistrationResult {
  permission: PermissionState
  registered: boolean
  device: StoredPushRegistration | null
  enabling: boolean
  enableError: string | null
  enable: () => Promise<void>
  disabling: boolean
  disable: () => Promise<void>
  preferences: MobileNotificationPreferences | null
  preferencesLoading: boolean
  preferencesError: string | null
  savingFields: ReadonlySet<string>
  updatePreference: (partial: PreferenceUpdate) => Promise<void>
}

// Sprint 1C Phase 6/7/8/10: the single owner of push-notification
// permission/registration/preferences state, meant to be mounted ONCE
// (via NotificationsContext) rather than once per consuming screen --
// two independent instances racing their own silent-reregister effects
// is exactly the "same-frame duplicate registration" failure mode this
// Sprint's test list calls out.
export function usePushRegistration(userId: string | null): UsePushRegistrationResult {
  const [permission, setPermission] = useState<PermissionState>('undetermined')
  const [device, setDevice] = useState<StoredPushRegistration | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [preferences, setPreferences] = useState<MobileNotificationPreferences | null>(null)
  const [preferencesLoading, setPreferencesLoading] = useState(false)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [savingFields, setSavingFields] = useState<ReadonlySet<string>>(new Set())

  // Synchronous guard against overlapping register calls -- the render-
  // state `enabling` flag alone has the same same-frame gap Sprint 1B.1
  // already documented for activeLookupInFlight (a ref is checked
  // BEFORE the first await, render state is only visible next render).
  const registeringRef = useRef(false)

  const loadPreferences = useCallback(async () => {
    setPreferencesLoading(true)
    setPreferencesError(null)
    try {
      const prefs = await getNotificationPreferences()
      setPreferences(prefs)
    } catch (err) {
      logDevError('usePushRegistration.loadPreferences', err)
      setPreferencesError('We couldn’t load your notification preferences.')
    } finally {
      setPreferencesLoading(false)
    }
  }, [])

  // Registers (or re-registers) this device for the given userId.
  // Idempotent server-side (upsert on profile_id+expo_push_token) -- a
  // repeat call on later app launches only refreshes last_seen_at, it
  // never creates a second row. Returns false (never throws) on any
  // failure the caller doesn't need to react to individually; callers
  // that DO need the failure reason (enable()) pass `onError`.
  const registerDevice = useCallback(
    async (uid: string, onError?: (message: string) => void): Promise<boolean> => {
      if (registeringRef.current) return false
      registeringRef.current = true
      try {
        const platform = currentPlatform()
        if (!platform) return false
        const token = await getExpoPushToken()
        const result = await registerPushToken({ platform, expo_push_token: token, app_version: Constants.expoConfig?.version })
        const stored: StoredPushRegistration = { userId: uid, deviceId: result.device.id, expoPushToken: token, platform }
        await savePushRegistration(stored)
        setDevice(stored)
        return true
      } catch (err) {
        logDevError('usePushRegistration.registerDevice', err)
        onError?.(err instanceof PushNotConfiguredError ? err.message : 'We couldn’t finish enabling notifications. Please try again.')
        return false
      } finally {
        registeringRef.current = false
      }
    },
    []
  )

  // Sprint 1C Phase 7: "safely re-register on later app launches so
  // last_seen_at can refresh." Only ever runs when the OS permission is
  // ALREADY granted -- this NEVER shows the permission prompt itself,
  // matching Phase 6's rule against any automatic/startup request.
  useEffect(() => {
    let cancelled = false
    async function sync() {
      if (!userId) {
        setDevice(null)
        setPreferences(null)
        setPermission('undetermined')
        return
      }
      const stored = await loadPushRegistration(userId)
      if (cancelled) return
      setDevice(stored)

      let state: PermissionState = 'undetermined'
      try {
        state = await getPermissionState()
      } catch (err) {
        logDevError('usePushRegistration.sync.getPermissionState', err)
      }
      if (cancelled) return
      setPermission(state)

      if (state === 'granted') {
        await registerDevice(userId)
        if (!cancelled) await loadPreferences()
      }
    }
    sync()
    return () => {
      cancelled = true
    }
  }, [userId, registerDevice, loadPreferences])

  const enable = useCallback(async () => {
    if (!userId || enabling || registeringRef.current) return
    setEnabling(true)
    setEnableError(null)
    try {
      const state = await requestPermission()
      setPermission(state)
      if (state !== 'granted') return
      const ok = await registerDevice(userId, setEnableError)
      if (ok) await loadPreferences()
    } catch (err) {
      logDevError('usePushRegistration.enable', err)
      setEnableError('We couldn’t enable notifications. Please try again.')
    } finally {
      setEnabling(false)
    }
  }, [userId, enabling, registerDevice, loadPreferences])

  const disable = useCallback(async () => {
    if (!userId || disabling) return
    setDisabling(true)
    try {
      const stored = await loadPushRegistration(userId)
      if (stored) {
        try {
          await revokePushToken(stored.deviceId)
        } catch (err) {
          logDevError('usePushRegistration.disable', err)
          // Best-effort: still clear local state below even if the
          // server call failed (e.g. offline) -- a stale local pointer
          // to an un-revoked device is worse than a locally-forgotten
          // one, since the app would otherwise keep "successfully"
          // showing it as registered.
        }
      }
      await clearPushRegistration(userId)
      setDevice(null)
      setPreferences(null)
    } finally {
      setDisabling(false)
    }
  }, [userId, disabling])

  const updatePreference = useCallback(
    async (partial: PreferenceUpdate) => {
      if (!preferences) return
      const previous = preferences
      const fieldNames = Object.keys(partial)
      setPreferences({ ...preferences, ...partial })
      setSavingFields((prev) => new Set([...prev, ...fieldNames]))
      setPreferencesError(null)
      try {
        const updated = await updateNotificationPreferences(partial)
        setPreferences(updated)
      } catch (err) {
        logDevError('usePushRegistration.updatePreference', err)
        // Reconcile -- never leave an optimistic toggle visually enabled
        // if the backend update actually failed (Phase 10's explicit
        // requirement).
        setPreferences(previous)
        setPreferencesError('We couldn’t save that change. Please try again.')
      } finally {
        setSavingFields((prev) => {
          const next = new Set(prev)
          fieldNames.forEach((f) => next.delete(f))
          return next
        })
      }
    },
    [preferences]
  )

  return {
    permission,
    registered: device !== null,
    device,
    enabling,
    enableError,
    enable,
    disabling,
    disable,
    preferences,
    preferencesLoading,
    preferencesError,
    savingFields,
    updatePreference,
  }
}
