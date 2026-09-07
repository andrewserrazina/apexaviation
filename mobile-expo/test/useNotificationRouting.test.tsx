// Sprint 1C Phase 11/12 (Rev2 hardened): exercises the hook that wires
// expo-notifications' tap-delivery paths into the validated resolver, as
// far as practical with unit tests -- a real cold/background/foreground
// tap on a physical device is a separate manual verification step (see
// the Sprint report).
//
// Rev2: RootLayout can render `null` while fonts load, so a cold-start
// response must not be routed before the root navigator is actually
// ready (`useRootNavigationState()`), and a handled response must never
// route twice or replay on a later app start (identifier dedupe +
// clearLastNotificationResponseAsync).
const mockGetLastNotificationResponseAsync = jest.fn()
const mockAddNotificationResponseReceivedListener = jest.fn()
const mockClearLastNotificationResponseAsync = jest.fn()
const mockRemove = jest.fn()
const mockSetNotificationHandler = jest.fn()
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  clearLastNotificationResponseAsync: (...args: unknown[]) => mockClearLastNotificationResponseAsync(...args),
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
}))

const mockUseRootNavigationState = jest.fn()
jest.mock('expo-router', () => ({
  useRootNavigationState: () => mockUseRootNavigationState(),
}))

const mockResolveNotificationTarget = jest.fn()
const mockNavigateToNotificationTarget = jest.fn()
jest.mock('../lib/notifications/notificationRouting', () => ({
  resolveNotificationTarget: (...args: unknown[]) => mockResolveNotificationTarget(...args),
  navigateToNotificationTarget: (...args: unknown[]) => mockNavigateToNotificationTarget(...args),
}))

import { renderHook, waitFor } from '@testing-library/react-native'
import { useNotificationRouting } from '../hooks/useNotificationRouting'

function response(data: unknown, identifier = 'notif-1') {
  return { notification: { request: { identifier, content: { data } } } }
}

beforeEach(() => {
  mockGetLastNotificationResponseAsync.mockReset()
  mockAddNotificationResponseReceivedListener.mockReset()
  mockClearLastNotificationResponseAsync.mockReset()
  mockClearLastNotificationResponseAsync.mockResolvedValue(undefined)
  mockRemove.mockReset()
  mockResolveNotificationTarget.mockReset()
  mockNavigateToNotificationTarget.mockReset()
  mockUseRootNavigationState.mockReset()
  mockGetLastNotificationResponseAsync.mockResolvedValue(null)
  mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove })
  // Ready by default -- individual tests override to simulate the
  // not-ready-yet window.
  mockUseRootNavigationState.mockReturnValue({ key: 'root' })
})

it('cold start: navigates using the last notification response once the root navigator is ready', async () => {
  mockGetLastNotificationResponseAsync.mockResolvedValue(response({ type: 'practice' }))
  mockResolveNotificationTarget.mockReturnValue({ type: 'practice' })

  await renderHook(() => useNotificationRouting())
  await waitFor(() => expect(mockNavigateToNotificationTarget).toHaveBeenCalledWith({ type: 'practice' }))
})

it('cold start: does nothing when the app was not launched by a notification tap', async () => {
  mockGetLastNotificationResponseAsync.mockResolvedValue(null)

  await renderHook(() => useNotificationRouting())
  await waitFor(() => expect(mockGetLastNotificationResponseAsync).toHaveBeenCalled())
  expect(mockNavigateToNotificationTarget).not.toHaveBeenCalled()
})

// Rev2 requirement 3: a cold response received before the root navigator
// is ready must wait, then route exactly once when readiness arrives --
// never navigate while the navigator doesn't exist yet.
it('cold response received before navigation readiness waits, then routes once readiness arrives', async () => {
  mockUseRootNavigationState.mockReturnValue(undefined) // not ready -- RootLayout still rendering `null`
  mockGetLastNotificationResponseAsync.mockResolvedValue(response({ type: 'practice' }))
  mockResolveNotificationTarget.mockReturnValue({ type: 'practice' })

  const { rerender } = await renderHook(() => useNotificationRouting())

  // Not ready yet -- must not have consulted the last response at all.
  expect(mockGetLastNotificationResponseAsync).not.toHaveBeenCalled()
  expect(mockNavigateToNotificationTarget).not.toHaveBeenCalled()

  // Root navigator becomes ready (fonts finished loading).
  mockUseRootNavigationState.mockReturnValue({ key: 'root' })
  rerender({})

  await waitFor(() => expect(mockNavigateToNotificationTarget).toHaveBeenCalledTimes(1))
  expect(mockNavigateToNotificationTarget).toHaveBeenCalledWith({ type: 'practice' })
})

// Rev2 requirement 3: clears the handled response so a LATER app start
// (with no new tap of its own) can never replay it.
it('clears the last notification response after handling it, to prevent replay on a later app start', async () => {
  mockGetLastNotificationResponseAsync.mockResolvedValue(response({ type: 'practice' }))
  mockResolveNotificationTarget.mockReturnValue({ type: 'practice' })

  await renderHook(() => useNotificationRouting())
  await waitFor(() => expect(mockClearLastNotificationResponseAsync).toHaveBeenCalledTimes(1))
})

it('foreground/background: registers a live listener that navigates on tap', async () => {
  await renderHook(() => useNotificationRouting())
  expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1)

  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]
  mockResolveNotificationTarget.mockReturnValue({ type: 'daily_drill' })
  liveHandler(response({ type: 'daily_drill' }))

  expect(mockNavigateToNotificationTarget).toHaveBeenCalledWith({ type: 'daily_drill' })
})

it('the live listener does nothing while the root navigator is not ready', async () => {
  mockUseRootNavigationState.mockReturnValue(undefined)
  await renderHook(() => useNotificationRouting())

  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]
  mockResolveNotificationTarget.mockReturnValue({ type: 'practice' })
  liveHandler(response({ type: 'practice' }))

  expect(mockNavigateToNotificationTarget).not.toHaveBeenCalled()
})

it('an unresolvable (malformed/unknown) payload never navigates and never throws', async () => {
  mockResolveNotificationTarget.mockReturnValue(null)

  await renderHook(() => useNotificationRouting())
  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]

  expect(() => liveHandler(response({ type: 'not_a_real_type' }))).not.toThrow()
  expect(mockNavigateToNotificationTarget).not.toHaveBeenCalled()
})

// Rev2 requirement 3: one notification interaction produces AT MOST one
// navigation -- the same response identifier must never route twice,
// even if the platform surfaces it to both the cold-start check and the
// live listener within the same session.
it('never routes the exact same notification response twice', async () => {
  const sameResponse = response({ type: 'practice' }, 'notif-dup')
  mockGetLastNotificationResponseAsync.mockResolvedValue(sameResponse)
  mockResolveNotificationTarget.mockReturnValue({ type: 'practice' })

  await renderHook(() => useNotificationRouting())
  await waitFor(() => expect(mockNavigateToNotificationTarget).toHaveBeenCalledTimes(1))

  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]
  liveHandler(sameResponse)

  expect(mockNavigateToNotificationTarget).toHaveBeenCalledTimes(1)
})

it('unmounts cleanly, removing the live listener', async () => {
  const { unmount } = await renderHook(() => useNotificationRouting())
  await unmount()
  expect(mockRemove).toHaveBeenCalledTimes(1)
})
