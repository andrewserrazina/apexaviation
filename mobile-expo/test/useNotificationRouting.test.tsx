// Sprint 1C Phase 11/12: exercises the hook that wires expo-notifications'
// tap-delivery paths into the validated resolver, as far as practical with
// unit tests -- a real cold/background/foreground tap on a physical
// device is a separate manual verification step (see the Sprint report).
const mockGetLastNotificationResponseAsync = jest.fn()
const mockAddNotificationResponseReceivedListener = jest.fn()
const mockRemove = jest.fn()
const mockSetNotificationHandler = jest.fn()
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
}))

const mockResolveNotificationTarget = jest.fn()
const mockNavigateToNotificationTarget = jest.fn()
jest.mock('../lib/notifications/notificationRouting', () => ({
  resolveNotificationTarget: (...args: unknown[]) => mockResolveNotificationTarget(...args),
  navigateToNotificationTarget: (...args: unknown[]) => mockNavigateToNotificationTarget(...args),
}))

import { renderHook, waitFor } from '@testing-library/react-native'
import { useNotificationRouting } from '../hooks/useNotificationRouting'

function response(data: unknown) {
  return { notification: { request: { content: { data } } } }
}

beforeEach(() => {
  mockGetLastNotificationResponseAsync.mockReset()
  mockAddNotificationResponseReceivedListener.mockReset()
  mockRemove.mockReset()
  mockResolveNotificationTarget.mockReset()
  mockNavigateToNotificationTarget.mockReset()
  mockGetLastNotificationResponseAsync.mockResolvedValue(null)
  mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove })
})

it('cold start: navigates using the last notification response when the app was launched by a tap', async () => {
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

it('foreground/background: registers a live listener that navigates on tap', async () => {
  await renderHook(() => useNotificationRouting())
  expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1)

  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]
  mockResolveNotificationTarget.mockReturnValue({ type: 'daily_drill' })
  liveHandler(response({ type: 'daily_drill' }))

  expect(mockNavigateToNotificationTarget).toHaveBeenCalledWith({ type: 'daily_drill' })
})

it('an unresolvable (malformed/unknown) payload never navigates and never throws', async () => {
  mockResolveNotificationTarget.mockReturnValue(null)

  await renderHook(() => useNotificationRouting())
  const liveHandler = mockAddNotificationResponseReceivedListener.mock.calls[0][0]

  expect(() => liveHandler(response({ type: 'not_a_real_type' }))).not.toThrow()
  expect(mockNavigateToNotificationTarget).not.toHaveBeenCalled()
})

it('unmounts cleanly, removing the live listener', async () => {
  const { unmount } = await renderHook(() => useNotificationRouting())
  await unmount()
  expect(mockRemove).toHaveBeenCalledTimes(1)
})
