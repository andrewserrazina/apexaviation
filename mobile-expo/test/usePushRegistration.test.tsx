// Sprint 1C Phase 6/7: permission denial must never register a device,
// permission grant registers exactly once (never a duplicate, even under
// same-frame double-invocation), and an app relaunch with permission
// already granted safely re-registers (refreshing last_seen_at) without
// ever re-prompting for permission.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { usePushRegistration } from '../hooks/usePushRegistration'

const mockGetPermissionState = jest.fn()
const mockRequestPermission = jest.fn()
const mockGetExpoPushToken = jest.fn()
const mockCurrentPlatform = jest.fn()
class MockPushNotConfiguredError extends Error {}
jest.mock('../lib/notifications/pushRegistration', () => ({
  getPermissionState: (...args: unknown[]) => mockGetPermissionState(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  getExpoPushToken: (...args: unknown[]) => mockGetExpoPushToken(...args),
  currentPlatform: (...args: unknown[]) => mockCurrentPlatform(...args),
  PushNotConfiguredError: MockPushNotConfiguredError,
}))

const mockRegisterPushToken = jest.fn()
const mockRevokePushToken = jest.fn()
const mockGetNotificationPreferences = jest.fn()
const mockUpdateNotificationPreferences = jest.fn()
jest.mock('../lib/api/pushToken', () => ({
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
  revokePushToken: (...args: unknown[]) => mockRevokePushToken(...args),
  getNotificationPreferences: (...args: unknown[]) => mockGetNotificationPreferences(...args),
  updateNotificationPreferences: (...args: unknown[]) => mockUpdateNotificationPreferences(...args),
}))

const mockLoadPushRegistration = jest.fn()
const mockSavePushRegistration = jest.fn()
const mockClearPushRegistration = jest.fn()
jest.mock('../lib/pushRegistrationStorage', () => ({
  loadPushRegistration: (...args: unknown[]) => mockLoadPushRegistration(...args),
  savePushRegistration: (...args: unknown[]) => mockSavePushRegistration(...args),
  clearPushRegistration: (...args: unknown[]) => mockClearPushRegistration(...args),
}))

const PREFS = { daily_drill_enabled: true, daily_drill_time: '07:00:00', checkride_countdown_enabled: true, weak_area_enabled: true, streak_enabled: true }

beforeEach(() => {
  mockGetPermissionState.mockReset()
  mockRequestPermission.mockReset()
  mockGetExpoPushToken.mockReset()
  mockCurrentPlatform.mockReset()
  mockRegisterPushToken.mockReset()
  mockRevokePushToken.mockReset()
  mockGetNotificationPreferences.mockReset()
  mockUpdateNotificationPreferences.mockReset()
  mockLoadPushRegistration.mockReset()
  mockSavePushRegistration.mockReset()
  mockClearPushRegistration.mockReset()

  mockLoadPushRegistration.mockResolvedValue(null)
  mockSavePushRegistration.mockResolvedValue(undefined)
  mockClearPushRegistration.mockResolvedValue(undefined)
  mockCurrentPlatform.mockReturnValue('ios')
  mockGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]')
  mockRegisterPushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })
  mockGetNotificationPreferences.mockResolvedValue(PREFS)
})

it('never registers a device when the learner denies the permission prompt', async () => {
  mockGetPermissionState.mockResolvedValue('undetermined')
  mockRequestPermission.mockResolvedValue('denied')

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('undetermined'))

  await act(async () => {
    await result.current.enable()
  })

  expect(result.current.permission).toBe('denied')
  expect(result.current.registered).toBe(false)
  expect(mockRegisterPushToken).not.toHaveBeenCalled()
})

it('registers exactly once when the learner grants the permission prompt', async () => {
  mockGetPermissionState.mockResolvedValue('undetermined')
  mockRequestPermission.mockResolvedValue('granted')

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('undetermined'))

  await act(async () => {
    await result.current.enable()
  })

  expect(result.current.registered).toBe(true)
  expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
  expect(mockRegisterPushToken).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]' }))
})

it('a same-frame double-invocation of enable() cannot create a duplicate registration request', async () => {
  mockGetPermissionState.mockResolvedValue('undetermined')
  mockRequestPermission.mockResolvedValue('granted')

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('undetermined'))

  await act(async () => {
    await Promise.all([result.current.enable(), result.current.enable()])
  })

  expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
})

it('app restart with permission already granted silently re-registers to refresh last_seen_at, without prompting', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[old]', platform: 'ios' })

  const { result } = await renderHook(() => usePushRegistration('u1'))

  await waitFor(() => expect(result.current.registered).toBe(true))

  expect(mockRequestPermission).not.toHaveBeenCalled()
  expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
})

it('does not register or fetch preferences on mount when permission is not granted', async () => {
  mockGetPermissionState.mockResolvedValue('denied')

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('denied'))

  expect(mockRegisterPushToken).not.toHaveBeenCalled()
  expect(mockGetNotificationPreferences).not.toHaveBeenCalled()
})

it('reconciles a preference toggle back to its previous value when the backend update fails', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })
  mockUpdateNotificationPreferences.mockRejectedValue(new Error('network down'))

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.preferences).toEqual(PREFS))

  await act(async () => {
    await result.current.updatePreference({ streak_enabled: false })
  })

  expect(result.current.preferences).toEqual(PREFS)
  expect(result.current.preferencesError).toBeTruthy()
})

it('disable revokes the stored device and clears local registration state', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })
  mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.registered).toBe(true))

  await act(async () => {
    await result.current.disable()
  })

  expect(mockRevokePushToken).toHaveBeenCalledWith('device-1')
  expect(mockClearPushRegistration).toHaveBeenCalledWith('u1')
  expect(result.current.registered).toBe(false)
})

it('missing local device metadata on disable still clears local state without calling revoke', async () => {
  mockGetPermissionState.mockResolvedValue('denied')
  mockLoadPushRegistration.mockResolvedValue(null)

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('denied'))

  await act(async () => {
    await result.current.disable()
  })

  expect(mockRevokePushToken).not.toHaveBeenCalled()
  expect(mockClearPushRegistration).toHaveBeenCalledWith('u1')
})
