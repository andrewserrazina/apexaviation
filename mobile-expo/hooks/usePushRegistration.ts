import { useCallback, useEffect, useRef, useState } from 'react'
import Constants from 'expo-constants'
import type { MobileNotificationPreferences } from '../../shared/mobile-dto'
import { getNotificationPreferences, registerPushToken, revokePushToken, updateNotificationPreferences } from '../lib/api/pushToken'
import { clearPushRegistration, loadPushRegistration, savePushRegistration, type StoredPushRegistration } from '../lib/pushRegistrationStorage'
import { loadNotificationOptIn, saveNotificationOptIn } from '../lib/notificationOptInStorage'
import {
  currentPlatform,
  ensureAndroidNotificationChannel,
  getExpoPushToken,
  getPermissionState,
  PushNotConfiguredError,
  requestPermission,
  type PermissionState,
} from '../lib/notifications/pushRegistration'
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
  disableError: string | null
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
  const [disableError, setDisableError] = useState<string | null>(null)
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
  // Rev3: which GENERATIONS currently have a registerDevice() call in
  // flight, replacing the single shared boolean this used to be. A
  // boolean shared across every user/mount meant a stale generation's
  // still-in-flight registration could block a brand-new generation's
  // registration attempt (and vice versa) even though the two belong to
  // different accounts/mounts entirely -- scoping the lock by generation
  // means one identity can never block another's registration, while
  // still preventing two concurrent registerDevice() calls for the SAME
  // generation (e.g. a same-frame double-tap of Enable, or the silent
  // relaunch effect racing an explicit enable()) from double-registering.
  const registeringGenerationsRef = useRef<Set<number>>(new Set())
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
  // never creates a second row. Returns the stored registration on
  // success, null (never throws) on any failure the caller doesn't need
  // to react to individually; callers that DO need the failure reason
  // (enable()) pass `onError`. Channel setup on Android happens inside
  // getExpoPushToken() itself too (idempotent), as defensive belt-and-
  // suspenders -- see lib/notifications/pushRegistration.ts -- but the
  // explicit enable() flow below now also ensures it BEFORE requesting
  // permission at all (Rev3 Blocker 1).
  //
  // Rev3: generation is re-checked before EVERY call below that can
  // mutate server state or local storage (registerPushToken,
  // savePushRegistration) -- not just before the final `setDevice`
  // commit. Previously only the React state commit was guarded, so a
  // stale/unmounted operation could still physically register a device
  // and write local storage after the user it was acting for had already
  // signed out or been replaced by a different account on the same
  // device.
  const registerDevice = useCallback(
    async (uid: string, myGeneration: number, onError?: (message: string) => void): Promise<StoredPushRegistration | null> => {
      if (generationRef.current !== myGeneration) return null
      if (registeringGenerationsRef.current.has(myGeneration)) return null
      registeringGenerationsRef.current.add(myGeneration)
      try {
        const platform = currentPlatform()
        if (!platform) return null
        const token = await getExpoPushToken()
        if (generationRef.current !== myGeneration) return null
        // `uid` is pinned as the expected session owner for this
        // mutation (see getPinnedAccessToken in lib/api/client.ts) --
        // even if this call somehow proceeded past the generation check
        // above, it can still never register a device under whichever
        // session happens to be ambient/current at this exact moment.
        const result = await registerPushToken({ platform, expo_push_token: token, app_version: Constants.expoConfig?.version }, uid)
        if (generationRef.current !== myGeneration) return null
        const stored: StoredPushRegistration = { userId: uid, deviceId: result.device.id, expoPushToken: token, platform }
        await savePushRegistration(stored)
        if (generationRef.current !== myGeneration) return null
        setDevice(stored)
        return stored
      } catch (err) {
        logDevError('usePushRegistration.registerDevice', err)
        if (generationRef.current === myGeneration) {
          onError?.(err instanceof PushNotConfiguredError ? err.message : 'We couldn’t finish enabling notifications. Please try again.')
        }
        return null
      } finally {
        registeringGenerationsRef.current.delete(myGeneration)
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

    // Rev3: reset every user-scoped transient flag synchronously for the
    // new generation. An old generation's in-flight enable()/disable()/
    // preference operation intentionally SKIPS its own state commits once
    // it goes stale (see the generation checks throughout this hook) --
    // which means nothing else would ever flip these back for the new
    // user/mount unless this reset does it here. Without this, e.g. a
    // User A `enable()` interrupted mid-flight by a sign-out/account
    // switch would leave `enabling` stuck `true` forever for User B, who
    // never called enable() at all.
    setEnabling(false)
    setEnableError(null)
    setDisabling(false)
    setDisableError(null)
    setPreferencesLoading(false)
    setPreferencesError(null)
    setSavingFields(new Set())
    preferencesQueueRef.current = Promise.resolve()

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
        const registered = await registerDevice(userId, myGeneration)
        if (generationRef.current !== myGeneration) return
        if (registered) await loadPreferences(myGeneration)
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
    if (!userId || enabling || registeringGenerationsRef.current.has(generationRef.current)) return
    const uid = userId
    const myGeneration = generationRef.current
    setEnabling(true)
    setEnableError(null)
    try {
      // Rev3 Blocker 1: on Android, the notification channel must exist
      // BEFORE the permission prompt can even appear (Android 13/Expo
      // SDK 57) -- this is stricter than "before token acquisition,"
      // which is all getExpoPushToken() below guarantees on its own.
      // Creating the channel is silent local prep (see
      // ensureAndroidNotificationChannel's own header comment) -- it
      // never itself prompts anything and is never treated as opt-in;
      // only a successful registration below sets that. No-op on iOS.
      if (currentPlatform() === 'android') {
        await ensureAndroidNotificationChannel()
        if (generationRef.current !== myGeneration) return
      }
      const state = await requestPermission()
      if (generationRef.current !== myGeneration) return
      setPermission(state)
      if (state !== 'granted') return
      const registered = await registerDevice(uid, myGeneration, setEnableError)
      if (generationRef.current !== myGeneration) return
      if (registered) {
        // Persisted only AFTER a successful explicit registration --
        // this is the one place account-level opt-in becomes true.
        const optInSaved = await saveNotificationOptIn(uid, true)
        if (generationRef.current !== myGeneration) return
        if (!optInSaved) {
          // Rev3 Blocker 3: the server now has an active registration
          // this app cannot durably remember as opted-in -- leaving it
          // in place would mean the next launch has no on-device record
          // that this account should silently re-register, while the
          // server still thinks the account wants notifications.
          // Compensate by revoking what was just created rather than
          // leaving an active-but-untracked registration, and surface
          // the failure so the learner knows to retry.
          logDevError('usePushRegistration.enable', new Error('opt-in=true persistence failed after successful registration'))
          try {
            await revokePushToken(registered.deviceId, uid)
          } catch (revokeErr) {
            logDevError('usePushRegistration.enable.compensatingRevoke', revokeErr)
          }
          await clearPushRegistration(uid)
          if (generationRef.current !== myGeneration) return
          setDevice(null)
          setEnableError('We couldn’t finish enabling notifications. Please try again.')
          return
        }
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
    const uid = userId
    const myGeneration = generationRef.current
    setDisabling(true)
    setDisableError(null)
    try {
      // Persisted BEFORE/alongside revoking, per this Sprint's explicit
      // requirement -- even if the revoke call below fails or the
      // network is down, this account's own opt-in is already false, so
      // a relaunch (or this same effect re-running) never silently
      // re-registers it.
      //
      // Rev3 Blocker 3: this must actually succeed before anything else
      // proceeds. `false`/opt-out is represented by removing the stored
      // key (see notificationOptInStorage.ts); if that removal fails,
      // the previous `true` value survives untouched. Going on to revoke
      // the server registration and clear the local device pointer
      // anyway would leave that stale `true` combined with OS permission
      // staying granted to silently re-register this exact account on
      // the very next launch -- exactly the "opt-out fails open" bug
      // this fix exists to close. Abort here and let the learner retry
      // instead.
      const optOutSaved = await saveNotificationOptIn(uid, false)
      if (generationRef.current !== myGeneration) return
      if (!optOutSaved) {
        logDevError('usePushRegistration.disable', new Error('opt-in=false persistence failed'))
        setDisableError('We couldn’t turn off notifications. Please try again.')
        return
      }
      const stored = await loadPushRegistration(uid)
      if (generationRef.current !== myGeneration) return
      if (stored) {
        try {
          await revokePushToken(stored.deviceId, uid)
        } catch (err) {
          logDevError('usePushRegistration.disable', err)
          // Best-effort: still clear local state below even if the
          // server call failed (e.g. offline) -- a stale local pointer
          // to an un-revoked device is worse than a locally-forgotten
          // one, since the app would otherwise keep "successfully"
          // showing it as registered. (Future stop gate: see this hook's
          // header comment / the Sprint report for the shared-device
          // token-ownership question this leaves for any future
          // server-initiated sender.)
        }
        if (generationRef.current !== myGeneration) return
      }
      await clearPushRegistration(uid)
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
    disableError,
    disable,
    preferences,
    preferencesLoading,
    preferencesError,
    savingFields,
    updatePreference,
  }
}
