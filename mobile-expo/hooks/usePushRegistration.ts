import { useCallback, useEffect, useRef, useState } from 'react'
import Constants from 'expo-constants'
import type { MobileNotificationPreferences } from '../../shared/mobile-dto'
import { getNotificationPreferences, registerPushToken, revokePushToken, updateNotificationPreferences } from '../lib/api/pushToken'
import { clearPushRegistration, loadPushRegistration, savePushRegistration, type StoredPushRegistration } from '../lib/pushRegistrationStorage'
import { loadNotificationOptIn, saveNotificationOptIn } from '../lib/notificationOptInStorage'
import { currentPlatform, getExpoPushToken, getPermissionState, PushNotConfiguredError, requestPermission, type PermissionState } from '../lib/notifications/pushRegistration'
import { logDevError } from '../lib/api/errors'

type PreferenceUpdate = Partial<MobileNotificationPreferences>

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

// Sprint 1C Phase 6/7/8/10 (Rev2 hardened): the single owner of push-
// notification permission/registration/preferences state, meant to be
// mounted ONCE (via NotificationsContext) rather than once per consuming
// screen -- two independent instances racing their own silent-reregister
// effects is exactly the "same-frame duplicate registration" failure
// mode this Sprint's test list calls out.
//
// Rev2: OS notification permission is installation-wide, NOT Apex
// account-level consent (see lib/notificationOptInStorage.ts's own
// header comment for the two concrete bugs this caused). Automatic
// re-registration on launch now requires BOTH the OS permission AND this
// exact account's own persisted opt-in flag. `enable()` sets that flag
// only after a successful explicit registration; `disable()` clears it
// before/alongside revoking. Sign-out semantics (chosen and documented
// here, not just implied): AuthContext.signOut() still revokes the
// active mobile_devices row, but does NOT touch this opt-in flag -- it
// stays true for that account. So: the SAME account signing back in on
// this device, with OS permission still granted, resumes registration
// automatically (no re-prompt, matching Phase 7's "safely re-register on
// later launches"); a DIFFERENT account signing in never inherits it,
// because the flag is stored under the previous account's own user id.
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

  // Rev2: a monotonically increasing "which user/mount is this" token.
  // Every async operation captures its own generation synchronously
  // before its first await, then checks it still matches
  // generationRef.current before committing ANY state update after that
  // await -- a stale operation started for a since-replaced user (a
  // sign-out/sign-in or an account switch on a shared device) or one
  // still in flight after unmount can therefore never mutate state on
  // behalf of whoever/whatever is current now. Bumped both when userId
  // changes AND on unmount (the sync effect's own cleanup), so both
  // cases are covered by one mechanism.
  const generationRef = useRef(0)
  const registeringRef = useRef(false)
  // Rev2: preference writes are serialized through this queue so an
  // older in-flight write (or its failure rollback) can never resolve
  // after, and overwrite, a newer successful write. Acceptable per this
  // Sprint's scope in place of per-field operation-generation tracking.
  const preferencesQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestPreferencesRef = useRef<MobileNotificationPreferences | null>(null)

  const commitPreferences = useCallback((next: MobileNotificationPreferences | null) => {
    latestPreferencesRef.current = next
    setPreferences(next)
  }, [])

  const loadPreferences = useCallback(
    async (myGeneration: number) => {
      setPreferencesLoading(true)
      setPreferencesError(null)
      try {
        const prefs = await getNotificationPreferences()
        if (generationRef.current !== myGeneration) return
        commitPreferences(prefs)
      } catch (err) {
        if (generationRef.current !== myGeneration) return
        logDevError('usePushRegistration.loadPreferences', err)
        setPreferencesError('We couldn’t load your notification preferences.')
      } finally {
        if (generationRef.current === myGeneration) setPreferencesLoading(false)
      }
    },
    [commitPreferences]
  )

  // Registers (or re-registers) this device for the given userId.
  // Idempotent server-side (upsert on profile_id+expo_push_token) -- a
  // repeat call on later app launches only refreshes last_seen_at, it
  // never creates a second row. Returns false (never throws) on any
  // failure the caller doesn't need to react to individually; callers
  // that DO need the failure reason (enable()) pass `onError`. Channel
  // setup on Android happens inside getExpoPushToken() itself, before
  // token acquisition (see lib/notifications/pushRegistration.ts).
  const registerDevice = useCallback(
    async (uid: string, myGeneration: number, onError?: (message: string) => void): Promise<boolean> => {
      if (registeringRef.current) return false
      registeringRef.current = true
      try {
        const platform = currentPlatform()
        if (!platform) return false
        const token = await getExpoPushToken()
        const result = await registerPushToken({ platform, expo_push_token: token, app_version: Constants.expoConfig?.version })
        const stored: StoredPushRegistration = { userId: uid, deviceId: result.device.id, expoPushToken: token, platform }
        await savePushRegistration(stored)
        if (generationRef.current !== myGeneration) return false
        setDevice(stored)
        return true
      } catch (err) {
        logDevError('usePushRegistration.registerDevice', err)
        if (generationRef.current === myGeneration) {
          onError?.(err instanceof PushNotConfiguredError ? err.message : 'We couldn’t finish enabling notifications. Please try again.')
        }
        return false
      } finally {
        registeringRef.current = false
      }
    },
    []
  )

  // Sprint 1C Phase 7 (Rev2 hardened): "safely re-register on later app
  // launches so last_seen_at can refresh" -- now requires BOTH OS
  // permission AND this exact Apex account's own opt-in flag (see this
  // hook's header comment). Never shows the permission prompt itself,
  // matching Phase 6's rule against any automatic/startup request.
  useEffect(() => {
    generationRef.current += 1
    const myGeneration = generationRef.current

    async function sync() {
      if (!userId) {
        setDevice(null)
        commitPreferences(null)
        setPermission('undetermined')
        return
      }

      const [stored, optedIn] = await Promise.all([loadPushRegistration(userId), loadNotificationOptIn(userId)])
      if (generationRef.current !== myGeneration) return
      setDevice(stored)

      let state: PermissionState = 'undetermined'
      try {
        state = await getPermissionState()
      } catch (err) {
        logDevError('usePushRegistration.sync.getPermissionState', err)
      }
      if (generationRef.current !== myGeneration) return
      setPermission(state)

      if (state === 'granted' && optedIn) {
        const ok = await registerDevice(userId, myGeneration)
        if (generationRef.current !== myGeneration) return
        if (ok) await loadPreferences(myGeneration)
      }
    }
    sync()

    return () => {
      // Invalidates this generation on unmount too, not just on the next
      // userId change -- one mechanism covers both.
      generationRef.current += 1
    }
  }, [userId, registerDevice, loadPreferences, commitPreferences])

  const enable = useCallback(async () => {
    if (!userId || enabling || registeringRef.current) return
    const myGeneration = generationRef.current
    setEnabling(true)
    setEnableError(null)
    try {
      const state = await requestPermission()
      if (generationRef.current !== myGeneration) return
      setPermission(state)
      if (state !== 'granted') return
      const ok = await registerDevice(userId, myGeneration, setEnableError)
      if (generationRef.current !== myGeneration) return
      if (ok) {
        // Persisted only AFTER a successful explicit registration --
        // this is the one place account-level opt-in becomes true.
        await saveNotificationOptIn(userId, true)
        if (generationRef.current !== myGeneration) return
        await loadPreferences(myGeneration)
      }
    } catch (err) {
      logDevError('usePushRegistration.enable', err)
      if (generationRef.current === myGeneration) setEnableError('We couldn’t enable notifications. Please try again.')
    } finally {
      if (generationRef.current === myGeneration) setEnabling(false)
    }
  }, [userId, enabling, registerDevice, loadPreferences])

  const disable = useCallback(async () => {
    if (!userId || disabling) return
    const myGeneration = generationRef.current
    setDisabling(true)
    try {
      // Persisted BEFORE/alongside revoking, per this Sprint's explicit
      // requirement -- even if the revoke call below fails or the
      // network is down, this account's own opt-in is already false, so
      // a relaunch (or this same effect re-running) never silently
      // re-registers it.
      await saveNotificationOptIn(userId, false)
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
      if (generationRef.current !== myGeneration) return
      setDevice(null)
      commitPreferences(null)
    } finally {
      if (generationRef.current === myGeneration) setDisabling(false)
    }
  }, [userId, disabling, commitPreferences])

  const updatePreference = useCallback(
    (partial: PreferenceUpdate): Promise<void> => {
      const myGeneration = generationRef.current
      const run = async () => {
        if (generationRef.current !== myGeneration) return
        const current = latestPreferencesRef.current
        if (!current) return
        const previous = current
        const fieldNames = Object.keys(partial)
        commitPreferences({ ...current, ...partial } as MobileNotificationPreferences)
        setSavingFields((prev) => new Set([...prev, ...fieldNames]))
        setPreferencesError(null)
        try {
          const updated = await updateNotificationPreferences(partial)
          if (generationRef.current !== myGeneration) return
          commitPreferences(updated)
        } catch (err) {
          logDevError('usePushRegistration.updatePreference', err)
          if (generationRef.current !== myGeneration) return
          // Reconcile -- never leave an optimistic toggle visually
          // enabled if the backend update actually failed. Safe against
          // a newer write racing this rollback because writes are
          // serialized: `previous` here is always the value immediately
          // before THIS write, and no later write can have started yet.
          commitPreferences(previous)
          setPreferencesError('We couldn’t save that change. Please try again.')
        } finally {
          if (generationRef.current === myGeneration) {
            setSavingFields((prev) => {
              const next = new Set(prev)
              fieldNames.forEach((f) => next.delete(f))
              return next
            })
          }
        }
      }
      const next = preferencesQueueRef.current.then(run, run)
      preferencesQueueRef.current = next
      return next
    },
    [commitPreferences]
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
