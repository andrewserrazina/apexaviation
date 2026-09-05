// Mobile push token -- register/list/revoke mobile_devices (v116) rows.
// mobile_devices already carries self-scoped RLS ("auth.uid() = profile_id"
// for all), so a plain authenticated client (not service-role) is used
// here deliberately: RLS itself is the enforcement that a learner can
// only ever see or touch their own device rows (Phase C10 requirement),
// not an extra check duplicated in this function's own code.
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

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing Authorization header' }, 401)

  // Auth-carrying client: RLS on mobile_devices (auth.uid() = profile_id)
  // is the real enforcement boundary here, so every query below runs as
  // the calling learner, never service_role.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { data: userData, error: userErr } = await serviceClient.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Invalid or expired session' }, 401)
    const userId = userData.user.id

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'register') {
      const platform = body?.platform
      const expoPushToken = body?.expo_push_token
      if (platform !== 'ios' && platform !== 'android') return json({ error: 'platform must be ios or android' }, 400)
      if (!expoPushToken || typeof expoPushToken !== 'string') return json({ error: 'expo_push_token is required' }, 400)

      const { data, error } = await supabase
        .from('mobile_devices')
        .upsert(
          {
            profile_id: userId,
            platform,
            expo_push_token: expoPushToken,
            installation_id: typeof body?.installation_id === 'string' ? body.installation_id : null,
            app_version: typeof body?.app_version === 'string' ? body.app_version : null,
            last_seen_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: 'profile_id,expo_push_token' }
        )
        .select('id, platform, expo_push_token, installation_id, app_version, last_seen_at, created_at')
        .single()
      if (error) throw error
      return json({ device: data })
    }

    if (action === 'revoke') {
      const deviceId = body?.device_id
      if (!deviceId) return json({ error: 'device_id is required' }, 400)
      // Goes through the RPC (not a raw UPDATE) so revocation keeps one
      // unambiguous meaning regardless of client version -- see
      // revoke_mobile_device()'s own comment in v116.
      const { data, error } = await supabase.rpc('revoke_mobile_device', { p_device_id: deviceId })
      if (error) throw error
      return json({ device: data })
    }

    // Default action: list this learner's own non-revoked devices.
    const { data, error } = await supabase
      .from('mobile_devices')
      .select('id, platform, installation_id, app_version, last_seen_at, created_at')
      .eq('profile_id', userId)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: false })
    if (error) throw error
    return json({ devices: data || [] })
  } catch (err) {
    console.error('mobile-push-token error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
