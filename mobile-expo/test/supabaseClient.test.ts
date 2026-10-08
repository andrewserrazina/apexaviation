// Regression test for the verified TestFlight startup crash: lib/
// supabase.ts used to `throw` at module-evaluation time whenever
// EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY were missing.
// Since that import chain runs before app/_layout.tsx's own first line
// of code (imports are fully evaluated before a module's own top-level
// statements run), this threw before SplashScreen.preventAutoHideAsync()
// was ever reached -- an unrecoverable crash with no React error
// boundary able to catch it. This test exercises the REAL module (not a
// mock -- every other test file in this suite jest.mock()s lib/supabase,
// which is exactly why 631 previously-passing tests never caught this)
// under both the broken and working environments, proving the fix: the
// module must never throw on import regardless of env var state.
//
// EXPO_PUBLIC_* values are read live via process.env at module-execution
// time under plain `jest` (confirmed empirically: deleting the env var
// immediately before a fresh require() reliably reproduces/un-reproduces
// the throw) -- unlike a real `eas build`/`expo start`, where Expo's own
// tooling inlines them at bundle time. jest.resetModules() forces a
// fresh evaluation of lib/supabase.ts on each require() below.
//
// This is the one test file that requires the REAL lib/supabase.ts (every
// other file jest.mock()s it -- see those files' own "AsyncStorage chain"
// comments -- which is exactly why 631 previously-passing tests never
// caught this). jest.resetModules() also clears Jest's own module
// registry for @react-native-async-storage/async-storage, so the official
// mock below (same one AuthContext.test.tsx already uses) has to be
// installed via jest.mock(), not just relied on from setup -- otherwise
// lib/supabase.ts -> lib/largeSecureStore.ts's real import of that
// package hits its actual native module, which doesn't exist here.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

describe('lib/supabase.ts: never throws at import time regardless of env var state', () => {
  const ORIGINAL_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  const ORIGINAL_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL
    else process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGINAL_URL
    if (ORIGINAL_ANON_KEY === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_ANON_KEY
    jest.resetModules()
  })

  it('does not throw, and reports isSupabaseConfigured=false, when both env vars are missing (the verified crash condition)', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    jest.resetModules()

    let mod: typeof import('../lib/supabase')
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../lib/supabase')
    }).not.toThrow()

    expect(mod!.isSupabaseConfigured).toBe(false)
    expect(mod!.supabase).toBeTruthy()
  })

  it('does not throw, and reports isSupabaseConfigured=false, when only one of the two env vars is missing', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    jest.resetModules()

    let mod: typeof import('../lib/supabase')
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../lib/supabase')
    }).not.toThrow()

    expect(mod!.isSupabaseConfigured).toBe(false)
  })

  it('reports isSupabaseConfigured=true and constructs a real client when both env vars are present', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    jest.resetModules()

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: typeof import('../lib/supabase') = require('../lib/supabase')

    expect(mod.isSupabaseConfigured).toBe(true)
    expect(mod.supabase).toBeTruthy()
  })
})
