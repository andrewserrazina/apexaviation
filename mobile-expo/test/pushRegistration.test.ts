// Sprint 1C Rev2: platform-specific coverage for
// lib/notifications/pushRegistration.ts -- iOS's richer authorization
// states (provisional/ephemeral must count as granted, matching what the
// OS will actually deliver) and the Android channel-before-token-
// acquisition ordering. Uses jest.resetModules()/jest.doMock() per test
// to control `Platform.OS`, since this module's behavior genuinely
// branches on it and a single static mock can't represent both
// platforms in one file.
const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 }
const AndroidImportance = { DEFAULT: 3 }

const mockGetPermissionsAsync = jest.fn()
const mockRequestPermissionsAsync = jest.fn()
const mockSetNotificationChannelAsync = jest.fn()
const mockGetExpoPushTokenAsync = jest.fn()

function mockNotificationsModule() {
  return {
    IosAuthorizationStatus,
    AndroidImportance,
    getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
    setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
    getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  }
}

const mockIsDevice = { value: true }
function mockDeviceModule() {
  return { get isDevice() { return mockIsDevice.value } }
}

const mockGetEasProjectId = jest.fn()
function mockExpoPushConfigModule() {
  return { getEasProjectId: (...args: unknown[]) => mockGetEasProjectId(...args) }
}

function loadModule(platformOS: 'ios' | 'android') {
  jest.resetModules()
  jest.doMock('react-native', () => ({ Platform: { OS: platformOS } }))
  jest.doMock('expo-notifications', mockNotificationsModule)
  jest.doMock('expo-device', mockDeviceModule)
  jest.doMock('../lib/notifications/expoPushConfig', mockExpoPushConfigModule)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../lib/notifications/pushRegistration')
}

beforeEach(() => {
  mockGetPermissionsAsync.mockReset()
  mockRequestPermissionsAsync.mockReset()
  mockSetNotificationChannelAsync.mockReset()
  mockSetNotificationChannelAsync.mockResolvedValue(undefined)
  mockGetExpoPushTokenAsync.mockReset()
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  mockGetEasProjectId.mockReset()
  mockGetEasProjectId.mockReturnValue('project-123')
  mockIsDevice.value = true
})

describe('toPermissionState -- iOS authorization states', () => {
  it('treats AUTHORIZED as granted', () => {
    const { toPermissionState } = loadModule('ios')
    expect(toPermissionState({ granted: true, status: 'granted', ios: { status: IosAuthorizationStatus.AUTHORIZED } })).toBe('granted')
  })

  it('treats PROVISIONAL as granted -- the OS will still deliver notifications quietly', () => {
    const { toPermissionState } = loadModule('ios')
    expect(toPermissionState({ granted: false, status: 'undetermined', ios: { status: IosAuthorizationStatus.PROVISIONAL } })).toBe('granted')
  })

  it('treats EPHEMERAL as granted', () => {
    const { toPermissionState } = loadModule('ios')
    expect(toPermissionState({ granted: false, status: 'undetermined', ios: { status: IosAuthorizationStatus.EPHEMERAL } })).toBe('granted')
  })

  it('treats DENIED as denied', () => {
    const { toPermissionState } = loadModule('ios')
    expect(toPermissionState({ granted: false, status: 'denied', ios: { status: IosAuthorizationStatus.DENIED } })).toBe('denied')
  })

  it('treats NOT_DETERMINED as undetermined', () => {
    const { toPermissionState } = loadModule('ios')
    expect(toPermissionState({ granted: false, status: 'undetermined', ios: { status: IosAuthorizationStatus.NOT_DETERMINED } })).toBe('undetermined')
  })
})

describe('toPermissionState -- Android (no ios field, uses the flattened response)', () => {
  it('treats granted:true as granted', () => {
    const { toPermissionState } = loadModule('android')
    expect(toPermissionState({ granted: true, status: 'granted' })).toBe('granted')
  })

  it('treats status:denied as denied', () => {
    const { toPermissionState } = loadModule('android')
    expect(toPermissionState({ granted: false, status: 'denied' })).toBe('denied')
  })

  it('treats anything else as undetermined', () => {
    const { toPermissionState } = loadModule('android')
    expect(toPermissionState({ granted: false, status: 'undetermined' })).toBe('undetermined')
  })
})

describe('ensureAndroidNotificationChannel', () => {
  it('creates the channel on Android', async () => {
    const { ensureAndroidNotificationChannel } = loadModule('android')
    await ensureAndroidNotificationChannel()
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(1)
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith('apex-training-reminders', expect.objectContaining({ name: expect.any(String) }))
  })

  it('does nothing on iOS', async () => {
    const { ensureAndroidNotificationChannel } = loadModule('ios')
    await ensureAndroidNotificationChannel()
    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled()
  })
})

describe('getExpoPushToken -- Android channel-before-token ordering', () => {
  it('creates the notification channel before requesting the push token on Android', async () => {
    const callOrder: string[] = []
    mockSetNotificationChannelAsync.mockImplementation(async () => {
      callOrder.push('channel')
    })
    mockGetExpoPushTokenAsync.mockImplementation(async () => {
      callOrder.push('token')
      return { data: 'ExponentPushToken[abc]' }
    })

    const { getExpoPushToken } = loadModule('android')
    await getExpoPushToken()

    expect(callOrder).toEqual(['channel', 'token'])
  })

  it('does not attempt channel creation on iOS before acquiring a token', async () => {
    const { getExpoPushToken } = loadModule('ios')
    await getExpoPushToken()
    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled()
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(1)
  })

  it('fails with PushNotConfiguredError, never fabricating a token, when no EAS project id is configured', async () => {
    mockGetEasProjectId.mockReturnValue(null)
    const { getExpoPushToken, PushNotConfiguredError } = loadModule('ios')
    await expect(getExpoPushToken()).rejects.toBeInstanceOf(PushNotConfiguredError)
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled()
  })

  it('fails with PushNotConfiguredError on a non-physical device', async () => {
    mockIsDevice.value = false
    const { getExpoPushToken, PushNotConfiguredError } = loadModule('ios')
    await expect(getExpoPushToken()).rejects.toBeInstanceOf(PushNotConfiguredError)
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled()
  })
})

describe('currentPlatform', () => {
  it('reports ios on iOS', () => {
    const { currentPlatform } = loadModule('ios')
    expect(currentPlatform()).toBe('ios')
  })

  it('reports android on Android', () => {
    const { currentPlatform } = loadModule('android')
    expect(currentPlatform()).toBe('android')
  })
})
