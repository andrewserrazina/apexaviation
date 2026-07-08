// Centralized premium-access verification for the Apex Advantage portal.
//
// Never trust client-side state for whether a member has paid — every
// Edge Function that serves or mutates premium (Checkride Prep) data
// must verify access through this module: the caller's authenticated
// Supabase session, cross-checked against the profiles.checkride_prep_unlocked
// database record. There is no third factor to check against Stripe
// directly at request time — the webhook is the only writer of that
// flag, so the flag itself is the source of truth already reconciled
// against Stripe's own checkout.session.completed event.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export class PremiumAccessError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

export interface AccessResult {
  userId: string
  email: string | null
  unlocked: boolean
}

// Verifies the bearer token identifies a real, current session and
// returns whether that user has paid for Checkride Prep access. Throws
// PremiumAccessError (401) if the token is missing/invalid — callers
// that need to distinguish "not logged in" from "logged in but not
// unlocked" should catch and inspect requireUnlocked separately.
export async function hasPremiumAccess(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null
): Promise<AccessResult> {
  const token = (authHeader || '').replace('Bearer ', '').trim()
  if (!token) throw new PremiumAccessError('Missing Authorization header', 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) throw new PremiumAccessError('Invalid or expired session', 401)

  const [{ data: profile }, { data: purchaseRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('checkride_prep_unlocked')
      .eq('id', userData.user.id)
      .maybeSingle(),
    supabase
      .from('portal_access_purchases')
      .select('id')
      .eq('profile_id', userData.user.id)
      .limit(1),
  ])

  return {
    userId: userData.user.id,
    email: userData.user.email ?? null,
    unlocked: !!profile?.checkride_prep_unlocked || !!purchaseRows?.length,
  }
}

// Same as hasPremiumAccess, but throws a 403 PremiumAccessError if the
// verified member hasn't unlocked Checkride Prep. Use this at the top of
// any function that must never return premium data to a non-payer.
export async function requirePremiumAccess(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null
): Promise<AccessResult> {
  const result = await hasPremiumAccess(supabase, authHeader)
  if (!result.unlocked) throw new PremiumAccessError('Checkride Prep is not unlocked on this account', 403)
  return result
}
