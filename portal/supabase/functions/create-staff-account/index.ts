// Admin-initiated student/instructor account creation for the internal
// React admin app (portal/src/pages/Students.jsx, Instructors.jsx).
//
// Replaces a client-side `supabase.auth.signUp()` call that ran from the
// admin's own browser session. Because signUp() persists the newly
// created user's session and fires the SDK's global onAuthStateChange
// listener before the caller's later `setSession(adminSession)` restore
// completes, AuthContext (a single, unconditional listener with no
// suppression guard) could briefly authenticate the whole admin app as
// the brand-new, profile-less student/instructor. That's a real,
// reproducible race (supabase-js dispatches auth events via a deferred
// microtask, and setSession() itself performs an async round trip),
// not just a theoretical one -- found in a repo-wide bug sweep.
//
// This function eliminates the race structurally rather than trying to
// win it: `supabase.auth.admin.createUser()` runs entirely server-side
// under the service-role key and never touches the calling browser's
// session at all, so there is nothing for the admin's AuthContext to
// react to. Modeled on create-free-account/index.ts's use of the same
// admin.createUser() call, trimmed to what an admin-created staff
// account actually needs (no welcome email / UTM / referral machinery --
// this isn't a self-service signup).
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

// Deliberately only the two roles Students.jsx/Instructors.jsx actually
// create through this path -- granting 'admin' or 'office_manager' is a
// materially different, higher-privilege operation and stays outside
// this function's scope rather than being exposed via a caller-supplied
// role string.
const ALLOWED_ROLES = ['student', 'instructor']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Caller must be an authenticated admin -- this function runs under
    // the service-role key (bypasses RLS entirely), so this check is the
    // ONLY authorization boundary standing between "any logged-in member"
    // and "can create staff accounts." Mirrors delete-account/index.ts's
    // pattern for resolving the caller's identity from their own JWT via
    // a service-role client (works because service-role can validate any
    // token), extended here with an explicit admin-role check since
    // delete-account is self-service and this is not.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return jsonError('Missing Authorization header', 401)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: callerData, error: callerErr } = await supabase.auth.getUser(token)
    if (callerErr || !callerData?.user) return jsonError('Invalid or expired session', 401)

    const { data: isAdmin, error: isAdminErr } = await supabase.rpc('is_admin', { p_uid: callerData.user.id })
    if (isAdminErr || !isAdmin) return jsonError('Admin access required', 403)

    const { email, full_name, password, role, certificate_status, medical_expiry, certificates, bio } = await req.json()
    if (!email || !full_name || !password) {
      return jsonError('Missing required fields: email, full_name, password', 400)
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return jsonError(`role must be one of: ${ALLOWED_ROLES.join(', ')}`, 400)
    }

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existingProfile) {
      return jsonError('An account with this email already exists.', 409)
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (createErr || !created?.user) return jsonError(createErr?.message ?? 'Failed to create account', 500)

    // Role-specific fields, same shape as the two callers' previous
    // client-side .update() calls -- role is set here under the
    // service-role client, which lock_profile_privileged_columns()
    // (supabase-portal-schema-v8/v16.sql) already exempts from its
    // non-admin reset logic.
    const profileUpdate: Record<string, unknown> = { full_name, role }
    if (role === 'student') {
      profileUpdate.certificate_status = certificate_status || null
      profileUpdate.medical_expiry = medical_expiry || null
    } else if (role === 'instructor') {
      profileUpdate.certificates = certificates || null
      profileUpdate.bio = bio || null
    }

    const { error: profileErr } = await supabase.from('profiles').update(profileUpdate).eq('id', created.user.id)
    if (profileErr) {
      // The auth user already exists at this point -- surface the real
      // error rather than silently leaving a role-less orphan profile,
      // same "don't claim success on a partial failure" principle as
      // create-free-account's missing-action-link handling.
      return jsonError('Account created but profile setup failed: ' + profileErr.message, 500)
    }

    return new Response(JSON.stringify({ ok: true, id: created.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return jsonError(String(err), 500)
  }
})
