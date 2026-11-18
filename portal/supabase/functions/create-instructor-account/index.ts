// Creates a new instructor account from the Operations Portal's
// People > Instructors "+ Add Instructor" form.
//
// Previously this ran entirely client-side: Instructors.jsx called
// supabase.auth.signUp() directly from the logged-in admin's own
// browser session, then tried to restore the admin's session
// afterward and patch the new profile's role via a plain .update()
// whose error was never checked. signUp() from an already-
// authenticated client can swap the active session over to the
// brand-new (role='student', un-elevated) user before the restore
// call resolves -- when that happens, the follow-up profiles update
// silently affects zero rows under RLS ("Admins can update profiles"
// is admin-only), and the browser discarded that error entirely, so
// the UI always closed the modal and reloaded the list as if it had
// worked. That's the bug this exists to fix: create the account
// server-side with the service role key, the same pattern already
// used by create-free-account/delete-account, so there's no browser
// session to hijack and no error path that goes unchecked.
//
// Privileged, NOT public -- unlike capture-waitlist-lead/create-free-
// account, this creates a real staff account with portal access, so
// the caller's own session is verified as an admin before anything
// happens.
//
// Env vars required (auto-provided by Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

// Same wildcard-escaping reasoning as capture-waitlist-lead/create-free-
// account's own escapeIlike() -- duplicated here since these functions
// share no module today.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return jsonError('Missing Authorization header', 401)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // The caller must be a signed-in admin. supabase.functions.invoke()
    // forwards the caller's own current session as this bearer token by
    // default, so this is the acting admin's real session, not a
    // service-level credential -- verified against auth.users (not just
    // decoded) via getUser(), then cross-checked against profiles.role
    // the same way every other admin-only check in this codebase reads
    // role (is_admin(auth.uid()) at the RLS layer; a plain profiles
    // lookup here since Edge Functions run outside RLS as the service
    // role).
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return jsonError('Invalid or expired session', 401)
    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (callerErr || callerProfile?.role !== 'admin') return jsonError('Only an admin can add instructors', 403)

    const { full_name, email, password, certificates, bio } = await req.json()
    const safeName = typeof full_name === 'string' ? full_name.trim() : ''
    const safeEmail = typeof email === 'string' ? email.trim() : ''
    const safePassword = typeof password === 'string' ? password : ''
    if (!safeName || !safeEmail || safePassword.length < 6) {
      return jsonError('Full name, email, and a password of at least 6 characters are required', 400)
    }

    // Same case-insensitive duplicate check as create-free-account's own
    // (and for the same reason) -- auth.admin.createUser() below would
    // otherwise fail with Supabase Auth's own less-friendly duplicate
    // error.
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', escapeIlike(safeEmail))
      .maybeSingle()
    if (existingProfile) return jsonError('An account with this email already exists.', 409)

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: safeEmail,
      password: safePassword,
      email_confirm: true,
      user_metadata: { full_name: safeName },
    })
    if (createErr) return jsonError(createErr.message, 400)

    // handle_new_user() (supabase-schema.sql) already inserted a profiles
    // row for the new auth user with role='student' (its own column
    // default) -- this promotes it to instructor and fills in the
    // instructor-only fields the form collected. Run with the service
    // role, so no admin-session RLS race is possible here.
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        full_name: safeName,
        role: 'instructor',
        certificates: typeof certificates === 'string' && certificates ? certificates : null,
        bio: typeof bio === 'string' && bio ? bio : null,
      })
      .eq('id', created.user.id)
    if (profileErr) {
      // The auth user now exists but couldn't be promoted to instructor --
      // surface this instead of letting the caller believe it worked.
      return jsonError('Account created but could not be set up as an instructor: ' + profileErr.message, 500)
    }

    return new Response(JSON.stringify({ ok: true, id: created.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return jsonError(String(err), 500)
  }
})
