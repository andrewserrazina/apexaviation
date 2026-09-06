// Mocks the one seam every API client file goes through -- supabase-js's
// functions.invoke -- so these tests exercise the REAL client.ts/
// dailyDrill.ts/practice.ts code, not a re-implementation of it.
const mockInvoke = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}))

import { invokeMobileFunction } from '../lib/api/client'
import { ApiError } from '../lib/api/errors'
import { startDailyDrill, fetchDailyDrill } from '../lib/api/dailyDrill'
import { startAdHocPractice } from '../lib/api/practice'

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
