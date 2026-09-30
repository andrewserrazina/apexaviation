// Serves the Checkride Binder Builder's authored reference content (20
// sections' checklist-item labels, tips, and FAA source citations,
// transcribed from the source workbook PDF). Real server-side
// enforcement, same trust model as get-premium-content/get-module-
// companion-content: nothing in this response reaches the browser
// unless requirePremiumAccess() confirms the caller's own account has
// checkride_prep_unlocked = true (or a portal_access_purchases row) --
// an unentitled caller gets a 403 with no content body at all. This
// content IS the paid material (like Ground School's module_companion_
// content), so checkride_binder_content has no client SELECT grant at
// all -- this function is the only way it's ever reached.
//
// Env vars required (set as Supabase Edge Function secrets):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined (not imported from ../_shared/premiumAccess.ts) because the
// Supabase deploy path used for this function cannot resolve a relative
// import that reaches outside this function's own directory -- same
// issue and same fix as get-module-companion-content/create-checkout-
// session's own inlining. Kept identical in name and logic to _shared/
// premiumAccess.ts's requirePremiumAccess()/PremiumAccessError -- this
// is the SAME canonical Checkride Prep entitlement check get-premium-
// content already uses, not a new one, just duplicated here for the
// same deploy-path reason. Must be kept in sync if that file ever
// changes.
class PremiumAccessError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

interface AccessResult {
  userId: string
  email: string | null
}

async function requirePremiumAccess(
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

  const unlocked = !!profile?.checkride_prep_unlocked || !!purchaseRows?.length
  if (!unlocked) throw new PremiumAccessError('Checkride Prep is not unlocked on this account', 403)

  return { userId: userData.user.id, email: userData.user.email ?? null }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    await requirePremiumAccess(supabase, req.headers.get('Authorization'))

    // The whole workbook is small and bounded (20 sections) -- return
    // every section in one call rather than one request per section, the
    // same one-shot shape get-premium-content already uses for the DPE
    // library.
    const { data, error } = await supabase
      .from('checkride_binder_content')
      .select('section_id, content')
      .order('section_id')

    if (error) throw error

    const sections: Record<string, unknown> = {}
    for (const row of data || []) sections[row.section_id as string] = row.content

    return new Response(JSON.stringify({ sections }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.error('get-checkride-binder-content error', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
