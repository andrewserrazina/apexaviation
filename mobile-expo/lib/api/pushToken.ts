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
import { getPinnedAccessToken, invokeMobileFunction } from './client'
import { assertShape, isPlainObject, isValidMobileDevice, isValidNotificationPreferences } from './validate'

function validateDeviceResponse(data: unknown, context: string): { device: MobileDeviceDTO } {
  assertShape(isPlainObject(data) && isValidMobileDevice(data.device), context, data)
  return data as unknown as { device: MobileDeviceDTO }
}

// Rev3: `expectedUserId`, when given, pins this mutation to the session
// belonging to that exact user id (see getPinnedAccessToken in
// client.ts) rather than whatever session happens to be active when this
// call actually executes -- callers with a long-running async operation
// that could still be in flight after an account switch (usePushRegistration's
// registerDevice/disable) MUST pass the user id that initiated the
// operation. Omitting it preserves the exact prior behavior (the ambient
// session), which is correct for call sites that are already
// synchronous/short-lived relative to any possible account change (e.g.
// AuthContext.signOut's own revoke, captured and invoked before that
// session is destroyed).
export async function registerPushToken(
  params: {
    platform: MobilePlatform
    expo_push_token: string
    installation_id?: string
    app_version?: string
  },
  expectedUserId?: string
): Promise<MobilePushTokenRegisterResponse> {
  const accessToken = expectedUserId ? await getPinnedAccessToken(expectedUserId) : undefined
  const data = await invokeMobileFunction('mobile-push-token', { action: 'register', ...params }, accessToken ? { accessToken } : undefined)
  return validateDeviceResponse(data, 'registerPushToken')
}

export async function revokePushToken(deviceId: string, expectedUserId?: string): Promise<MobilePushTokenRevokeResponse> {
  const accessToken = expectedUserId ? await getPinnedAccessToken(expectedUserId) : undefined
  const data = await invokeMobileFunction('mobile-push-token', { action: 'revoke', device_id: deviceId }, accessToken ? { accessToken } : undefined)
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
