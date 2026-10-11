// Verifies one Apple in-app purchase transaction server-side and, if it
// checks out, unlocks Checkride Prep on the signed-in account -- see
// portal/supabase/functions/mobile-iap-verify-purchase/index.ts for the
// actual verification (App Store Server API + JWS chain validation).
// The client only ever sends a transactionId; it never asserts a
// product id, a price, or "I paid" on its own.
import { invokeMobileFunction } from './client'

export type VerifyPurchaseStatus = 'granted' | 'claimed_by_another_account' | 'revoked' | 'verification_failed'

export interface VerifyPurchaseResult {
  status: VerifyPurchaseStatus
  reason?: string
  productId?: string
  transactionId?: string
}

export async function verifyApplePurchase(transactionId: string): Promise<VerifyPurchaseResult> {
  return invokeMobileFunction<VerifyPurchaseResult, { transactionId: string }>('mobile-iap-verify-purchase', { transactionId })
}
