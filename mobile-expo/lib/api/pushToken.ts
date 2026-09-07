// Typed client for mobile-push-token. Sprint 1C Phase 7/9 hardens this
// with the same runtime validation standard as every other mobile-* API
// client, and adds the get_preferences/update_preferences actions (see
// portal/supabase/functions/mobile-push-token/index.ts's own Phase 9
// comment for their deployment status).
import type {
  MobileDeviceDTO,
  MobileNotificationPreferences,
  MobilePlatform,
  MobilePreferencesResponse,
  MobilePushTokenListResponse,
  MobilePushTokenRegisterResponse,
  MobilePushTokenRevokeResponse,
  MobileUpdatePreferencesRequest,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isPlainObject, isValidMobileDevice, isValidNotificationPreferences } from './validate'

function validateDeviceResponse(data: unknown, context: string): { device: MobileDeviceDTO } {
  assertShape(isPlainObject(data) && isValidMobileDevice(data.device), context, data)
  return data as unknown as { device: MobileDeviceDTO }
}

export async function registerPushToken(params: {
  platform: MobilePlatform
  expo_push_token: string
  installation_id?: string
  app_version?: string
}): Promise<MobilePushTokenRegisterResponse> {
  const data = await invokeMobileFunction('mobile-push-token', { action: 'register', ...params })
  return validateDeviceResponse(data, 'registerPushToken')
}

export async function revokePushToken(deviceId: string): Promise<MobilePushTokenRevokeResponse> {
  const data = await invokeMobileFunction('mobile-push-token', { action: 'revoke', device_id: deviceId })
  return validateDeviceResponse(data, 'revokePushToken')
}

export async function listPushTokens(): Promise<MobilePushTokenListResponse> {
  const data = await invokeMobileFunction<MobilePushTokenListResponse>('mobile-push-token')
  assertShape(isPlainObject(data) && Array.isArray(data.devices) && data.devices.every(isValidMobileDevice), 'listPushTokens', data)
  return data
}

function validatePreferencesResponse(data: unknown, context: string): MobilePreferencesResponse {
  assertShape(isPlainObject(data) && isValidNotificationPreferences(data.preferences), context, data)
  return data as unknown as MobilePreferencesResponse
}

export async function getNotificationPreferences(): Promise<MobileNotificationPreferences> {
  const data = await invokeMobileFunction('mobile-push-token', { action: 'get_preferences' })
  return validatePreferencesResponse(data, 'getNotificationPreferences').preferences
}

export async function updateNotificationPreferences(
  update: Omit<MobileUpdatePreferencesRequest, 'action'>
): Promise<MobileNotificationPreferences> {
  const data = await invokeMobileFunction('mobile-push-token', { action: 'update_preferences', ...update })
  return validatePreferencesResponse(data, 'updateNotificationPreferences').preferences
}
