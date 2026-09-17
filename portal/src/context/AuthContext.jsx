import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isStaleRefreshTokenError } from '../lib/authErrors'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Guards against two fetchProfile() calls resolving out of order (e.g. a
  // sign-out immediately followed by a sign-in on a shared device, or the
  // admin signUp()/setSession() session swap in Students.jsx) -- only the
  // response matching the most recently requested user id is ever applied.
  const latestUserIdRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()

        // A stale/invalid refresh token (Phase 9B: production
        // refresh_token_not_found failures) can never succeed again.
        // Clear only THIS browser/device's local Supabase auth state so
        // the user lands on a normal signed-out screen -- scope: 'local'
        // never touches their session on any other device.
        if (error && isStaleRefreshTokenError(error)) {
          try {
            await supabase.auth.signOut({ scope: 'local' })
          } catch {
            // Best-effort cleanup -- local state is reset below regardless
            // of whether this network call itself succeeds.
          }
          if (!cancelled) {
            setUser(null)
            setProfile(null)
          }
          return
        }

        // Any other error (a network hiccup, a momentary Auth outage) is
        // NOT a stale session. Signing the user out here would punish them
        // for a transient connectivity problem instead of an actually-dead
        // credential, so fall through and use whatever getSession()
        // returned -- it may still hand back a valid, non-expired session
        // alongside a non-fatal error.
        if (cancelled) return
        setUser(session?.user ?? null)
        if (session?.user) await fetchProfile(session.user.id)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialize()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (session?.user) {
        // Without this, `loading` stays false (from the initial mount
        // already resolving) while fetchProfile() is still in flight, so a
        // consumer reading `profile` right after sign-in sees stale/null
        // data under a "not loading" flag -- e.g. PortalSelector defaulting
        // an admin's role to 'student' and bouncing them out of the app
        // before their real profile has loaded.
        setLoading(true)
        fetchProfile(session.user.id)
      } else {
        latestUserIdRef.current = null
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function fetchProfile(userId) {
    latestUserIdRef.current = userId
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    // A later fetchProfile() call for a different user may have already
    // superseded this one by the time it resolves -- discard this result
    // rather than let whichever request happens to finish last win.
    if (latestUserIdRef.current !== userId) return
    setProfile(data)
    setLoading(false)
  }

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signOut() {
    return supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
