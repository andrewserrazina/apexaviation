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

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in the project URL and publishable key.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
