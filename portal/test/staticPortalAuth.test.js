// Phase 9B.1 -- tests for site/portal-stable.js's auth-guard bootstrap.
//
// site/portal-stable.js is a classic non-module browser script with no
// build tooling of its own (no package.json under site/) -- rather than
// introduce a bundler/framework there just to make it importable, this
// extracts the ACTUAL auth-guard source between two stable anchor
// comments/lines directly out of the real shipped file at test-run time,
// and executes that exact source in a sandboxed vm context with mocked
// apexSupabase/window globals. This tests the real production code (no
// hand-copied reimplementation that could silently drift from it), while
// keeping site/ itself free of any new tooling.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const STATIC_PORTAL_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../site/portal-stable.js'
)
const fullSource = readFileSync(STATIC_PORTAL_JS, 'utf8')

const START_MARKER = '/* ── Auth guard — real Supabase session + profile ────────────── */'
const END_MARKER = "}).catch(function (e) { if (e !== 'no-session') console.error(e); });"

function extractAuthGuardSource() {
  const startIdx = fullSource.indexOf(START_MARKER)
  if (startIdx === -1) {
    throw new Error('START_MARKER not found in site/portal-stable.js -- the auth guard block may have moved or been reworded; update this test to match.')
  }
  const endIdx = fullSource.indexOf(END_MARKER, startIdx)
  if (endIdx === -1) {
    throw new Error('END_MARKER not found in site/portal-stable.js -- the auth guard block may have moved or been reworded; update this test to match.')
  }
  return fullSource.slice(startIdx, endIdx + END_MARKER.length)
}

// The extracted block calls a handful of functions defined elsewhere in
// the real file (populateMember, loadPremiumContent, etc.) once a real
// session is found -- these are stubbed here by name since pulling in the
// other ~8,000 lines of DOM-bound portal UI code is out of scope for
// testing the auth-guard branching logic itself.
function runAuthGuard({ getSessionResult, search = '', hash = '' }) {
  const getSessionMock = vi.fn().mockResolvedValue(getSessionResult)
  const signOutMock = vi.fn().mockResolvedValue({ error: null })
  const singleMock = vi.fn().mockResolvedValue({ data: { id: 'member-1', full_name: 'Test Member' } })
  const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null })

  const apexSupabase = {
    auth: { getSession: getSessionMock, signOut: signOutMock },
    from: () => ({
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: () => ({ eq: updateEqMock }),
    }),
    rpc: () => rpcMock(),
  }

  const windowStub = { location: { search, hash, href: '' } }

  const sandbox = {
    apexSupabase,
    window: windowStub,
    URLSearchParams,
    Promise,
    console,
    // Downstream functions the "session present" branch calls, defined
    // elsewhere in the real file -- stubbed as no-ops for this test.
    populateMember: vi.fn(),
    applyUnlockState: vi.fn(),
    applyUnlockPricing: vi.fn(),
    loadMemberReadinessContext: vi.fn(),
    loadPremiumContent: vi.fn().mockResolvedValue(undefined),
    loadMembershipCapability: vi.fn().mockResolvedValue(undefined),
    initPortalData: vi.fn().mockResolvedValue(undefined),
  }
  vm.createContext(sandbox)
  vm.runInContext(extractAuthGuardSource(), sandbox)

  return {
    window: windowStub,
    getSessionMock,
    signOutMock,
    authReadyPromise: sandbox.authReady,
  }
}

function authApiError(code, message = 'Invalid Refresh Token') {
  return { name: 'AuthApiError', status: 400, code, message }
}

describe('site/portal-stable.js auth guard (real shipped source)', () => {
  it('A: a valid session continues the existing bootstrap with no local signOut', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: { access_token: 'tok', user: { id: 'member-1', email: 'm@test.local' } } }, error: null },
    })
    await authReadyPromise
    expect(signOutMock).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('B: ordinary no-session produces the existing login redirect with no query params', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: null },
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).not.toHaveBeenCalled()
    expect(window.location.href).toBe('portal-login.html')
  })

  it('C: refresh_token_not_found triggers exactly one local-scope signOut, then the existing login redirect, no retry loop', async () => {
    const { window, getSessionMock, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: authApiError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found') },
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
    expect(window.location.href).toBe('portal-login.html')
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('D: refresh_token_already_used gets the identical recovery behavior', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: authApiError('refresh_token_already_used') },
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
    expect(window.location.href).toBe('portal-login.html')
  })

  it('E: a transient/network error is not classified stale -- no local signOut', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } },
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).not.toHaveBeenCalled()
    // Still lands on the safe existing no-session behavior -- login screen,
    // nothing thrown, nothing destroyed.
    expect(window.location.href).toBe('portal-login.html')
  })

  it('F: stale recovery preserves ?upgrade=checkride-prep as the intended destination', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: authApiError('refresh_token_not_found') },
      search: '?upgrade=checkride-prep',
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('portal-login.html?dest=checkride-prep')
  })

  it('G: stale recovery preserves ?registered=1 Ground School purchase context', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: authApiError('refresh_token_not_found') },
      search: '?registered=1&amount_cents=2500&class_title=PPL+Ground+School&class_when=2026-01-01&email=student%40test.local&name=Test+Student',
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe(
      'portal-login.html?dest=ground-school&registered=1&amount_cents=2500&class_title=PPL%20Ground%20School&class_when=2026-01-01&email=student%40test.local&name=Test%20Student'
    )
  })

  it('H: stale recovery preserves a #dpe-library (or other normal) hash destination', async () => {
    const { window, signOutMock, authReadyPromise } = runAuthGuard({
      getSessionResult: { data: { session: null }, error: authApiError('refresh_token_not_found') },
      hash: '#dpe-library',
    })
    await authReadyPromise.catch(() => {})
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('portal-login.html?dest=dpe-library')
  })

  it('I: UTM parameters survive stale-session recovery exactly as the ordinary no-session path already forwards them', async () => {
    const staleParams = { data: { session: null }, error: authApiError('refresh_token_not_found') }
    const search = '?utm_source=email&utm_medium=lifecycle&utm_campaign=new_member_activation&utm_content=welcome_2&utm_term=x'

    const stale = runAuthGuard({ getSessionResult: staleParams, search })
    await stale.authReadyPromise.catch(() => {})

    const ordinary = runAuthGuard({ getSessionResult: { data: { session: null }, error: null }, search })
    await ordinary.authReadyPromise.catch(() => {})

    expect(stale.signOutMock).toHaveBeenCalledTimes(1)
    expect(ordinary.signOutMock).not.toHaveBeenCalled()
    expect(stale.window.location.href).toBe(ordinary.window.location.href)
    expect(stale.window.location.href).toBe(
      'portal-login.html?utm_source=email&utm_medium=lifecycle&utm_campaign=new_member_activation&utm_content=welcome_2&utm_term=x'
    )
  })
})
