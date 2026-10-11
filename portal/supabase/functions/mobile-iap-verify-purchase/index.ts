// Verifies one Apple in-app purchase transaction and, if it checks out,
// grants Checkride Prep access on the calling Supabase account -- the
// one thing the iOS app is allowed to do to unlock the same `profiles.
// checkride_prep_unlocked` flag that stripe-webhook/index.ts's
// handleUnlockCheckridePrep() already unlocks for web purchasers.
//
// Called by the mobile app in exactly two cases: right after
// requestPurchase() succeeds (a brand-new purchase), and once per
// restorable purchase during a user-initiated Restore Purchases flow.
// Both cases run through this SAME verify-and-claim path, which is
// what makes restore idempotent for free: re-verifying a transaction
// this account already claimed is a harmless no-op that reconfirms the
// grant; it never re-charges or re-emails anything.
//
// Trust model (Phase 3 requirement -- "never unlock paid access based
// solely on a client success flag, decoded unverified receipt, or
// user-supplied product ID"): the client sends ONLY a transactionId.
// Nothing else it says is trusted. This function re-fetches that exact
// transaction from Apple's own App Store Server API using our own
// signed credentials, verifies the returned JWS's certificate chain up
// to Apple's real Root CA G3, and only then reads bundleId/productId/
// type/environment/revocationDate from the payload Apple itself signed --
// never from anything the client provided.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)
//   APPLE_IAP_ISSUER_ID       -- App Store Connect Issuer ID (UUID)
//   APPLE_IAP_KEY_ID          -- App Store Connect API Key ID
//   APPLE_IAP_PRIVATE_KEY_PEM -- the .p8 key's contents, PKCS#8 PEM, verbatim
//   APPLE_IAP_BUNDLE_ID       -- must equal app.json's ios.bundleIdentifier
//   APPLE_IAP_PRODUCT_ID      -- the non-consumable product id registered in App Store Connect
//
// NOT YET DEPLOYED -- see this project's Apple IAP implementation report.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getTransactionInfo, AppStoreServerApiError } from '../_shared/appleIap/appStoreServerApi.ts'
import { verifyAndDecodeAppleSignedPayload, AppleSignedPayloadError } from '../_shared/appleIap/verifySignedPayload.ts'
import type { AppleJWSTransactionDecodedPayload } from '../_shared/appleIap/types.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APPLE_ISSUER_ID = Deno.env.get('APPLE_IAP_ISSUER_ID')!
const APPLE_KEY_ID = Deno.env.get('APPLE_IAP_KEY_ID')!
const APPLE_PRIVATE_KEY_PEM = Deno.env.get('APPLE_IAP_PRIVATE_KEY_PEM')!
const APPLE_BUNDLE_ID = Deno.env.get('APPLE_IAP_BUNDLE_ID')!
const APPLE_PRODUCT_ID = Deno.env.get('APPLE_IAP_PRODUCT_ID')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function msToIso(ms: number | undefined): string | null {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'Missing Authorization header' }, 401)

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Invalid or expired session' }, 401)
    const profileId = userData.user.id

    const body = await req.json().catch(() => null)
    const transactionId = body?.transactionId
    if (!transactionId || typeof transactionId !== 'string') {
      return json({ error: 'Missing transactionId' }, 400)
    }

    const appleCredentials = {
      issuerId: APPLE_ISSUER_ID,
      keyId: APPLE_KEY_ID,
      bundleId: APPLE_BUNDLE_ID,
      privateKeyPem: APPLE_PRIVATE_KEY_PEM,
    }

    let environmentQueried: 'Production' | 'Sandbox'
    let signedTransactionInfo: string | undefined
    try {
      const result = await getTransactionInfo(transactionId, appleCredentials)
      environmentQueried = result.environmentQueried
      signedTransactionInfo = result.response.signedTransactionInfo
    } catch (err) {
      if (err instanceof AppStoreServerApiError) {
        console.error('mobile-iap-verify-purchase: App Store Server API error', err.message, err.status)
        return json({ status: 'verification_failed', reason: 'apple_api_error' })
      }
      throw err
    }

    if (!signedTransactionInfo) {
      return json({ status: 'verification_failed', reason: 'no_transaction_found' })
    }

    let payload: AppleJWSTransactionDecodedPayload
    try {
      payload = await verifyAndDecodeAppleSignedPayload<AppleJWSTransactionDecodedPayload>(signedTransactionInfo)
    } catch (err) {
      if (err instanceof AppleSignedPayloadError) {
        console.error('mobile-iap-verify-purchase: signature/chain verification failed', err.message)
        return json({ status: 'verification_failed', reason: 'signature_invalid' })
      }
      throw err
    }

    // Every one of these is checked against Apple's own signed claims,
    // never the client's request body -- a mismatch here means either a
    // misconfigured product/bundle id on our side, or a transaction
    // that genuinely belongs to a different app/product and must never
    // be allowed to grant Checkride Prep access.
    if (payload.bundleId !== APPLE_BUNDLE_ID) {
      return json({ status: 'verification_failed', reason: 'bundle_id_mismatch' })
    }
    if (payload.productId !== APPLE_PRODUCT_ID) {
      return json({ status: 'verification_failed', reason: 'product_id_mismatch' })
    }
    if (payload.type !== 'Non-Consumable') {
      return json({ status: 'verification_failed', reason: 'unexpected_product_type' })
    }
    if (payload.environment !== environmentQueried) {
      // Apple's own payload disagreeing with which host actually served
      // it would be a sign of something wrong upstream -- fail closed.
      return json({ status: 'verification_failed', reason: 'environment_mismatch' })
    }
    if (!payload.transactionId || !payload.originalTransactionId || !payload.purchaseDate || !payload.originalPurchaseDate) {
      return json({ status: 'verification_failed', reason: 'incomplete_payload' })
    }
    if (payload.revocationDate) {
      return json({ status: 'revoked' }, 200)
    }

    const { data: existing } = await supabase
      .from('apple_iap_transactions')
      .select('id, profile_id, revoked_at')
      .eq('transaction_id', payload.transactionId)
      .maybeSingle()

    if (existing && existing.profile_id !== profileId) {
      // Explicit, safe policy (Phase 3): a transaction already claimed
      // by a different Apex account is never silently reassigned or
      // merged. The caller is told plainly and nothing is granted.
      return json({ status: 'claimed_by_another_account' }, 200)
    }

    if (existing?.revoked_at) {
      return json({ status: 'revoked' }, 200)
    }

    if (!existing) {
      const { error: insertError } = await supabase.from('apple_iap_transactions').insert({
        profile_id: profileId,
        product_id: payload.productId,
        transaction_id: payload.transactionId,
        original_transaction_id: payload.originalTransactionId,
        bundle_id: payload.bundleId,
        environment: payload.environment,
        purchase_date: msToIso(payload.purchaseDate),
        original_purchase_date: msToIso(payload.originalPurchaseDate),
        price_milliunits: payload.price ?? null,
        currency: payload.currency ?? null,
      })
      if (insertError) {
        // 23505 on transaction_id means a concurrent request (e.g. the
        // purchase-updated listener firing twice) already inserted this
        // exact transaction -- re-read it and fall through to the same
        // ownership check above rather than erroring.
        if (insertError.code === '23505') {
          const { data: raceWinner } = await supabase
            .from('apple_iap_transactions')
            .select('profile_id, revoked_at')
            .eq('transaction_id', payload.transactionId)
            .maybeSingle()
          if (raceWinner && raceWinner.profile_id !== profileId) {
            return json({ status: 'claimed_by_another_account' }, 200)
          }
          if (raceWinner?.revoked_at) {
            return json({ status: 'revoked' }, 200)
          }
        } else {
          console.error('mobile-iap-verify-purchase: failed to record transaction', insertError)
          return json({ status: 'verification_failed', reason: 'internal_error' }, 500)
        }
      }
    }

    const { error: unlockError } = await supabase
      .from('profiles')
      .update({ checkride_prep_unlocked: true })
      .eq('id', profileId)

    if (unlockError) {
      console.error('mobile-iap-verify-purchase: failed to set checkride_prep_unlocked', unlockError)
      return json({ status: 'verification_failed', reason: 'internal_error' }, 500)
    }

    return json({ status: 'granted', productId: payload.productId, transactionId: payload.transactionId })
  } catch (err) {
    console.error('mobile-iap-verify-purchase error', err)
    return json({ status: 'verification_failed', reason: 'internal_error' }, 500)
  }
})
