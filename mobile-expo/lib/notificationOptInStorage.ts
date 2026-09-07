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
//
// Rev3 (independent review): "opted in" is represented ONLY by the
// literal stored value `true`; "not opted in" is represented by the
// ABSENCE of the key, never by writing the literal string "false". This
// is what makes a write failure fail closed in the correct direction --
// if `disable()` fails to persist opt-out because the underlying
// `removeItem()` throws, the key is left holding whatever it held before
// (which may be the still-true value from an earlier enable()), so the
// caller can detect and react to that instead of the storage layer
// silently swallowing the failure and letting a learner believe they
// successfully opted out. `saveNotificationOptIn` therefore returns a
// boolean the caller MUST check -- `disable()` must never report a
// persistent opt-out succeeded when this returned false.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'apex-advantage-notifications-opt-in:'

// Fails closed to "not opted in" for anything that isn't the literal
// stored value this module itself writes for an explicit opt-in --
// missing key (including the normal "opted out" representation), corrupt
// JSON, a non-boolean value, a read/parse error. An account that has
// never explicitly enabled Apex notifications must never be treated as
// opted in just because of ambiguous local storage state.
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

// Returns true only if the persistence genuinely succeeded. Callers must
// check this return value -- a caller that ignores it and proceeds as if
// an opt-out (or opt-in) was durably recorded can leave the on-device
// state and the actually-persisted state permanently out of sync (see
// this module's header comment for the concrete failure this caused
// before Rev3).
export async function saveNotificationOptIn(userId: string, optedIn: boolean): Promise<boolean> {
  try {
    if (optedIn) {
      await AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(true))
    } else {
      // "Not opted in" is the ABSENCE of the key, not a stored `false` --
      // see header comment. If this throws, the key (and whatever it
      // held) is left exactly as it was; it never ends up in a state
      // this function believes is "false" but actually still reads back
      // as `true`.
      await AsyncStorage.removeItem(KEY_PREFIX + userId)
    }
    return true
  } catch {
    return false
  }
}
