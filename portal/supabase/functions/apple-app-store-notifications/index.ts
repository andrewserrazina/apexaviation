// Apple App Store Server Notifications V2 receiver -- the server-to-
// server push Apple sends on refunds, revocations, and a handful of
// other lifecycle events for every transaction tied to this app. This
// is what keeps checkride_prep_unlocked correct when a purchase is
// refunded through Apple (App Store/Settings, not through us) rather
// than only on the next time the app happens to call
// mobile-iap-verify-purchase.
//
// Public endpoint -- Apple calls this with no Supabase Authorization
// header, so there is nothing to authenticate the CALLER with. Instead,
// every security property comes from verifying the signedPayload JWS
// itself (same chain-to-Apple-Root-CA-G3 verification
// mobile-iap-verify-purchase uses) before trusting a single field of it.
// A request whose payload doesn't verify is rejected outright and never
// touches the database.
//
// Idempotency: every notification is recorded in
// apple_server_notifications_log by its notificationUUID BEFORE acting
// on it, mirroring stripe-webhook/index.ts's own stripe_webhook_events
// pattern -- a unique-constraint failure there means Apple is retrying
// a delivery we already processed, so we skip straight to 200.
//
// Reconciliation for missed events (Phase 3 requirement -- Apple
// notification delivery is not guaranteed forever): this endpoint is
// the fast path, not the only path. mobile-iap-verify-purchase is called
// again on every Restore Purchases and re-confirms the live Apple
// transaction state regardless of whether a notification was ever
// delivered for it; a dedicated periodic reconciliation job (checking
// GetTransactionInfo for any apple_iap_transactions row not touched in
// N days) is flagged as a follow-up in this project's IAP
// implementation report, not yet built.
//
// Never removes access that came from an independently valid Stripe/
// web purchase: before flipping checkride_prep_unlocked back to false
// on a refund/revoke, this checks whether the profile has ANY other
// qualifying grant (another still-valid apple_iap_transactions row, or
// any portal_access_purchases row at all) and leaves access alone if so.
// (stripe-webhook/index.ts has no charge.refunded handler at all today --
// a Stripe-side refund of a web purchase never revokes access, for any
// product, not just this one -- so "has a portal_access_purchases row"
// is already exactly as strong a signal as the web side itself relies on;
// this function isn't weakening anything the web side guarantees.)
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)
//   APPLE_IAP_BUNDLE_ID, APPLE_IAP_PRODUCT_ID (same values as
//   mobile-iap-verify-purchase -- notifications about any other
//   bundle/product are acknowledged but never acted on)
//
// App Store Connect setup: Users and Access -> Integrations -> App
// Store Server Notifications -> Production/Sandbox URL, pointing at
// this function's deployed URL.
//
// NOT YET DEPLOYED -- see this project's Apple IAP implementation report.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyAndDecodeAppleSignedPayload, AppleSignedPayloadError } from '../_shared/appleIap/verifySignedPayload.ts'
import type { AppleResponseBodyV2DecodedPayload, AppleJWSTransactionDecodedPayload } from '../_shared/appleIap/types.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APPLE_BUNDLE_ID = Deno.env.get('APPLE_IAP_BUNDLE_ID')!
const APPLE_PRODUCT_ID = Deno.env.get('APPLE_IAP_PRODUCT_ID')!

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const REVOKING_TYPES = new Set(['REFUND', 'REVOKE'])

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const body = await req.json().catch(() => null)
    const signedPayload = body?.signedPayload
    if (!signedPayload || typeof signedPayload !== 'string') {
      return json({ error: 'Missing signedPayload' }, 400)
    }

    let notification: AppleResponseBodyV2DecodedPayload
    try {
      notification = await verifyAndDecodeAppleSignedPayload<AppleResponseBodyV2DecodedPayload>(signedPayload)
    } catch (err) {
      if (err instanceof AppleSignedPayloadError) {
        console.error('apple-app-store-notifications: signature/chain verification failed', err.message)
        return json({ error: 'Signature verification failed' }, 400)
      }
      throw err
    }

    if (!notification.notificationUUID || !notification.notificationType) {
      return json({ error: 'Malformed notification payload' }, 400)
    }

    // Record-then-act, same ordering as stripe-webhook's
    // stripe_webhook_events -- a unique violation here means this exact
    // delivery was already fully processed.
    const { error: logError } = await supabase.from('apple_server_notifications_log').insert({
      notification_uuid: notification.notificationUUID,
      notification_type: notification.notificationType,
      subtype: notification.subtype ?? null,
    })
    if (logError) {
      if (logError.code === '23505') return json({ status: 'already_processed' })
      console.error('apple-app-store-notifications: failed to log notification', logError)
      return json({ error: 'Internal error' }, 500)
    }

    // TEST notifications (App Store Connect's "Send Test Notification")
    // and every subscription-only type have nothing to act on for a
    // single non-consumable product -- acknowledging (200) after
    // logging is the whole job.
    if (!REVOKING_TYPES.has(notification.notificationType) && notification.notificationType !== 'REFUND_REVERSED') {
      return json({ status: 'acknowledged' })
    }

    const signedTransactionInfo = notification.data?.signedTransactionInfo
    if (!signedTransactionInfo) {
      return json({ status: 'acknowledged' })
    }

    let transaction: AppleJWSTransactionDecodedPayload
    try {
      transaction = await verifyAndDecodeAppleSignedPayload<AppleJWSTransactionDecodedPayload>(signedTransactionInfo)
    } catch (err) {
      console.error('apple-app-store-notifications: embedded transaction JWS failed verification', err)
      return json({ error: 'Signature verification failed' }, 400)
    }

    if (transaction.bundleId !== APPLE_BUNDLE_ID || transaction.productId !== APPLE_PRODUCT_ID) {
      // A notification about a different app/product sharing the same
      // Apple Developer account -- nothing for this function to do.
      return json({ status: 'acknowledged' })
    }
    if (!transaction.transactionId) {
      return json({ status: 'acknowledged' })
    }

    const { data: row } = await supabase
      .from('apple_iap_transactions')
      .select('id, profile_id, revoked_at')
      .eq('transaction_id', transaction.transactionId)
      .maybeSingle()

    if (!row) {
      // We never verified this transaction ourselves (e.g. it was
      // purchased but the client crashed before calling
      // mobile-iap-verify-purchase) -- nothing to revoke or restore.
      return json({ status: 'acknowledged' })
    }

    if (REVOKING_TYPES.has(notification.notificationType)) {
      if (row.revoked_at) return json({ status: 'already_revoked' })

      await supabase
        .from('apple_iap_transactions')
        .update({ revoked_at: new Date().toISOString(), revocation_reason: transaction.revocationReason ?? null })
        .eq('id', row.id)

      const hasOtherValidGrant = await profileHasAnotherValidGrant(supabase, row.profile_id, transaction.transactionId)
      if (!hasOtherValidGrant) {
        await supabase.from('profiles').update({ checkride_prep_unlocked: false }).eq('id', row.profile_id)
      }
      return json({ status: 'revoked' })
    }

    // REFUND_REVERSED -- Apple reversed an earlier refund. Re-activate
    // the transaction and re-grant access; if the account also has an
    // independent valid grant this is a harmless idempotent re-set.
    if (row.revoked_at) {
      await supabase.from('apple_iap_transactions').update({ revoked_at: null, revocation_reason: null }).eq('id', row.id)
    }
    await supabase.from('profiles').update({ checkride_prep_unlocked: true }).eq('id', row.profile_id)
    return json({ status: 'restored' })
  } catch (err) {
    console.error('apple-app-store-notifications error', err)
    return json({ error: 'Internal error' }, 500)
  }
})

// A profile keeps Checkride Prep access after one Apple transaction is
// revoked if EITHER another, still-valid Apple transaction belongs to
// them, OR they have any web/Stripe purchase on file at all
// (portal_access_purchases is append-only and never represents a
// refunded web purchase -- Stripe refunds are handled separately and
// don't delete that row, matching this codebase's existing Stripe
// refund-handling precedent elsewhere in this file family).
async function profileHasAnotherValidGrant(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  excludingTransactionId: string
): Promise<boolean> {
  const { data: otherAppleGrant } = await supabase
    .from('apple_iap_transactions')
    .select('id')
    .eq('profile_id', profileId)
    .is('revoked_at', null)
    .neq('transaction_id', excludingTransactionId)
    .limit(1)
    .maybeSingle()
  if (otherAppleGrant) return true

  const { data: webPurchase } = await supabase
    .from('portal_access_purchases')
    .select('id')
    .eq('profile_id', profileId)
    .limit(1)
    .maybeSingle()
  return !!webPurchase
}
