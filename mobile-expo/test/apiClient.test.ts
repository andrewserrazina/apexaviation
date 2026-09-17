// Mocks the one seam every API client file goes through -- supabase-js's
// functions.invoke -- so these tests exercise the REAL client.ts/
// dailyDrill.ts/practice.ts code, not a re-implementation of it.
const mockInvoke = jest.fn()
// Rev4: also mocks auth.getSession -- the seam getPinnedAccessToken goes
// through -- so this file can exercise the REAL pinning logic too, not
// just the unpinned request-shaping tests below.
const mockGetSession = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
  },
}))

import { getPinnedAccessToken, invokeMobileFunction } from '../lib/api/client'
import { ApiError } from '../lib/api/errors'
import { startDailyDrill, fetchDailyDrill } from '../lib/api/dailyDrill'
import { startAdHocPractice } from '../lib/api/practice'
import { fetchLibraryCatalog, fetchLibraryContent } from '../lib/api/library'
import { registerPushToken, revokePushToken, listPushTokens, getNotificationPreferences, updateNotificationPreferences } from '../lib/api/pushToken'

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected promise to reject, but it resolved')
}

describe('invokeMobileFunction error normalization', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('returns data unchanged on success', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(invokeMobileFunction('mobile-bootstrap')).resolves.toEqual({ ok: true })
  })

  it('normalizes a 401 into an auth ApiError with a safe message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'edge function returned a non-2xx status code', context: { status: 401, json: async () => ({ error: 'Invalid or expired session' }) } },
    })
    const err = await captureError(invokeMobileFunction('mobile-bootstrap'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('auth')
    expect(err.userMessage).not.toMatch(/PGRST|postgres/i)
  })

  it('normalizes a domain error (e.g. v118 entitlement denial) to a forbidden/validation ApiError carrying the server message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 400, json: async () => ({ error: 'Checkride Prep is not unlocked on this account.' }) } },
    })
    const err = await captureError(invokeMobileFunction('mobile-daily-drill', { action: 'start', drill_id: 'x' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.userMessage).toBe('Checkride Prep is not unlocked on this account.')
  })

  it('normalizes a 5xx into a generic server ApiError, never echoing the raw body', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 500, json: async () => ({ error: 'ERROR:  42703: column "foo" does not exist' }) } },
    })
    const err = await captureError(invokeMobileFunction('mobile-practice'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('server')
    expect(err.userMessage).not.toMatch(/42703|column/i)
  })

  // Rev2 blocker 4: a 5xx response's machine-readable `code` (e.g. v119
  // resume's own `{ error: detail, code: 'invalid_question_set' }, 500`
  // body -- see mobile-practice/index.ts's resume error mapping) must
  // survive normalization even though the learner-facing message stays
  // generic. Before this fix, status >= 500 dropped the extracted `code`
  // entirely, making useAdHocPracticeSession.classifyResumeError() unable
  // to ever distinguish this permanent, per-session failure from an
  // ordinary transient infra 5xx.
  it('preserves a 5xx response’s machine-readable code, while still keeping the learner-facing message generic', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 500, json: async () => ({ error: 'invalid_question_set', code: 'invalid_question_set' }) } },
    })
    const err = await captureError(invokeMobileFunction('mobile-practice', { action: 'resume', session_id: 's1' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('server')
    expect(err.code).toBe('invalid_question_set')
    expect(err.userMessage).not.toMatch(/invalid_question_set/i)
  })

  it('a 5xx response with no code in the body normalizes with code=null, not a fabricated value', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 500, json: async () => ({ error: 'Something broke' }) } },
    })
    const err = await captureError(invokeMobileFunction('mobile-practice'))
    expect(err.kind).toBe('server')
    expect(err.code).toBeNull()
  })

  it('normalizes a thrown/unreachable failure into a network ApiError', async () => {
    mockInvoke.mockRejectedValue(new TypeError('Network request failed'))
    const err = await captureError(invokeMobileFunction('mobile-bootstrap'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('network')
  })

  it('normalizes a missing-status error (no reachable response) into a network ApiError, not a domain error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    const err = await captureError(invokeMobileFunction('mobile-bootstrap'))
    expect(err.kind).toBe('network')
  })
})

describe('Daily Drill session creation routes exclusively through mobile-daily-drill', () => {
  beforeEach(() => mockInvoke.mockReset())

  // N: Start calls mobile-daily-drill action:start.
  it('startDailyDrill invokes mobile-daily-drill with action "start" and the drill_id', async () => {
    mockInvoke.mockResolvedValue({ data: { drill: { id: 'd1', status: 'pending' }, session_id: 's1', questions: [] }, error: null })
    await startDailyDrill('drill-123')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('mobile-daily-drill', { body: { action: 'start', drill_id: 'drill-123' } })
  })

  it('fetchDailyDrill invokes mobile-daily-drill with no action (default fetch-or-create)', async () => {
    mockInvoke.mockResolvedValue({ data: { drill: { id: 'd1', status: 'completed' }, session_id: null, questions: [] }, error: null })
    await fetchDailyDrill()
    expect(mockInvoke).toHaveBeenCalledWith('mobile-daily-drill', undefined)
  })

  // O: Daily Drill never calls mobile-practice action:start as a
  // substitute -- proven here by asserting the ONLY function name ever
  // invoked by startDailyDrill/fetchDailyDrill is 'mobile-daily-drill'.
  it('never calls mobile-practice as part of starting or fetching a Daily Drill', async () => {
    mockInvoke.mockResolvedValue({ data: { drill: { id: 'd1', status: 'pending' }, session_id: 's1', questions: [] }, error: null })
    await fetchDailyDrill()
    await startDailyDrill('drill-123')
    const calledFunctionNames = mockInvoke.mock.calls.map((call) => call[0])
    expect(calledFunctionNames.every((name) => name === 'mobile-daily-drill')).toBe(true)
    expect(calledFunctionNames).not.toContain('mobile-practice')
  })
})

describe('practice.ts ad-hoc start is a distinct, independent call', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('startAdHocPractice invokes mobile-practice, not mobile-daily-drill', async () => {
    // Sprint 1B.1: startAdHocPractice is now validated (it wasn't before)
    // -- v119's start action always returns a nonempty question set (it
    // fails closed to a 404 before ever creating an attempt with zero
    // eligible questions), so this fixture must be a realistic, valid
    // response, not an empty placeholder.
    mockInvoke.mockResolvedValue({
      data: {
        session_id: 's2',
        mode: 'dpe_questions',
        started_at: '2026-01-01T00:00:00Z',
        target_acs_tasks: [],
        questions: [{ id: 'q1', question: 'Q1?', category: null }],
      },
      error: null,
    })
    await startAdHocPractice({ session_size: 5 })
    expect(mockInvoke).toHaveBeenCalledWith('mobile-practice', { body: { action: 'start', session_size: 5 } })
  })
})

describe('mobile-library request contract', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('fetchLibraryCatalog invokes mobile-library with no action (catalog is the default)', async () => {
    mockInvoke.mockResolvedValue({ data: { packs: [] }, error: null })
    await fetchLibraryCatalog()
    expect(mockInvoke).toHaveBeenCalledWith('mobile-library', undefined)
  })

  it('fetchLibraryContent invokes mobile-library with action=content and the exact pack id, nothing else', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        version: '1.0.0',
        content: {
          product: { name: 'Apex Advantage Airspace Mastery' },
          lessons: [],
          scenarios: [],
          checkride_corner: [],
          mastery_check: { questions: [], passing_percent: 80, retakes_allowed: true },
          quick_reference: { sections: [] },
        },
      },
      error: null,
    })
    await fetchLibraryContent('airspace_mastery')
    expect(mockInvoke).toHaveBeenCalledWith('mobile-library', { body: { action: 'content', pack_id: 'airspace_mastery' } })
  })
})

describe('mobile-push-token request contract', () => {
  beforeEach(() => mockInvoke.mockReset())

  function deviceFixture() {
    return { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }
  }

  it('registerPushToken sends action=register with exactly the platform and token given, plus optional metadata', async () => {
    mockInvoke.mockResolvedValue({ data: { device: deviceFixture() }, error: null })
    await registerPushToken({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]', app_version: '0.1.0' })
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', {
      body: { action: 'register', platform: 'ios', expo_push_token: 'ExponentPushToken[abc]', app_version: '0.1.0' },
    })
  })

  it('revokePushToken sends action=revoke with exactly the given device_id', async () => {
    mockInvoke.mockResolvedValue({ data: { device: deviceFixture() }, error: null })
    await revokePushToken('device-1')
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', { body: { action: 'revoke', device_id: 'device-1' } })
  })

  it('listPushTokens sends no action (list is the default)', async () => {
    mockInvoke.mockResolvedValue({ data: { devices: [] }, error: null })
    await listPushTokens()
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', undefined)
  })

  it('getNotificationPreferences sends action=get_preferences', async () => {
    mockInvoke.mockResolvedValue({
      data: { preferences: { daily_drill_enabled: true, daily_drill_time: '07:00:00', checkride_countdown_enabled: true, weak_area_enabled: true, streak_enabled: true } },
      error: null,
    })
    await getNotificationPreferences()
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', { body: { action: 'get_preferences' } })
  })

  it('updateNotificationPreferences sends action=update_preferences with only the changed fields', async () => {
    mockInvoke.mockResolvedValue({
      data: { preferences: { daily_drill_enabled: false, daily_drill_time: '07:00:00', checkride_countdown_enabled: true, weak_area_enabled: true, streak_enabled: true } },
      error: null,
    })
    await updateNotificationPreferences({ daily_drill_enabled: false })
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', { body: { action: 'update_preferences', daily_drill_enabled: false } })
  })
})

// Sprint 1C Rev4 (independent review -- identity invariant): direct
// tests for the actual client-level pinning seam, since these are the
// real security boundary -- everything else (usePushRegistration.test.tsx)
// only proves the hook THREADS the right user id through; these prove
// what happens once it gets there.
describe('Rev4: getPinnedAccessToken()', () => {
  beforeEach(() => {
    mockGetSession.mockReset()
    mockInvoke.mockReset()
  })

  const SESSION_A = { access_token: 'token-for-a', user: { id: 'user-a' } } as any

  it('returns the current session’s access token when it matches the expected user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION_A }, error: null })
    await expect(getPinnedAccessToken('user-a')).resolves.toBe('token-for-a')
  })

  it('rejects when the current session belongs to a DIFFERENT user than expected', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION_A }, error: null })
    const err = await captureError(getPinnedAccessToken('user-b'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('auth')
  })

  it('rejects when there is no current session at all', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    const err = await captureError(getPinnedAccessToken('user-a'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('auth')
  })

  it('rejects when getSession() itself returns an error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: { message: 'network down' } })
    const err = await captureError(getPinnedAccessToken('user-a'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('auth')
  })

  it('an expected-user mismatch causes ZERO Edge Function invocation when used through registerPushToken', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION_A }, error: null })
    await expect(registerPushToken({ platform: 'ios', expo_push_token: 'tok' }, 'user-b')).rejects.toBeInstanceOf(ApiError)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('a pinned access token reaches invoke() as an explicit Authorization header', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION_A }, error: null })
    mockInvoke.mockResolvedValue({ data: { device: { id: 'device-1', platform: 'ios', installation_id: null, app_version: null, last_seen_at: 'now', created_at: 'now' } }, error: null })

    await registerPushToken({ platform: 'ios', expo_push_token: 'tok' }, 'user-a')

    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', {
      body: { action: 'register', platform: 'ios', expo_push_token: 'tok' },
      headers: { Authorization: 'Bearer token-for-a' },
    })
  })

  // Required test: a preference update queued for User A must never
  // reach the Edge Function at all once the ambient session has already
  // changed to User B -- this is the real, unmocked pinning mechanism
  // that usePushRegistration's own tests only prove the hook engages
  // correctly.
  it('a preference mutation for User A is never invoked once the current session has changed to User B', async () => {
    const SESSION_B = { access_token: 'token-for-b', user: { id: 'user-b' } } as any
    mockGetSession.mockResolvedValue({ data: { session: SESSION_B }, error: null })

    await expect(updateNotificationPreferences({ streak_enabled: false }, 'user-a')).rejects.toBeInstanceOf(ApiError)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('getNotificationPreferences without an expected user id preserves the exact prior ambient-session behavior (no auth.getSession call)', async () => {
    mockInvoke.mockResolvedValue({
      data: { preferences: { daily_drill_enabled: true, daily_drill_time: '07:00:00', checkride_countdown_enabled: true, weak_area_enabled: true, streak_enabled: true } },
      error: null,
    })
    await getNotificationPreferences()
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('mobile-push-token', { body: { action: 'get_preferences' } })
  })
})
