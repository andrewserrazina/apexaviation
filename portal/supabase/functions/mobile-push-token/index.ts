// Mobile push token -- register/list/revoke mobile_devices (v116) rows,
// plus (Sprint 1C Phase 9) get_preferences/update_preferences for the
// also-already-existing notification_preferences (v116) table.
// mobile_devices and notification_preferences both already carry
// self-scoped RLS ("auth.uid() = profile_id" for all), so a plain
// authenticated client (not service-role) is used here deliberately: RLS
// itself is the enforcement that a learner can only ever see or touch
// their own rows (Phase C10 requirement), not an extra check duplicated
// in this function's own code.
//
// DEPLOYED (version 2, register/revoke/list only) as of Sprint 1C. The
// get_preferences/update_preferences actions below are SOURCE-CONTROLLED
// ONLY -- deploying this file is a Sprint 1C stop gate; see the Sprint
// report for the exact backend deployment delta.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validatePreferencesUpdate } from './validatePreferencesUpdate.ts'

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

    // Sprint 1C Phase 9: notification_preferences (v116) already exists
    // in production with its own self-scoped RLS identical in shape to
    // mobile_devices' -- reuses the same auth-carrying `supabase` client
    // (never service_role) so RLS is what actually enforces "only your
    // own row," exactly like every other action in this function.
    // Identity comes ONLY from the verified JWT (`userId` above) -- no
    // caller-supplied profile_id is ever read from the body.
    if (action === 'get_preferences') {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('daily_drill_enabled, daily_drill_time, checkride_countdown_enabled, weak_area_enabled, streak_enabled')
        .eq('profile_id', userId)
        .maybeSingle()
      if (error) throw error
      // No row yet is a normal, expected state (no insert trigger creates
      // one on signup) -- returns the exact same defaults the v116
      // migration itself declares on the table, never a client-invented
      // value, and never writes a row just because it was read.
      const preferences = data ?? {
        daily_drill_enabled: true,
        daily_drill_time: '07:00:00',
        checkride_countdown_enabled: true,
        weak_area_enabled: true,
        streak_enabled: true,
      }
      return json({ preferences })
    }

    if (action === 'update_preferences') {
      // Rev2 (independent review): validated by a dependency-free module
      // (validatePreferencesUpdate.ts) specifically so this decision
      // logic is directly unit-testable under plain Node -- see
      // test/mobile_push_token_validatePreferencesUpdate.test.mjs. Each
      // boolean field must be a real boolean when supplied (an explicit
      // null is rejected, not silently dropped); daily_drill_time must
      // match a valid 24-hour time; a body with no recognized fields (or
      // only unknown ones, which are never read at all) is a clean 400.
      const validation = validatePreferencesUpdate(body)
      if (!validation.ok) return json({ error: validation.error }, 400)

      // Upsert-safe merge: PostgREST's upsert only sets the columns
      // actually present in this payload, so an existing row's untouched
      // fields are left exactly as they were, and a brand-new row picks
      // up the table's own column defaults for every field this request
      // didn't send -- never a client-invented default.
      const { data, error } = await supabase
        .from('notification_preferences')
        .upsert({ profile_id: userId, ...validation.update }, { onConflict: 'profile_id' })
        .select('daily_drill_enabled, daily_drill_time, checkride_countdown_enabled, weak_area_enabled, streak_enabled')
        .single()
      if (error) throw error
      return json({ preferences: data })
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
