// Typed client for mobile-push-token. Prepared per this Sprint's spec;
// no push-notification UI or Expo Notifications registration flow is
// wired up yet in Sprint 1A -- this only makes the contract available for
// a later sprint to call without inventing a new client shape.
import type {
  MobileDeviceDTO,
  MobilePlatform,
  MobilePushTokenListResponse,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'

export function registerPushToken(params: {
  platform: MobilePlatform
  expo_push_token: string
  installation_id?: string
  app_version?: string
}): Promise<{ device: MobileDeviceDTO }> {
  return invokeMobileFunction('mobile-push-token', { action: 'register', ...params })
}

export function revokePushToken(deviceId: string): Promise<{ device: MobileDeviceDTO }> {
  return invokeMobileFunction('mobile-push-token', { action: 'revoke', device_id: deviceId })
}

export function listPushTokens(): Promise<MobilePushTokenListResponse> {
  return invokeMobileFunction<MobilePushTokenListResponse>('mobile-push-token')
}
