// Self-service account deletion for the Apex Advantage member portal.
//
// Required for App Store submission: Apple's App Store Review Guideline
// 5.1.1(v) requires any app that supports account creation to also offer
// account deletion inside the app, not just deactivation. Nothing in this
// codebase implemented that before this function.
//
// Design note -- anonymize + soft-delete, not a hard cascading delete of
// the profiles row:
//
// profiles.id references auth.users(id) on delete cascade, so deleting the
// auth user WOULD cascade-delete profiles. But not every table that
// references profiles(id) uses `on delete cascade` or `on delete set
// null` -- several (see supabase-portal-schema-v3/v26/v31/v39.sql) have no
// ON DELETE clause at all, which defaults to RESTRICT. A hard delete
// would therefore risk failing outright on a foreign-key violation in
// production, and this sandbox has no live database to verify the full
// cascade graph against before shipping something this irreversible.
//
// Instead: scrub identity fields on profiles in place, hard-delete rows
// that hold genuinely sensitive free-text content (AI chat transcripts,
// Guided Notes responses, testimonials, question-discussion messages),
// cancel any active Stripe subscription, and soft-delete the auth user
// (auth.admin.deleteUser(id, true) -- disables login without triggering
// the row-level cascade). Financial/business records (purchases,
// invoices, ground school attendance) are deliberately retained under the
// now-anonymized profile id, matching standard "right to be forgotten"
// practice: personal identity is erased, necessary business/legal records
// are kept pseudonymously.
//
// Env vars required (set as Supabase Edge Function secrets):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=denonext'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return jsonError('Missing Authorization header', 401)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)
    const userId = userData.user.id

    // Cancel any active/trialing/past-due subscription immediately
    // (not at period end -- the account is being removed entirely).
    // Best-effort: a Stripe failure here shouldn't block the rest of
    // deletion, since a canceled account with a stray Stripe subscription
    // is a recoverable support issue, but a half-deleted account is worse.
    const { data: subscriptions } = await supabase
      .from('member_subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('profile_id', userId)
      .in('status', ['active', 'trialing', 'past_due'])

    for (const sub of subscriptions || []) {
      if (!sub.stripe_subscription_id) continue
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id)
      } catch (err) {
        console.error('delete-account: failed to cancel Stripe subscription', sub.stripe_subscription_id, String(err))
      }
    }

    // Hard-delete rows holding genuinely sensitive free-text personal
    // content -- these have no downstream dependents, so straightforward
    // profile_id-scoped deletes are safe.
    const contentTables = ['ai_cfi_messages', 'ai_dpe_sessions', 'guided_notes', 'portal_question_discussions', 'portal_testimonials']
    for (const table of contentTables) {
      const { error } = await supabase.from(table).delete().eq('profile_id', userId)
      if (error) console.error(`delete-account: failed to clear ${table}`, error.message)
    }

    // Scrub identity fields on the profile itself. email is nullable with
    // no unique constraint (supabase-schema.sql), so a randomized
    // placeholder is safe and prevents any future signup collision.
    const anonEmail = `deleted-${userId}@apexaviationtx.invalid`
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        full_name: 'Deleted User',
        email: anonEmail,
        certificate_status: null,
        checkride_timing: null,
        next_rating_interest: null,
        medical_expiry: null,
      })
      .eq('id', userId)
    if (profileErr) return jsonError('Failed to anonymize profile: ' + profileErr.message, 500)

    // Soft-delete: disables login permanently without triggering the
    // profiles.id -> auth.users(id) on-delete-cascade chain, which this
    // function deliberately avoids (see header comment).
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId, true)
    if (authErr) return jsonError('Failed to disable account: ' + authErr.message, 500)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return jsonError(String(err), 500)
  }
})
