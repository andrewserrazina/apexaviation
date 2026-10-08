// Apex Advantage mobile Supabase client -- the ONE place the app talks to
// the production project (wqzfhcjsfzwrimvsudxy). Only the client-safe
// publishable/anon key is ever used here; every Edge Function call still
// re-verifies the caller's own JWT + entitlement server-side (see
// portal/supabase/functions/*), so this key alone can never grant access
// to anything.
import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import { LargeSecureStore } from './largeSecureStore'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

// TestFlight startup crash (verified): this module used to `throw` here
// when either env var was missing. EXPO_PUBLIC_* values are inlined at
// BUILD time, not read from the device at runtime -- if the EAS build
// profile that produced a given binary had no EXPO_PUBLIC_SUPABASE_URL/
// _ANON_KEY configured, every install of that binary has these as
// `undefined`, permanently. The throw ran during this module's very
// first evaluation, which happens as part of app/_layout.tsx's own
// import chain (_layout.tsx -> contexts/AuthContext.tsx -> this file) --
// BEFORE _layout.tsx's own first line of code runs (a module's imports
// are fully evaluated before its own top-level statements), so
// SplashScreen.preventAutoHideAsync() was never even reached. That
// crashed the app outright during what looks like the native launch/
// splash screen, with no React error boundary able to catch it (error
// boundaries only catch errors thrown during render, never ones thrown
// while a module is first being imported) -- matching the reported
// "crashes during loading" symptom exactly.
//
// Fixed by never throwing here. `isSupabaseConfigured` lets the root
// layout render a clear, recoverable configuration-error screen instead
// of a hard crash if this ever happens again (e.g. a future build
// profile misconfiguration).
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  // __DEV__ is always true under Jest (and in `expo start`), so this
  // never fires in a production bundle -- intentional: the condition
  // that triggers it IS a misconfigured production bundle, and
  // console.error there would just be silently dropped with no one to
  // read it. The root layout's configuration-error screen is what a real
  // user/tester/Apple reviewer actually sees in that case.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error(
      '[apex-advantage-mobile] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in the project URL and publishable key.'
    )
  }
}

// Placeholder values when unconfigured -- createClient() only requires
// non-empty strings to construct successfully; it never contacts the
// network until a real auth/query call is made. Every such call then
// fails through this app's existing, already-handled ApiError/
// networkError paths (lib/api/errors.ts) exactly like any other offline
// failure -- but in practice the root layout never renders past the
// configuration-error screen when unconfigured, so no screen ever
// reaches the point of calling this client for real.
export const supabase = createClient(supabaseUrl || 'https://placeholder.invalid', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar to parse a magic-link/OAuth redirect
    // fragment from -- this app doesn't use either flow in Sprint 1A, and
    // leaving detection on would make supabase-js scan `window.location`,
    // which doesn't meaningfully exist in this environment.
    detectSessionInUrl: false,
  },
})
