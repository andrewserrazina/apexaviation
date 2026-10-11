import { useCallback, useEffect, useState } from 'react'
import { useIAP, ErrorCode, type Purchase, type Product } from 'expo-iap'
import { CHECKRIDE_PREP_PRODUCT_ID } from '../constants/iap'
import { verifyApplePurchase, type VerifyPurchaseResult } from '../lib/api/iap'
import { logDevError } from '../lib/api/errors'

export type CheckridePrepPurchaseState =
  // expo-iap's native module isn't reachable -- Expo Go, or the native
  // connection genuinely failed. The rest of the app must stay usable;
  // this hook never throws, it just reports this state so the UI can
  // show a plain "try again later" message instead of dead buttons.
  | 'storekit_unavailable'
  | 'loading_product'
  | 'idle'
  | 'purchasing'
  | 'verifying'
  | 'success'
  | 'cancelled'
  | 'pending'
  | 'failed'
  | 'claimed_by_another_account'
  | 'revoked'

interface UseCheckridePrepPurchaseOptions {
  profileId: string | null
  // Called after a purchase is verified and granted -- callers use this
  // to refresh BootstrapContext so `entitled` flips true immediately
  // without the learner needing to pull-to-refresh.
  onGranted: () => void
}

interface UseCheckridePrepPurchaseResult {
  state: CheckridePrepPurchaseState
  // Real StoreKit-reported title/price -- never hardcoded (Phase 2
  // requirement). Null until the product has loaded.
  product: Product | null
  errorMessage: string | null
  purchase: () => Promise<void>
  restore: () => Promise<void>
}

// Every verified transaction -- a fresh purchase, a StoreKit-replayed
// one on connect, or one found during an explicit Restore Purchases --
// runs through this exact same verify-then-finish path, which is what
// makes "new purchase" and "passive sync" the same code rather than
// two parallel implementations that could drift.
async function verifyAndFinish(
  purchase: Purchase,
  profileId: string,
  finishTransaction: (args: { purchase: Purchase; isConsumable?: boolean }) => Promise<void>
): Promise<VerifyPurchaseResult | null> {
  if (purchase.productId !== CHECKRIDE_PREP_PRODUCT_ID) return null
  // This app is iOS-only, but Purchase is a cross-platform union type
  // whose Android branch allows a missing transactionId -- iOS's own
  // branch always has one, so this is just satisfying that union, not
  // a real expected case.
  if (!purchase.transactionId) return null

  let result: VerifyPurchaseResult
  try {
    result = await verifyApplePurchase(purchase.transactionId)
  } catch (err) {
    logDevError('useCheckridePrepPurchase: verify call failed', err)
    // A genuine network/server failure, not a verified rejection --
    // deliberately do NOT finish the transaction here, so StoreKit
    // keeps it in the queue and retries automatically (next launch, or
    // the next purchaseUpdatedListener replay) rather than losing a
    // legitimate purchase to a transient outage.
    return null
  }

  // Apple's own transaction queue keeps redelivering an unfinished
  // transaction forever -- 'granted', 'claimed_by_another_account', and
  // 'revoked' are all TERMINAL outcomes for this device/account (none
  // of them change on retry), so all three finish the transaction.
  // Only a genuine verification_failed (which might be our own
  // misconfiguration, not the purchase's fault) is left unfinished.
  if (result.status !== 'verification_failed') {
    try {
      await finishTransaction({ purchase, isConsumable: false })
    } catch (err) {
      logDevError('useCheckridePrepPurchase: finishTransaction failed', err)
    }
  }
  return result
}

export function useCheckridePrepPurchase({ profileId, onGranted }: UseCheckridePrepPurchaseOptions): UseCheckridePrepPurchaseResult {
  const [state, setState] = useState<CheckridePrepPurchaseState>('loading_product')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const {
    connected,
    products,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    getAvailablePurchases,
    availablePurchases,
  } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      if (purchase.purchaseState === 'pending') {
        setState('pending')
        return
      }
      if (purchase.productId !== CHECKRIDE_PREP_PRODUCT_ID || !profileId) return
      setState('verifying')
      const result = await verifyAndFinish(purchase, profileId, finishTransaction)
      if (!result) {
        setState('failed')
        setErrorMessage('Check your connection and try again.')
        return
      }
      applyVerifyResult(result)
    },
    onPurchaseError: (error) => {
      if (error.code === ErrorCode.UserCancelled) {
        setState('idle')
        return
      }
      if (error.code === ErrorCode.DeferredPayment) {
        setState('pending')
        return
      }
      if (error.code === ErrorCode.AlreadyOwned) {
        // StoreKit itself knows this Apple ID already owns it -- the
        // learner should use Restore, not Purchase. onGranted is NOT
        // called here since we haven't verified anything server-side
        // yet; the Restore flow below does that properly.
        setState('failed')
        setErrorMessage('You already own this on your Apple ID — tap Restore Purchases instead.')
        return
      }
      logDevError('useCheckridePrepPurchase: purchase error', error)
      setState('failed')
      setErrorMessage('Something went wrong with that purchase. Please try again.')
    },
  })

  function applyVerifyResult(result: VerifyPurchaseResult) {
    switch (result.status) {
      case 'granted':
        setState('success')
        onGranted()
        return
      case 'claimed_by_another_account':
        setState('claimed_by_another_account')
        setErrorMessage('This purchase is linked to a different Apex account. Contact support if you believe this is a mistake.')
        return
      case 'revoked':
        setState('revoked')
        setErrorMessage('This purchase was refunded and can’t unlock Checkride Prep.')
        return
      case 'verification_failed':
      default:
        setState('failed')
        setErrorMessage('We couldn’t verify that purchase. Please try again or contact support.')
    }
  }

  // Load the real StoreKit product (title + localized price) as soon as
  // the connection is up -- never before `connected`, and never with a
  // guessed/hardcoded price in the meantime (Phase 2 requirement).
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    ;(async () => {
      try {
        await fetchProducts({ skus: [CHECKRIDE_PREP_PRODUCT_ID], type: 'in-app' })
        if (!cancelled) setState((s) => (s === 'loading_product' ? 'idle' : s))
      } catch (err) {
        logDevError('useCheckridePrepPurchase: fetchProducts failed', err)
        if (!cancelled) setState('storekit_unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // `connected` never resolving true at all (StoreKit native module
  // unreachable -- Expo Go, or a genuine init failure) is itself a
  // terminal signal once the normal connect handshake has had time to
  // settle. useIAP already retries the handshake internally; a short
  // grace period avoids flashing "unavailable" during that retry.
  useEffect(() => {
    if (connected) return
    const timer = setTimeout(() => {
      setState((s) => (s === 'loading_product' ? 'storekit_unavailable' : s))
    }, 8000)
    return () => clearTimeout(timer)
  }, [connected])

  const product = products.find((p) => p.id === CHECKRIDE_PREP_PRODUCT_ID) ?? null

  const purchase = useCallback(async () => {
    if (!profileId) return
    setErrorMessage(null)
    setState('purchasing')
    try {
      await requestPurchase({
        type: 'in-app',
        request: { apple: { sku: CHECKRIDE_PREP_PRODUCT_ID, appAccountToken: profileId } },
      })
      // Resolution happens in onPurchaseSuccess/onPurchaseError above --
      // requestPurchase itself only starts the StoreKit sheet.
    } catch (err) {
      logDevError('useCheckridePrepPurchase: requestPurchase threw', err)
      setState('failed')
      setErrorMessage('Something went wrong starting that purchase. Please try again.')
    }
  }, [profileId, requestPurchase])

  const restore = useCallback(async () => {
    if (!profileId) return
    setErrorMessage(null)
    setState('verifying')
    try {
      await getAvailablePurchases()
    } catch (err) {
      logDevError('useCheckridePrepPurchase: getAvailablePurchases failed', err)
      setState('failed')
      setErrorMessage('Check your connection and try again.')
      return
    }

    const owned = availablePurchases.find((p) => p.productId === CHECKRIDE_PREP_PRODUCT_ID)
    if (!owned) {
      setState('failed')
      setErrorMessage('No previous purchase was found for this Apple ID.')
      return
    }

    const result = await verifyAndFinish(owned, profileId, finishTransaction)
    if (!result) {
      setState('failed')
      setErrorMessage('Check your connection and try again.')
      return
    }
    applyVerifyResult(result)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, getAvailablePurchases, availablePurchases, finishTransaction])

  return { state, product, errorMessage, purchase, restore }
}
