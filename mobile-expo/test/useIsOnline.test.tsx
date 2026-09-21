// Phase 4 (offline content download): thin wrapper over NetInfo. Verifies
// the optimistic-true default, that only an explicit `false` on either
// field flips it offline (never a `null` reachability probe gap), and
// that the listener is torn down on unmount.
import { renderHook, act } from '@testing-library/react-native'
import { useIsOnline } from '../hooks/useIsOnline'

type Listener = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void

let capturedListener: Listener | null = null
const mockUnsubscribe = jest.fn()
const mockAddEventListener = jest.fn((listener: Listener) => {
  capturedListener = listener
  return mockUnsubscribe
})

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: Listener) => mockAddEventListener(listener),
  },
}))

beforeEach(() => {
  capturedListener = null
  mockAddEventListener.mockClear()
  mockUnsubscribe.mockClear()
})

describe('useIsOnline', () => {
  it('defaults to true before any NetInfo event arrives', async () => {
    const { result } = await renderHook(() => useIsOnline())
    expect(result.current).toBe(true)
  })

  it('goes offline when isConnected is explicitly false', async () => {
    const { result } = await renderHook(() => useIsOnline())
    await act(async () => {
      capturedListener?.({ isConnected: false, isInternetReachable: true })
    })
    expect(result.current).toBe(false)
  })

  it('goes offline when isInternetReachable is explicitly false', async () => {
    const { result } = await renderHook(() => useIsOnline())
    await act(async () => {
      capturedListener?.({ isConnected: true, isInternetReachable: false })
    })
    expect(result.current).toBe(false)
  })

  it('stays online when isInternetReachable is null (reachability probe not finished yet)', async () => {
    const { result } = await renderHook(() => useIsOnline())
    await act(async () => {
      capturedListener?.({ isConnected: true, isInternetReachable: null })
    })
    expect(result.current).toBe(true)
  })

  it('returns to online once a later event reports connectivity restored', async () => {
    const { result } = await renderHook(() => useIsOnline())
    await act(async () => {
      capturedListener?.({ isConnected: false, isInternetReachable: false })
    })
    expect(result.current).toBe(false)

    await act(async () => {
      capturedListener?.({ isConnected: true, isInternetReachable: true })
    })
    expect(result.current).toBe(true)
  })

  it('unsubscribes from NetInfo on unmount', async () => {
    const { unmount } = await renderHook(() => useIsOnline())
    expect(mockUnsubscribe).not.toHaveBeenCalled()
    await act(async () => {
      unmount()
    })
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
