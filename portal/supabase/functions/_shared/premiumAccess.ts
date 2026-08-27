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

export interface CapabilityResult {
  userId: string
  email: string | null
}

// For features gated by the broader capability model (get_member_capabilities(),
// supabase-portal-schema-v51.sql) rather than the single checkride_prep_unlocked
// flag above -- e.g. Membership-exclusive features like Ask Andrew. Verifies the
// bearer token identifies a real session, then checks that session's own
// capability set server-side; never trusts a client-supplied profile id or a
// client-supplied claim of entitlement.
export async function requireCapability(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  capability: string,
  deniedMessage: string
): Promise<CapabilityResult> {
  const token = (authHeader || '').replace('Bearer ', '').trim()
  if (!token) throw new PremiumAccessError('Missing Authorization header', 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) throw new PremiumAccessError('Invalid or expired session', 401)

  const { data: capRows, error: capErr } = await supabase.rpc('get_member_capabilities', {
    p_profile_id: userData.user.id,
  })
  if (capErr) throw capErr

  const has = (capRows || []).some((r: { capability: string }) => r.capability === capability)
  if (!has) throw new PremiumAccessError(deniedMessage, 403)

  return { userId: userData.user.id, email: userData.user.email ?? null }
}

// For Ground School module companion content (module_companion_content,
// module_quiz_questions) -- entitlement here is per-module, not the
// single flat checkride_prep_unlocked flag: a member either bought the
// full private_pilot_ground_school_pack_unlocked, or paid individually
// for this specific module's scheduled class (scheduled_ground_class_
// enrollments, payment_status in ('paid','ground_school_pack'), joined
// through scheduled_ground_classes.lesson_id -- the same real curriculum
// module id used everywhere else, e.g. 'PPL-M01'). Mirrors the client's
// own hasModuleAccess() (site/portal-stable.js) exactly, but this is the
// actual security boundary -- that client check is UI convenience only.
export async function requireModuleAccess(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  moduleId: string
): Promise<CapabilityResult> {
  const token = (authHeader || '').replace('Bearer ', '').trim()
  if (!token) throw new PremiumAccessError('Missing Authorization header', 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) throw new PremiumAccessError('Invalid or expired session', 401)

  const [{ data: profile }, { data: enrollmentRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('private_pilot_ground_school_pack_unlocked')
      .eq('id', userData.user.id)
      .maybeSingle(),
    supabase
      .from('scheduled_ground_class_enrollments')
      .select('id, payment_status, scheduled_ground_classes!inner(lesson_id)')
      .eq('profile_id', userData.user.id)
      .eq('scheduled_ground_classes.lesson_id', moduleId)
      .in('payment_status', ['paid', 'ground_school_pack'])
      .limit(1),
  ])

  const unlocked = !!profile?.private_pilot_ground_school_pack_unlocked || !!enrollmentRows?.length
  if (!unlocked) throw new PremiumAccessError('This Ground School module is not unlocked on this account', 403)

  return { userId: userData.user.id, email: userData.user.email ?? null }
}
