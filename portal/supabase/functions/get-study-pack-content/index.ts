// Serves protected Study Pack instructional content (lessons, scenarios,
// Checkride Corner, Mastery Check, Quick Reference) -- the actual
// server-side enforcement for Study Pack access. Mirrors
// get-premium-content's precedent exactly: nothing in this response
// reaches the browser unless the caller's own account has a real,
// non-revoked study_pack_entitlements row for the requested pack.
// Non-owners get a 403 with no content body at all, never a partial or
// redacted payload.
//
// verify_jwt=true (set via the Supabase dashboard/CLI for this function)
// means the platform already rejects a request with no valid JWT before
// this code even runs -- auth.getUser(token) below additionally
// identifies *which* profile is calling, which verify_jwt alone does not
// give us.
//
// Env vars required (set as Supabase Edge Function secrets):
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return jsonError('Missing Authorization header', 401)

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)

    const body = await req.json().catch(() => ({}))
    const packId = body.pack_id as string
    if (!packId) return jsonError('Missing pack_id', 400)

    // Service-role client, so this RPC call bypasses RLS entirely --
    // has_study_pack_entitlement() is the real, single-source-of-truth
    // check (same function submit_study_pack_attempt() etc. use), not a
    // duplicated inline query that could drift out of sync with it.
    const { data: entitled, error: entErr } = await supabase.rpc('has_study_pack_entitlement', {
      p_profile_id: userData.user.id,
      p_pack_id: packId,
    })
    if (entErr) throw entErr
    if (!entitled) return jsonError('This Study Pack is not unlocked on this account', 403)

    const { data: pack, error: packErr } = await supabase
      .from('study_packs')
      .select('id, published_version')
      .eq('id', packId)
      .maybeSingle()
    if (packErr) throw packErr
    if (!pack || !pack.published_version) return jsonError('This Study Pack has no published content yet', 404)

    const { data: version, error: versionErr } = await supabase
      .from('study_pack_versions')
      .select('content, version')
      .eq('pack_id', packId)
      .eq('version', pack.published_version)
      .eq('status', 'published')
      .maybeSingle()
    if (versionErr) throw versionErr
    if (!version) return jsonError('This Study Pack has no published content yet', 404)

    return new Response(JSON.stringify({ version: version.version, content: version.content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('get-study-pack-content error', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
