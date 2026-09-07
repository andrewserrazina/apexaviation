// Sprint 1C Phase 6/7: thin wrappers around expo-notifications/expo-device
// so the rest of the push flow (usePushRegistration.ts) can be tested
// against these functions rather than the native modules directly, and so
// the "push isn't configured on this build yet" failure mode has one
// place it's decided.
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import type { MobilePlatform } from '../../../shared/mobile-dto'
import { getEasProjectId } from './expoPushConfig'

export type PermissionState = 'granted' | 'denied' | 'undetermined'

function toPermissionState(status: string): PermissionState {
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'undetermined'
}

// Read-only -- never prompts the OS. Safe to call on every app launch.
export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync()
  return toPermissionState(status)
}

// Triggers the OS permission prompt. Must only ever be called from an
// explicit learner action (the Profile "Enable Notifications" button) --
// see Phase 6's rule against any automatic/startup permission request.
export async function requestPermission(): Promise<PermissionState> {
  const { status } = await Notifications.requestPermissionsAsync()
  return toPermissionState(status)
}

export class PushNotConfiguredError extends Error {}

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
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  return data
}

export function currentPlatform(): MobilePlatform | null {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  return null
}
