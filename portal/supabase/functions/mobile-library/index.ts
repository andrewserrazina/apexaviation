// Mobile library -- Study Pack browsing + entitled content, action-routed.
// Per Phase C9: the server decides entitlement, never the client -- the
// app never sends "I own this pack," it sends a pack_id and this
// function checks has_study_pack_entitlement() itself, the exact same
// RPC get-study-pack-content already uses for the web portal. No new
// entitlement logic, no duplicate table -- this only reshapes the
// existing Study Pack model for a mobile client.
//
// NOT YET DEPLOYED. Source-controlled only.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
    const userId = userData.user.id

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'content') {
      const packId = body?.pack_id
      if (!packId) return json({ error: 'pack_id is required' }, 400)

      const { data: entitled, error: entErr } = await supabase.rpc('has_study_pack_entitlement', {
        p_profile_id: userId,
        p_pack_id: packId,
      })
      if (entErr) throw entErr
      if (!entitled) return json({ error: 'This Study Pack is not unlocked on this account' }, 403)

      const { data: pack, error: packErr } = await supabase
        .from('study_packs')
        .select('id, published_version')
        .eq('id', packId)
        .maybeSingle()
      if (packErr) throw packErr
      if (!pack?.published_version) return json({ error: 'This Study Pack has no published content yet' }, 404)

      const { data: version, error: versionErr } = await supabase
        .from('study_pack_versions')
        .select('content, version')
        .eq('pack_id', packId)
        .eq('version', pack.published_version)
        .eq('status', 'published')
        .maybeSingle()
      if (versionErr) throw versionErr
      if (!version) return json({ error: 'This Study Pack has no published content yet' }, 404)

      return json({ version: version.version, content: version.content })
    }

    // Default action: catalog -- every active pack, with this learner's
    // own entitlement status attached, so the app can render "Owned" vs.
    // "Buy" without a second round trip. Catalog fields only (name,
    // subtitle, price) -- never study_pack_versions.content, which is
    // gated behind the 'content' action above regardless of ownership
    // shown here.
    const [{ data: packs, error: packsErr }, { data: owned, error: ownedErr }] = await Promise.all([
      supabase
        .from('study_packs')
        .select('id, name, subtitle, price_cents, currency, certificate_type, estimated_minutes_min, estimated_minutes_max, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('study_pack_entitlements')
        .select('pack_id')
        .eq('profile_id', userId)
        .is('revoked_at', null),
    ])
    if (packsErr) throw packsErr
    if (ownedErr) throw ownedErr

    const ownedIds = new Set((owned || []).map((r: { pack_id: string }) => r.pack_id))
    const catalog = (packs || []).map((p) => ({ ...p, owned: ownedIds.has(p.id) }))

    return json({ packs: catalog })
  } catch (err) {
    console.error('mobile-library error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
