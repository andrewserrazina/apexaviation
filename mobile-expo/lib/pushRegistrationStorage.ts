// Sprint 1C Phase 6/7/8: the minimum local metadata needed to identify
// and later revoke THIS device's current mobile_devices row -- not a
// cache of anything privileged, just { userId, deviceId, expoPushToken,
// platform } so the app can (a) know it's already registered without
// another round trip, and (b) find the right device id to revoke on
// sign-out. Scoped by profile id exactly like activePracticeStorage.ts,
// for the identical reason: a registration recorded for User A must
// never be read (and, worse, revoked) under User B after an account
// switch on the same physical device.
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobilePlatform } from '../../shared/mobile-dto'

const KEY_PREFIX = 'apex-advantage-push-registration:'

export interface StoredPushRegistration {
  userId: string
  deviceId: string
  expoPushToken: string
  platform: MobilePlatform
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStoredPushRegistration(value: unknown): value is StoredPushRegistration {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isNonEmptyString(v.userId) &&
    isNonEmptyString(v.deviceId) &&
    isNonEmptyString(v.expoPushToken) &&
    (v.platform === 'ios' || v.platform === 'android')
  )
}

export async function savePushRegistration(registration: StoredPushRegistration): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + registration.userId, JSON.stringify(registration))
  } catch {
    // Best-effort, matching activePracticeStorage.ts -- the server-side
    // registration is still valid even if this local pointer never gets
    // written; the app just won't know it's already registered until the
    // next successful register() call.
  }
}

// Returns null (never throws) for missing, corrupt, malformed, or
// wrong-user-scoped data -- the same fail-closed shape as
// loadActivePracticeSession, and for the same reason: a stored
// registration must never be attributed to a user it doesn't belong to.
export async function loadPushRegistration(userId: string): Promise<StoredPushRegistration | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredPushRegistration(parsed) || parsed.userId !== userId) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearPushRegistration(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // No-op -- a stale leftover pointer is harmless; the next app launch
    // just re-registers (see usePushRegistration's silent-reregister
    // effect), which upserts the same server row again.
  }
}
