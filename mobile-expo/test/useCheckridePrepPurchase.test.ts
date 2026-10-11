// Exercises useCheckridePrepPurchase (hooks/useCheckridePrepPurchase.ts)
// -- the Apple IAP purchase/restore state machine Home and
// StateViews.tsx's LockedState both render through CheckridePrepPaywall.
// expo-iap's useIAP is mocked at the module level (it's a native-backed
// hook that can't run under Jest) with a stable, mutable fake.
//
// Every onPurchaseSuccess/onPurchaseError simulation below fires from
// INSIDE mockRequestPurchase's own mock implementation -- i.e. within
// the exact same `act(async () => { await result.current.purchase() })`
// call that triggers it in real life (requestPurchase() opens the
// StoreKit sheet, and the purchase-updated/-error listener fires as a
// direct consequence of that same call). Invoking the captured
// onPurchaseSuccess/onPurchaseError callback from OUTSIDE that act()
// scope -- e.g. a bare `act(() => { capturedOptions.onPurchaseError(...) })`
// called later, disconnected from any hook-triggered update -- does not
// reliably flush a re-render under this RN/React test renderer, so
// every simulated StoreKit event here is wired through purchase()/
// restore() itself instead.
import { act, renderHook, waitFor } from '@testing-library/react-native'

const ErrorCode = {
  UserCancelled: 'user-cancelled',
  DeferredPayment: 'deferred-payment',
  AlreadyOwned: 'already-owned',
}

const mockRequestPurchase = jest.fn()
const mockFinishTransaction = jest.fn()
const mockGetAvailablePurchases = jest.fn()
const mockFetchProducts = jest.fn()
let mockLatestIAPOptions: any = null
let mockFakeIAPState: {
  connected: boolean
  products: any[]
  availablePurchases: any[]
} = { connected: true, products: [], availablePurchases: [] }

jest.mock('expo-iap', () => ({
  ErrorCode,
  useIAP: (options: any) => {
    mockLatestIAPOptions = options
    return {
      connected: mockFakeIAPState.connected,
      products: mockFakeIAPState.products,
      fetchProducts: mockFetchProducts,
      requestPurchase: mockRequestPurchase,
      finishTransaction: mockFinishTransaction,
      getAvailablePurchases: mockGetAvailablePurchases,
      availablePurchases: mockFakeIAPState.availablePurchases,
    }
  },
}))

const mockVerifyApplePurchase = jest.fn()
jest.mock('../lib/api/iap', () => ({
  verifyApplePurchase: (...args: unknown[]) => mockVerifyApplePurchase(...args),
}))

import { useCheckridePrepPurchase } from '../hooks/useCheckridePrepPurchase'
import { CHECKRIDE_PREP_PRODUCT_ID } from '../constants/iap'

function samplePurchase(overrides: Record<string, unknown> = {}) {
  return {
    productId: CHECKRIDE_PREP_PRODUCT_ID,
    transactionId: 'txn-1',
    purchaseState: 'purchased',
    ...overrides,
  }
}

// Wires requestPurchase() to synchronously fire the real onPurchaseSuccess
// (or onPurchaseError) callback the hook registered -- exactly as
// StoreKit's own purchase-updated listener fires as a direct consequence
// of presenting the purchase sheet, just collapsed into one call for a
// deterministic test instead of a real async native round-trip.
function wireRequestPurchaseToFire(kind: 'success' | 'error', payload: any) {
  mockRequestPurchase.mockImplementation(async () => {
    if (kind === 'success') {
      await mockLatestIAPOptions.onPurchaseSuccess(payload)
    } else {
      mockLatestIAPOptions.onPurchaseError(payload)
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLatestIAPOptions = null
  mockFakeIAPState = { connected: true, products: [{ id: CHECKRIDE_PREP_PRODUCT_ID, displayPrice: '$29.99' }], availablePurchases: [] }
  mockFetchProducts.mockResolvedValue(undefined)
  mockGetAvailablePurchases.mockResolvedValue(undefined)
  mockFinishTransaction.mockResolvedValue(undefined)
})

describe('useCheckridePrepPurchase', () => {
  it('loads the real StoreKit product once connected', async () => {
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.product?.displayPrice).toBe('$29.99'))
    expect(mockFetchProducts).toHaveBeenCalledWith({ skus: [CHECKRIDE_PREP_PRODUCT_ID], type: 'in-app' })
  })

  it('a successful purchase that verifies as granted calls onGranted and finishes the transaction', async () => {
    const onGranted = jest.fn()
    mockVerifyApplePurchase.mockResolvedValue({ status: 'granted', productId: CHECKRIDE_PREP_PRODUCT_ID, transactionId: 'txn-1' })
    wireRequestPurchaseToFire('success', samplePurchase())
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(mockVerifyApplePurchase).toHaveBeenCalledWith('txn-1')
    expect(mockFinishTransaction).toHaveBeenCalledWith({ purchase: samplePurchase(), isConsumable: false })
    expect(onGranted).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('success')
  })

  it('a cancelled purchase (StoreKit’s own user-cancelled error) returns to idle, with no verify call', async () => {
    wireRequestPurchaseToFire('error', { code: ErrorCode.UserCancelled, message: 'cancelled' })
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('idle')
    expect(mockVerifyApplePurchase).not.toHaveBeenCalled()
  })

  it('a deferred payment (Ask to Buy) reports the pending state, with no verify call', async () => {
    wireRequestPurchaseToFire('error', { code: ErrorCode.DeferredPayment, message: 'deferred' })
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('pending')
    expect(mockVerifyApplePurchase).not.toHaveBeenCalled()
  })

  it('StoreKit already knowing the Apple ID owns this reports a clear, Restore-pointing failure, with no verify call', async () => {
    wireRequestPurchaseToFire('error', { code: ErrorCode.AlreadyOwned, message: 'already owned' })
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('failed')
    expect(result.current.errorMessage).toMatch(/Restore Purchases/)
    expect(mockVerifyApplePurchase).not.toHaveBeenCalled()
  })

  it('a purchase delivered with purchaseState "pending" also reports pending, without calling verify', async () => {
    wireRequestPurchaseToFire('success', samplePurchase({ purchaseState: 'pending' }))
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('pending')
    expect(mockVerifyApplePurchase).not.toHaveBeenCalled()
  })

  it('a transaction claimed by a different Apex account is finished (terminal) but never calls onGranted', async () => {
    const onGranted = jest.fn()
    mockVerifyApplePurchase.mockResolvedValue({ status: 'claimed_by_another_account' })
    wireRequestPurchaseToFire('success', samplePurchase())
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('claimed_by_another_account')
    expect(result.current.errorMessage).toMatch(/different Apex account/)
    expect(onGranted).not.toHaveBeenCalled()
    expect(mockFinishTransaction).toHaveBeenCalledTimes(1)
  })

  it('a revoked (refunded) transaction is finished but never calls onGranted', async () => {
    mockVerifyApplePurchase.mockResolvedValue({ status: 'revoked' })
    const onGranted = jest.fn()
    wireRequestPurchaseToFire('success', samplePurchase())
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('revoked')
    expect(onGranted).not.toHaveBeenCalled()
    expect(mockFinishTransaction).toHaveBeenCalledTimes(1)
  })

  it('a server-side verification_failed result is NOT finished, so StoreKit can redeliver and retry it', async () => {
    mockVerifyApplePurchase.mockResolvedValue({ status: 'verification_failed', reason: 'bundle_id_mismatch' })
    wireRequestPurchaseToFire('success', samplePurchase())
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('failed')
    expect(mockFinishTransaction).not.toHaveBeenCalled()
  })

  it('a network/backend failure while verifying is NOT finished either, and is distinguished from a verified rejection', async () => {
    mockVerifyApplePurchase.mockRejectedValue(new Error('network blip'))
    wireRequestPurchaseToFire('success', samplePurchase())
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(result.current.state).toBe('failed')
    expect(result.current.errorMessage).toMatch(/connection/i)
    expect(mockFinishTransaction).not.toHaveBeenCalled()
  })

  it('restore() finds a previous purchase, verifies it, and grants access on the same idempotent path as a new purchase', async () => {
    const onGranted = jest.fn()
    mockFakeIAPState.availablePurchases = [samplePurchase()]
    mockVerifyApplePurchase.mockResolvedValue({ status: 'granted' })
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.restore()
    })

    expect(mockGetAvailablePurchases).toHaveBeenCalledTimes(1)
    expect(mockVerifyApplePurchase).toHaveBeenCalledWith('txn-1')
    expect(onGranted).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('success')
  })

  it('restore() with nothing to restore reports a clear, honest failure -- never a fabricated grant', async () => {
    mockFakeIAPState.availablePurchases = []
    const onGranted = jest.fn()
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.restore()
    })

    expect(result.current.state).toBe('failed')
    expect(result.current.errorMessage).toMatch(/No previous purchase/)
    expect(onGranted).not.toHaveBeenCalled()
  })

  it('purchase() starts the StoreKit sheet with the profile id as the appAccountToken, never a hardcoded/guessed sku', async () => {
    mockRequestPurchase.mockResolvedValue(undefined)
    const { result } = await renderHook(() => useCheckridePrepPurchase({ profileId: 'profile-1', onGranted: jest.fn() }))
    await waitFor(() => expect(result.current.state).toBe('idle'))

    await act(async () => {
      await result.current.purchase()
    })

    expect(mockRequestPurchase).toHaveBeenCalledWith({
      type: 'in-app',
      request: { apple: { sku: CHECKRIDE_PREP_PRODUCT_ID, appAccountToken: 'profile-1' } },
    })
  })
})
