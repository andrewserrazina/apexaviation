// Sprint 1C Phase 6/7 (Rev2 hardened): thin wrappers around
// expo-notifications/expo-device so the rest of the push flow
// (usePushRegistration.ts) can be tested against these functions rather
// than the native modules directly, and so the "push isn't configured on
// this build yet" failure mode has one place it's decided.
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import type { MobilePlatform } from '../../../shared/mobile-dto'
import { getEasProjectId } from './expoPushConfig'

export type PermissionState = 'granted' | 'denied' | 'undetermined'

// Rev2: expo-notifications' flattened top-level `status`/`granted` are
// enough on Android, but iOS has richer authorization states this app
// must interpret directly (`response.ios.status`) rather than trust the
// flattened fields alone: PROVISIONAL (Notification Grouping/quiet
// delivery, e.g. from a provisional-authorization request) and EPHEMERAL
// (App Clips) both mean the OS WILL deliver notifications, so both must
// count as "granted" here -- treating them as anything else would wrongly
// show the "Enable Notifications" button to a learner who has already,
// functionally, granted permission. NOT_DETERMINED is undetermined,
// DENIED is denied. Android responses have no `ios` field at all, so
// they fall through to the flattened granted/status interpretation.
export function toPermissionState(response: Notifications.NotificationPermissionsStatus): PermissionState {
  if (response.ios) {
    switch (response.ios.status) {
      case Notifications.IosAuthorizationStatus.AUTHORIZED:
      case Notifications.IosAuthorizationStatus.PROVISIONAL:
      case Notifications.IosAuthorizationStatus.EPHEMERAL:
        return 'granted'
      case Notifications.IosAuthorizationStatus.DENIED:
        return 'denied'
      case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
      default:
        return 'undetermined'
    }
  }
  if (response.granted) return 'granted'
  if (response.status === 'denied') return 'denied'
  return 'undetermined'
}

// Read-only -- never prompts the OS. Safe to call on every app launch.
export async function getPermissionState(): Promise<PermissionState> {
  const response = await Notifications.getPermissionsAsync()
  return toPermissionState(response)
}

// Triggers the OS permission prompt. Must only ever be called from an
// explicit learner action (the Profile "Enable Notifications" button) --
// see Phase 6's rule against any automatic/startup permission request.
export async function requestPermission(): Promise<PermissionState> {
  const response = await Notifications.requestPermissionsAsync()
  return toPermissionState(response)
}

export class PushNotConfiguredError extends Error {}

// A stable id/name for the one general-purpose channel this app uses
// today. Android requires a channel to exist before a notification can
// be delivered through it, and channel creation itself never triggers
// any OS permission prompt or dialog -- it is silent, so it's safe to
// call as normal registration prep rather than something gated behind
// its own separate user action.
const ANDROID_CHANNEL_ID = 'apex-training-reminders'

// No-ops on iOS. Must be called BEFORE token acquisition on Android --
// see getExpoPushToken() below.
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Training Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

// Sprint 1C Phase 5 stop gate carried through to runtime: without a real
// EAS project id, getExpoPushTokenAsync has nothing valid to call --
// this fails with a clear, catchable error rather than letting that SDK
// call throw an opaque native exception, and rather than ever fabricating
// a fake token.
export async function getExpoPushToken(): Promise<string> {
  const projectId = getEasProjectId()
  if (!projectId) {
    throw new PushNotConfiguredError('Push notifications aren’t available in this build yet.')
  }
  if (!Device.isDevice) {
    throw new PushNotConfiguredError('Push notifications require a physical device.')
  }
  await ensureAndroidNotificationChannel()
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  return data
}

export function currentPlatform(): MobilePlatform | null {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  return null
}
