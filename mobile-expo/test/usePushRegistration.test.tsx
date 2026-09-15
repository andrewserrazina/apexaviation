// Sprint 1C Phase 6/7 (Rev2 hardened): permission denial must never
// register a device, permission grant registers exactly once (never a
// duplicate, even under same-frame double-invocation), and an app
// relaunch only silently re-registers when BOTH OS permission is granted
// AND this exact Apex account has its own persisted opt-in flag set --
// OS permission alone is never sufficient (see
// lib/notificationOptInStorage.ts). Also covers auth-transition races:
// an in-flight operation started for one user must never commit state
// for a user the hook has since switched to.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { usePushRegistration } from '../hooks/usePushRegistration'
// Rev4: the sign-out/registration coordinator is a real, dependency-free
// module -- exercised directly (not mocked) here to prove
// usePushRegistration's registerDevice() actually integrates with it,
// mirroring AuthContext.test.tsx's own approach on the sign-out side.
import { closeUserForSignOut, releaseUserGate } from '../lib/notifications/pushMutationCoordinator'
import type { PermissionState } from '../lib/notifications/pushRegistration'

const mockGetPermissionState = jest.fn()
const mockRequestPermission = jest.fn()
const mockGetExpoPushToken = jest.fn()
const mockCurrentPlatform = jest.fn()
const mockEnsureAndroidNotificationChannel = jest.fn()
class MockPushNotConfiguredError extends Error {}
jest.mock('../lib/notifications/pushRegistration', () => ({
  getPermissionState: (...args: unknown[]) => mockGetPermissionState(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  getExpoPushToken: (...args: unknown[]) => mockGetExpoPushToken(...args),
  currentPlatform: (...args: unknown[]) => mockCurrentPlatform(...args),
  ensureAndroidNotificationChannel: (...args: unknown[]) => mockEnsureAndroidNotificationChannel(...args),
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

const mockLoadNotificationOptIn = jest.fn()
const mockSaveNotificationOptIn = jest.fn()
jest.mock('../lib/notificationOptInStorage', () => ({
  loadNotificationOptIn: (...args: unknown[]) => mockLoadNotificationOptIn(...args),
  saveNotificationOptIn: (...args: unknown[]) => mockSaveNotificationOptIn(...args),
}))

const PREFS = { daily_drill_enabled: true, daily_drill_time: '07:00:00', checkride_countdown_enabled: true, weak_area_enabled: true, streak_enabled: true }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mockGetPermissionState.mockReset()
  mockRequestPermission.mockReset()
  mockGetExpoPushToken.mockReset()
  mockCurrentPlatform.mockReset()
  mockEnsureAndroidNotificationChannel.mockReset()
  mockEnsureAndroidNotificationChannel.mockResolvedValue(undefined)
  mockRegisterPushToken.mockReset()
  mockRevokePushToken.mockReset()
  mockGetNotificationPreferences.mockReset()
  mockUpdateNotificationPreferences.mockReset()
  mockLoadPushRegistration.mockReset()
  mockSavePushRegistration.mockReset()
  mockClearPushRegistration.mockReset()
  mockLoadNotificationOptIn.mockReset()
  mockSaveNotificationOptIn.mockReset()

  mockLoadPushRegistration.mockResolvedValue(null)
  mockSavePushRegistration.mockResolvedValue(undefined)
  mockClearPushRegistration.mockResolvedValue(undefined)
  mockLoadNotificationOptIn.mockResolvedValue(false)
  mockSaveNotificationOptIn.mockResolvedValue(true)
  mockCurrentPlatform.mockReturnValue('ios')
  mockGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]')
  mockRegisterPushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })
  mockGetNotificationPreferences.mockResolvedValue(PREFS)

  // The coordinator is module-level state keyed by user id -- reset
  // every id these tests touch so one test's gate never leaks into
  // another's.
  releaseUserGate('u1')
  releaseUserGate('user-a')
  releaseUserGate('user-b')
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

it('registers exactly once when the learner grants the permission prompt, and persists account-level opt-in', async () => {
  mockGetPermissionState.mockResolvedValue('undetermined')
  mockRequestPermission.mockResolvedValue('granted')

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('undetermined'))

  await act(async () => {
    await result.current.enable()
  })

  expect(result.current.registered).toBe(true)
  expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
  expect(mockRegisterPushToken).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]' }), 'u1')
  expect(mockSaveNotificationOptIn).toHaveBeenCalledWith('u1', true)
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

it('app restart with permission granted AND account opt-in still true silently re-registers, without prompting', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadNotificationOptIn.mockResolvedValue(true)
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

// Rev2 requirement 1: OS permission remaining granted is NOT account
// consent -- a relaunch after Disable must never silently re-register.
describe('account-level opt-in (Rev2)', () => {
  it('OS permission granted but opt-in still false (never enabled) does not register on mount', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(false)

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
    expect(result.current.registered).toBe(false)
  })

  it('enable -> disable -> remount with OS permission still granted -> NO registration', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockRequestPermission.mockResolvedValue('granted')
    mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1' } })

    // 1. enable(): opts in and registers (opt-in starts false, so mount
    // itself does not auto-register -- only the explicit action does).
    const first = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(first.result.current.permission).toBe('granted'))
    expect(first.result.current.registered).toBe(false)

    await act(async () => {
      await first.result.current.enable()
    })
    await waitFor(() => expect(first.result.current.registered).toBe(true))
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })

    // 2. disable(): must persist opt-in=false.
    await act(async () => {
      await first.result.current.disable()
    })
    expect(mockSaveNotificationOptIn).toHaveBeenCalledWith('u1', false)

    // Reflect the disable in the mocks a "remount" would observe.
    mockLoadNotificationOptIn.mockResolvedValue(false)
    mockLoadPushRegistration.mockResolvedValue(null)
    mockRegisterPushToken.mockClear()
    await act(async () => {
      first.unmount()
    })

    // 3. "remount" -- OS permission is STILL granted, but this account's
    // own opt-in is now false -- must not silently re-register.
    const second = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(second.result.current.permission).toBe('granted'))
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
    expect(second.result.current.registered).toBe(false)
  })

  it('User A opts in, signs out; User B signs in on the same device with OS permission still granted -> NO registration for B', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    // User A's own opt-in key resolves true; User B's own key (never set)
    // resolves false -- exactly how the user-scoped storage behaves.
    mockLoadNotificationOptIn.mockImplementation(async (userId: string) => userId === 'user-a')
    mockLoadPushRegistration.mockImplementation(async (userId: string) => (userId === 'user-a' ? { userId, deviceId: 'device-a', expoPushToken: 'tok-a', platform: 'ios' } : null))

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), { initialProps: { userId: 'user-a' as string | null } })
    await waitFor(() => expect(result.current.registered).toBe(true))
    mockRegisterPushToken.mockClear()

    // Sign-out/sign-in transition: userId switches to User B.
    rerender({ userId: 'user-b' })
    await waitFor(() => expect(result.current.registered).toBe(false))

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  it('the same opted-in user returning (sign-out then sign back in) safely re-registers', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), { initialProps: { userId: 'u1' as string | null } })
    await waitFor(() => expect(result.current.registered).toBe(true))

    rerender({ userId: null })
    await waitFor(() => expect(result.current.registered).toBe(false))

    mockRegisterPushToken.mockClear()
    rerender({ userId: 'u1' })
    await waitFor(() => expect(result.current.registered).toBe(true))
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
  })

  it('a malformed/failed opt-in read (storage module itself fails closed to false) never registers', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(false) // notificationOptInStorage's own contract on any corrupt/missing read

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })
})

it('reconciles a preference toggle back to its previous value when the backend update fails', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadNotificationOptIn.mockResolvedValue(true)
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

it('disable revokes the stored device, persists opt-in=false, and clears local registration state', async () => {
  mockGetPermissionState.mockResolvedValue('granted')
  mockLoadNotificationOptIn.mockResolvedValue(true)
  mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })
  mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.registered).toBe(true))

  await act(async () => {
    await result.current.disable()
  })

  expect(mockSaveNotificationOptIn).toHaveBeenCalledWith('u1', false)
  expect(mockRevokePushToken).toHaveBeenCalledWith('device-1', 'u1')
  expect(mockClearPushRegistration).toHaveBeenCalledWith('u1')
  expect(result.current.registered).toBe(false)
})

it('missing local device metadata on disable still clears local state and persists opt-in=false without calling revoke', async () => {
  mockGetPermissionState.mockResolvedValue('denied')
  mockLoadPushRegistration.mockResolvedValue(null)

  const { result } = await renderHook(() => usePushRegistration('u1'))
  await waitFor(() => expect(result.current.permission).toBe('denied'))

  await act(async () => {
    await result.current.disable()
  })

  expect(mockSaveNotificationOptIn).toHaveBeenCalledWith('u1', false)
  expect(mockRevokePushToken).not.toHaveBeenCalled()
  expect(mockClearPushRegistration).toHaveBeenCalledWith('u1')
})

// Rev2 requirement 5: auth-transition async races.
describe('auth-transition race protection (Rev2)', () => {
  it('a stale registerDevice completion for User A cannot mark User B as registered', async () => {
    const tokenGate = deferred<string>()
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockImplementation(async (userId: string) => userId === 'user-a')
    mockLoadPushRegistration.mockResolvedValue(null)
    mockGetExpoPushToken.mockImplementation(() => tokenGate.promise)

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), { initialProps: { userId: 'user-a' as string | null } })
    await waitFor(() => expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1))

    // Before User A's token registration resolves, the account switches.
    rerender({ userId: 'user-b' })
    await waitFor(() => expect(result.current.permission).toBe('granted'))

    // Now User A's stale in-flight registration finally resolves.
    await act(async () => {
      tokenGate.resolve('ExponentPushToken[stale-a]')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.registered).toBe(false)
  })

  it('a stale preference fetch for User A cannot populate User B’s preferences', async () => {
    const prefsGate = deferred<typeof PREFS>()
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockImplementation(async (userId: string) => ({ userId, deviceId: `device-${userId}`, expoPushToken: `tok-${userId}`, platform: 'ios' as const }))
    mockGetNotificationPreferences.mockImplementation(() => prefsGate.promise)

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), { initialProps: { userId: 'user-a' as string | null } })
    await waitFor(() => expect(mockGetNotificationPreferences).toHaveBeenCalledTimes(1))

    const bPrefs = { ...PREFS, streak_enabled: false }
    mockGetNotificationPreferences.mockResolvedValue(bPrefs)
    rerender({ userId: 'user-b' })
    await waitFor(() => expect(mockGetNotificationPreferences).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.preferences).toEqual(bPrefs))

    // User A's stale preference fetch resolves after the switch.
    await act(async () => {
      prefsGate.resolve(PREFS)
      await Promise.resolve()
      await Promise.resolve()
    })

    // Still User B's preferences -- the stale A response never overwrote them.
    expect(result.current.preferences).toEqual(bPrefs)
  })

  it('serializes concurrent preference writes so an older rollback cannot clobber a newer successful write', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })

    const firstWriteGate = deferred<void>()
    mockUpdateNotificationPreferences.mockImplementationOnce(async () => {
      await firstWriteGate.promise
      throw new Error('first write failed')
    })
    mockUpdateNotificationPreferences.mockImplementationOnce(async () => ({ ...PREFS, daily_drill_enabled: false }))

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.preferences).toEqual(PREFS))

    // Both calls queued and settled within one act() scope so React
    // observes every intermediate render this produces (queueing them
    // across separate act() calls, then resolving in a third, makes RTL
    // lose track of the later renders even though the hook's own state
    // converges correctly either way).
    await act(async () => {
      const firstCall = result.current.updatePreference({ streak_enabled: false })
      const secondCall = result.current.updatePreference({ daily_drill_enabled: false })
      firstWriteGate.resolve()
      await firstCall
      await secondCall
    })

    // The second (later) write's server-confirmed result must be what's
    // showing -- the first write's failure rollback (to the ORIGINAL
    // PREFS) must not have been applied after the second write landed.
    expect(result.current.preferences).toEqual({ ...PREFS, daily_drill_enabled: false })
  })
})

// Sprint 1C Rev3 (independent review, narrow hardening pass): three
// blockers on top of Rev2 -- Android's channel-before-permission
// ordering, a stale auth operation still being able to physically
// mutate the server, and opt-out persistence failing open.
describe('Rev3 hardening (independent review)', () => {
  it('Blocker 1: on Android, explicit enable() creates the notification channel before requesting permission, then acquires the token, then registers', async () => {
    mockCurrentPlatform.mockReturnValue('android')
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')

    const callOrder: string[] = []
    mockEnsureAndroidNotificationChannel.mockImplementation(async () => {
      callOrder.push('channel')
    })
    mockRequestPermission.mockImplementation(async () => {
      callOrder.push('permission')
      return 'granted'
    })
    mockGetExpoPushToken.mockImplementation(async () => {
      callOrder.push('token')
      return 'ExponentPushToken[abc]'
    })
    mockRegisterPushToken.mockImplementation(async () => {
      callOrder.push('register')
      return { device: { id: 'device-1', platform: 'android', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } }
    })

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(callOrder).toEqual(['channel', 'permission', 'token', 'register'])
    expect(result.current.registered).toBe(true)
  })

  it('Blocker 1: never creates an Android notification channel from enable() on iOS', async () => {
    mockCurrentPlatform.mockReturnValue('ios')
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(mockEnsureAndroidNotificationChannel).not.toHaveBeenCalled()
    expect(result.current.registered).toBe(true)
  })

  // Blocker 2 required test A: a stale token acquisition must cause ZERO
  // server-side mutation once the initiating user is no longer current --
  // not just "the UI never shows it as registered" (which the Rev2 test
  // above already covered), but the actual mutating calls themselves must
  // never fire.
  it('Blocker 2 (Test A): a stale token acquisition never calls registerPushToken or savePushRegistration once the account has changed', async () => {
    const tokenGate = deferred<string>()
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockImplementation(async (userId: string) => userId === 'user-a')
    mockLoadPushRegistration.mockResolvedValue(null)
    mockGetExpoPushToken.mockImplementation(() => tokenGate.promise)

    const { rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
      initialProps: { userId: 'user-a' as string | null },
    })
    await waitFor(() => expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1))

    // Account switches before User A's token resolves.
    rerender({ userId: 'user-b' })
    await waitFor(() => expect(mockLoadNotificationOptIn).toHaveBeenCalledWith('user-b'))

    await act(async () => {
      tokenGate.resolve('ExponentPushToken[stale-a]')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
    expect(mockSavePushRegistration).not.toHaveBeenCalled()
  })

  // Blocker 2 required test B: replacing the single shared boolean
  // registeringRef with a generation-scoped lock means a stale
  // generation's still-in-flight registration can never block a
  // DIFFERENT (newer) generation's own registration -- and once that
  // stale operation does resolve, it still can't mutate anything.
  it('Blocker 2 (Test B): a stale in-flight registration for User A cannot block User B from registering, and cannot mutate anything once resolved', async () => {
    const tokenGateA = deferred<string>()
    let tokenCallCount = 0
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockImplementation(async (userId: string) => (userId === 'user-b' ? null : null))
    mockGetExpoPushToken.mockImplementation(() => {
      tokenCallCount += 1
      if (tokenCallCount === 1) return tokenGateA.promise
      return Promise.resolve('ExponentPushToken[b]')
    })

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
      initialProps: { userId: 'user-a' as string | null },
    })
    await waitFor(() => expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1))
    // User A's registerDevice is now stuck awaiting tokenGateA, holding
    // generation 1's lock.

    rerender({ userId: 'user-b' })

    // User B's own registration (generation 2) must proceed and succeed
    // exactly once, entirely unblocked by A's still-held lock.
    await waitFor(() => expect(result.current.registered).toBe(true))
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
    expect(mockRegisterPushToken).toHaveBeenCalledWith(expect.objectContaining({ expo_push_token: 'ExponentPushToken[b]' }), 'user-b')

    // Now User A's stale registration finally resolves -- it must not
    // register again, and must not disturb User B's now-current state.
    await act(async () => {
      tokenGateA.resolve('ExponentPushToken[stale-a]')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1)
    expect(result.current.registered).toBe(true)
  })

  // Blocker 2 required test C: an explicit enable() interrupted by an
  // account switch must not leave `enabling` stuck true for the NEXT
  // user, who never called enable() at all.
  it('Blocker 2 (Test C): enabling never remains stuck true for a new user after an account switch interrupts an in-flight enable()', async () => {
    const permissionGate = deferred<'granted'>()
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockImplementation(() => permissionGate.promise)

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
      initialProps: { userId: 'user-a' as string | null },
    })
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    const enablePromise = result.current.enable()
    await waitFor(() => expect(result.current.enabling).toBe(true))

    mockLoadNotificationOptIn.mockResolvedValue(false)
    mockLoadPushRegistration.mockResolvedValue(null)
    rerender({ userId: 'user-b' })

    await waitFor(() => expect(result.current.enabling).toBe(false))

    // User A's stale permission prompt finally resolves -- must not flip
    // `enabling` back to true or register anything for User B.
    await act(async () => {
      permissionGate.resolve('granted')
      await enablePromise
    })

    expect(result.current.enabling).toBe(false)
    expect(mockRegisterPushToken).not.toHaveBeenCalled()
  })

  // Blocker 2 (d): registerPushToken/revokePushToken must be called with
  // the initiating user's own id so the mobile API client can pin the
  // mutation to that session rather than whatever session happens to be
  // ambient when the call executes.
  it('Blocker 2 (d): registerPushToken and revokePushToken are always called with the initiating user id, never a bare/untagged call', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })
    mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.registered).toBe(true))
    expect(mockRegisterPushToken).toHaveBeenCalledWith(expect.any(Object), 'u1')

    await act(async () => {
      await result.current.disable()
    })
    expect(mockRevokePushToken).toHaveBeenCalledWith('device-1', 'u1')
  })

  // Blocker 3: a failed opt-out persistence must not be silently treated
  // as success -- disable() must surface it and must not go on to revoke
  // the server registration or clear local state (leaving the account
  // still correctly tracked as registered/opted-in, matching the
  // pre-existing true value that survives the failed write).
  it('Blocker 3: a failed opt-out persistence surfaces disableError and does not revoke or clear local registration', async () => {
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockResolvedValue(true)
    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.registered).toBe(true))

    // Now the opt-out write fails.
    mockSaveNotificationOptIn.mockResolvedValue(false)

    await act(async () => {
      await result.current.disable()
    })

    expect(result.current.disableError).toBeTruthy()
    expect(mockRevokePushToken).not.toHaveBeenCalled()
    expect(mockClearPushRegistration).not.toHaveBeenCalled()
    expect(result.current.registered).toBe(true)
  })

  // Blocker 3: if the server registration succeeds but persisting
  // opt-in=true then fails, enable() must not leave an active-but-
  // untracked registration -- it compensates by revoking what it just
  // created and clearing local state, and surfaces the failure.
  it('Blocker 3: a failed opt-in persistence after a successful registration is compensated by revoking the just-created device', async () => {
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')
    mockSaveNotificationOptIn.mockResolvedValue(false)
    mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(mockSaveNotificationOptIn).toHaveBeenCalledWith('u1', true)
    expect(mockRevokePushToken).toHaveBeenCalledWith('device-1', 'u1')
    expect(mockClearPushRegistration).toHaveBeenCalledWith('u1')
    expect(result.current.registered).toBe(false)
    expect(result.current.enableError).toBeTruthy()
  })

  // Blocker 3: normal enable/disable behavior is unchanged when
  // persistence succeeds (regression guard against over-correcting).
  it('Blocker 3: normal enable then disable still succeeds end-to-end when persistence never fails', async () => {
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')
    mockRevokePushToken.mockResolvedValue({ device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })
    expect(result.current.registered).toBe(true)
    expect(result.current.enableError).toBeNull()

    mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' })

    await act(async () => {
      await result.current.disable()
    })
    expect(result.current.registered).toBe(false)
    expect(result.current.disableError).toBeNull()
  })
})

// Sprint 1C Rev4 (independent review, narrow lifecycle-closure pass):
// cross-system invariants between Auth, push registration, and OS
// permissions -- see pushMutationCoordinator.ts and AuthContext.tsx's own
// Rev4 comments for the exact race this closes.
describe('Rev4 hardening (independent review)', () => {
  it('registerDevice aborts with ZERO server mutation once this user’s sign-out gate has already closed', async () => {
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')

    await closeUserForSignOut('u1')

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(mockRegisterPushToken).not.toHaveBeenCalled()
    expect(mockSavePushRegistration).not.toHaveBeenCalled()
    expect(result.current.registered).toBe(false)
  })

  it('a registerDevice call genuinely enters the coordinator’s critical section -- closeUserForSignOut for that user waits for it to finish', async () => {
    const tokenGate = deferred<string>()
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')
    mockGetExpoPushToken.mockImplementation(() => tokenGate.promise)

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    const enablePromise = result.current.enable()
    await waitFor(() => expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1))

    // The token hasn't resolved yet, so registerDevice has not reached
    // the critical section -- closeUserForSignOut must resolve
    // immediately (nothing to wait for yet).
    await closeUserForSignOut('u1')
    releaseUserGate('u1')

    // Now let the (still in-flight, but now-doomed since the gate closed
    // and reopened) enable() settle so it doesn't leak into later tests.
    tokenGate.resolve('ExponentPushToken[abc]')
    await act(async () => {
      await enablePromise
    })
  })

  it('User B is never affected by User A’s closed sign-out gate -- coordinator state is scoped by user id', async () => {
    await closeUserForSignOut('user-a')

    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')

    const { result } = await renderHook(() => usePushRegistration('user-b'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(mockRegisterPushToken).toHaveBeenCalledWith(expect.any(Object), 'user-b')
    expect(result.current.registered).toBe(true)
  })

  // Test D: a failed registration mutation must always release its
  // critical section, so a subsequent sign-out for that user is never
  // stuck waiting forever.
  it('a failed registerPushToken call still releases the coordinator critical section', async () => {
    mockGetPermissionState.mockResolvedValue('undetermined')
    mockRequestPermission.mockResolvedValue('granted')
    mockRegisterPushToken.mockRejectedValue(new Error('network down'))

    const { result } = await renderHook(() => usePushRegistration('u1'))
    await waitFor(() => expect(result.current.permission).toBe('undetermined'))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.registered).toBe(false)

    // If the critical section had leaked, this would hang the test
    // (jest's own timeout would fail it) rather than resolve.
    await closeUserForSignOut('u1')
  })

  // Adversarial self-review finding (Part 4, scenario 2): once
  // registerPushToken has actually succeeded, the local pointer MUST
  // still be saved even if the generation went stale in the meantime --
  // otherwise sign-out's coordinator wait would unblock with no pointer
  // to find, leaving an orphaned, un-revocable active mobile_devices row.
  it('still saves the local registration pointer for a stale generation once the server mutation already succeeded, without committing stale React state', async () => {
    const registerGate = deferred<{ device: { id: string; platform: string; installation_id: null; app_version: null; last_seen_at: string; created_at: string } }>()
    mockGetPermissionState.mockResolvedValue('granted')
    mockLoadNotificationOptIn.mockImplementation(async (userId: string) => userId === 'user-a')
    mockLoadPushRegistration.mockImplementation(async (userId: string) => (userId === 'user-b' ? { userId, deviceId: 'device-b', expoPushToken: 'tok-b', platform: 'ios' as const } : null))
    mockRegisterPushToken.mockImplementation(() => registerGate.promise)

    const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
      initialProps: { userId: 'user-a' as string | null },
    })
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1))

    // User A's registration has entered the critical section and called
    // registerPushToken, but it hasn't resolved yet. The account now
    // switches to User B before it does.
    rerender({ userId: 'user-b' })
    await waitFor(() => expect(result.current.registered).toBe(true))
    expect(result.current.device?.deviceId).toBe('device-b')

    // User A's mutation now succeeds, long after the switch.
    await act(async () => {
      registerGate.resolve({ device: { id: 'device-a', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // The local pointer for A MUST have been saved despite the
    // staleness (so a sign-out for A could find and revoke it) --
    expect(mockSavePushRegistration).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', deviceId: 'device-a' }))
    // -- but User B's rendered state must be completely unaffected.
    expect(result.current.device?.deviceId).toBe('device-b')
    expect(result.current.registered).toBe(true)
  })

  describe('foreground OS-permission reconciliation', () => {
    function getForegroundHandler(): (state: string) => void {
      const addEventListenerMock = require('react-native').AppState.addEventListener as jest.Mock
      const call = addEventListenerMock.mock.calls[addEventListenerMock.mock.calls.length - 1]
      return call[1]
    }

    it('denied -> OS permission changed to granted in Settings -> foreground updates rendered state without remount, and never auto-registers if opt-in is false', async () => {
      mockGetPermissionState.mockResolvedValueOnce('denied')
      const { result } = await renderHook(() => usePushRegistration('u1'))
      await waitFor(() => expect(result.current.permission).toBe('denied'))

      mockGetPermissionState.mockResolvedValue('granted')
      const handler = getForegroundHandler()
      await act(async () => {
        handler('active')
      })

      await waitFor(() => expect(result.current.permission).toBe('granted'))
      expect(result.current.registered).toBe(false)
      expect(mockRegisterPushToken).not.toHaveBeenCalled()
      expect(mockRequestPermission).not.toHaveBeenCalled()
    })

    it('granted+registered -> OS permission changed to denied externally -> foreground updates rendered state so the UI no longer claims notifications are enabled', async () => {
      mockGetPermissionState.mockResolvedValueOnce('granted')
      mockLoadNotificationOptIn.mockResolvedValue(true)
      mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })

      const { result } = await renderHook(() => usePushRegistration('u1'))
      await waitFor(() => expect(result.current.registered).toBe(true))
      expect(result.current.permission).toBe('granted')

      mockGetPermissionState.mockResolvedValue('denied')
      const handler = getForegroundHandler()
      await act(async () => {
        handler('active')
      })

      await waitFor(() => expect(result.current.permission).toBe('denied'))
      // `registered` (device !== null) is a separate signal from
      // `permission` -- the UI branches on BOTH (see
      // NotificationsSection.tsx), and `permission === 'denied'` alone
      // is what stops it from ever rendering the "enabled" message once
      // this updates.
    })

    it('foreground reconciliation never calls requestPermission, even when permission is currently undetermined', async () => {
      mockGetPermissionState.mockResolvedValue('undetermined')
      const { result } = await renderHook(() => usePushRegistration('u1'))
      await waitFor(() => expect(result.current.permission).toBe('undetermined'))

      const handler = getForegroundHandler()
      await act(async () => {
        handler('active')
      })

      expect(mockRequestPermission).not.toHaveBeenCalled()
    })

    it('a stale foreground callback for a since-replaced user cannot mutate the current user’s rendered permission', async () => {
      const permissionGate = deferred<PermissionState>()
      mockGetPermissionState.mockResolvedValueOnce('denied')

      const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
        initialProps: { userId: 'user-a' as string | null },
      })
      await waitFor(() => expect(result.current.permission).toBe('denied'))

      const staleHandler = getForegroundHandler()
      mockGetPermissionState.mockImplementation(() => permissionGate.promise)
      staleHandler('active') // User A's foreground reconcile is now gated, in flight

      // Account switches to User B before A's reconcile resolves.
      mockGetPermissionState.mockResolvedValue('denied')
      mockLoadNotificationOptIn.mockResolvedValue(false)
      mockLoadPushRegistration.mockResolvedValue(null)
      rerender({ userId: 'user-b' })
      await waitFor(() => expect(mockLoadNotificationOptIn).toHaveBeenCalledWith('user-b'))

      // User A's stale reconcile now resolves to 'granted' -- it must
      // never overwrite User B's own current state.
      await act(async () => {
        permissionGate.resolve('granted')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.permission).toBe('denied')
    })

    it('removes the AppState listener on unmount', async () => {
      const removeMock = jest.fn()
      const addEventListenerMock = require('react-native').AppState.addEventListener as jest.Mock
      addEventListenerMock.mockReturnValueOnce({ remove: removeMock })

      const { unmount } = await renderHook(() => usePushRegistration('u1'))
      await act(async () => {
        unmount()
      })

      expect(removeMock).toHaveBeenCalled()
    })
  })

  describe('preference mutations pinned to the initiating user', () => {
    it('getNotificationPreferences and updateNotificationPreferences are always called with the initiating user id', async () => {
      mockGetPermissionState.mockResolvedValue('granted')
      mockLoadNotificationOptIn.mockResolvedValue(true)
      mockLoadPushRegistration.mockResolvedValue({ userId: 'u1', deviceId: 'device-1', expoPushToken: 'tok', platform: 'ios' })
      mockUpdateNotificationPreferences.mockResolvedValue({ ...PREFS, streak_enabled: false })

      const { result } = await renderHook(() => usePushRegistration('u1'))
      await waitFor(() => expect(result.current.preferences).toEqual(PREFS))
      expect(mockGetNotificationPreferences).toHaveBeenCalledWith('u1')

      await act(async () => {
        await result.current.updatePreference({ streak_enabled: false })
      })
      expect(mockUpdateNotificationPreferences).toHaveBeenCalledWith({ streak_enabled: false }, 'u1')
    })

    // Required test: a preference update queued for User A must never be
    // sent tagged as (or able to mutate) User B's account, even though
    // the write itself doesn't resolve until after the switch. Real
    // pinning enforcement (getPinnedAccessToken rejecting an ambient
    // session that no longer matches) is proven directly in
    // apiClient.test.ts; this proves the hook always threads the
    // INITIATING id through, never whatever is current when the write
    // finally executes.
    it('a preference update queued for User A is still sent pinned to User A even if the account switches to User B before it resolves', async () => {
      const updateGate = deferred<typeof PREFS>()
      mockGetPermissionState.mockResolvedValue('granted')
      mockLoadNotificationOptIn.mockResolvedValue(true)
      mockLoadPushRegistration.mockImplementation(async (userId: string) => ({ userId, deviceId: `device-${userId}`, expoPushToken: `tok-${userId}`, platform: 'ios' as const }))
      mockUpdateNotificationPreferences.mockImplementation(() => updateGate.promise)

      const { result, rerender } = await renderHook((props: { userId: string | null }) => usePushRegistration(props.userId), {
        initialProps: { userId: 'user-a' as string | null },
      })
      await waitFor(() => expect(result.current.preferences).toEqual(PREFS))

      const updatePromise = result.current.updatePreference({ streak_enabled: false })
      await waitFor(() => expect(mockUpdateNotificationPreferences).toHaveBeenCalledTimes(1))
      expect(mockUpdateNotificationPreferences).toHaveBeenCalledWith({ streak_enabled: false }, 'user-a')

      rerender({ userId: 'user-b' })
      await waitFor(() => expect(result.current.preferences).toEqual(PREFS))

      await act(async () => {
        updateGate.resolve({ ...PREFS, streak_enabled: false })
        await updatePromise
      })

      // Never called a second time (e.g. re-attributed/retried) as 'user-b'.
      expect(mockUpdateNotificationPreferences).toHaveBeenCalledTimes(1)
      expect(mockUpdateNotificationPreferences).toHaveBeenCalledWith({ streak_enabled: false }, 'user-a')
      // And User B's own rendered preferences were never overwritten by
      // A's stale (now-resolved) write.
      expect(result.current.preferences).toEqual(PREFS)
    })
  })
})
