// Sprint 1C Rev2 (independent review): OS notification permission is
// installation-wide, not account-scoped -- it is NOT equivalent to Apex
// account-level consent. Without this module, `usePushRegistration`
// silently re-registers on any launch where OS permission happens to be
// granted, which produces two real bugs:
//   1. A learner taps "Disable Notifications" (server registration
//      revoked, local device pointer cleared) but OS permission remains
//      granted -- the very next launch silently re-registers them.
//   2. User A grants OS permission, signs out; User B signs into the
//      same physical device. Because OS permission is installation-wide,
//      User B would be silently registered without ever opting in.
//
// This stores ONE boolean per Apex account, scoped by profile id exactly
// like pushRegistrationStorage.ts/activePracticeStorage.ts, and answers
// only "has THIS Apex account explicitly asked to receive notifications
// on this device" -- it is never treated as server authorization; it
// only controls whether the client attempts registration at all.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'apex-advantage-notifications-opt-in:'

// Fails closed to "not opted in" for anything that isn't the literal
// stored string this module itself writes -- missing key, corrupt JSON,
// a non-boolean value, a read/parse error. An account that has never
// explicitly enabled Apex notifications must never be treated as opted
// in just because of ambiguous local storage state.
export async function loadNotificationOptIn(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId)
    if (raw === null) return false
    const parsed: unknown = JSON.parse(raw)
    return parsed === true
  } catch {
    return false
  }
}

export async function saveNotificationOptIn(userId: string, optedIn: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(optedIn === true))
  } catch {
    // Best-effort, matching pushRegistrationStorage.ts. A failed write
    // here means the next launch's read fails closed to `false` (never
    // silently re-registers), which is the safe direction for this
    // specific flag to fail in.
  }
}
