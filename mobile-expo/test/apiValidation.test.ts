// Sprint 1A Rev2 section 9: a clearly malformed 200 response from any of
// the four rendered mobile-* APIs must become a normalized, user-safe
// ApiError -- never an uncaught render crash, never a non-completable
// client state. Mocks the same functions.invoke seam as apiClient.test.ts
// so these exercise the real validate.ts/bootstrap.ts/dailyDrill.ts/
// practice.ts/readiness.ts code.
const mockInvoke = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}))

import { ApiError } from '../lib/api/errors'
import { fetchBootstrap } from '../lib/api/bootstrap'
import { fetchDailyDrill, startDailyDrill } from '../lib/api/dailyDrill'
import { revealQuestion, completePractice } from '../lib/api/practice'
import { fetchLatestReadiness } from '../lib/api/readiness'

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected promise to reject, but it resolved')
}

function ok(data: unknown) {
  mockInvoke.mockResolvedValue({ data, error: null })
}

beforeEach(() => mockInvoke.mockReset())

describe('mobile-bootstrap malformed response', () => {
  it('rejects a 200 response missing required top-level objects', async () => {
    ok({ user: { id: 'u1' } }) // training/access/progress/home missing
    const err = await captureError(fetchBootstrap())
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('server')
    expect(err.userMessage).not.toMatch(/undefined|null|TypeError/i)
  })

  it('accepts a well-formed response', async () => {
    ok({ user: {}, training: {}, access: {}, progress: {}, home: {} })
    await expect(fetchBootstrap()).resolves.toBeTruthy()
  })
})

describe('mobile-daily-drill malformed response', () => {
  it('rejects a response with no drill object', async () => {
    ok({ session_id: null, questions: [] })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  it('rejects a response where questions is not an array', async () => {
    ok({ drill: { id: 'd1', status: 'pending' }, session_id: 's1', questions: 'nope' })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  it('rejects a pending/in_progress drill with a null session_id (never legitimate)', async () => {
    ok({ drill: { id: 'd1', status: 'in_progress' }, session_id: null, questions: [] })
    const err = await captureError(startDailyDrill('d1'))
    expect(err.kind).toBe('server')
  })

  it('accepts a completed legacy-shaped drill with a null session_id (the one intentional exception)', async () => {
    ok({ drill: { id: 'd1', status: 'completed' }, session_id: null, questions: [] })
    await expect(fetchDailyDrill()).resolves.toBeTruthy()
  })

  it('accepts a well-formed pending drill', async () => {
    ok({ drill: { id: 'd1', status: 'pending' }, session_id: 's1', questions: [{ id: 'q1', question: 'Q', category: null }] })
    await expect(startDailyDrill('d1')).resolves.toBeTruthy()
  })
})

describe('mobile-practice reveal/complete malformed response', () => {
  it('reveal rejects a response missing model_answer', async () => {
    ok({ question_id: 'q1', common_mistakes: null, dpe_evaluating: null, real_world_application: null })
    const err = await captureError(revealQuestion('s1', 'q1'))
    expect(err.kind).toBe('server')
  })

  it('reveal accepts a well-formed response', async () => {
    ok({ question_id: 'q1', model_answer: 'Answer', common_mistakes: null, dpe_evaluating: null, real_world_application: null })
    await expect(revealQuestion('s1', 'q1')).resolves.toBeTruthy()
  })

  it('complete rejects a response with a non-numeric score', async () => {
    ok({ session_id: 's1', score: 'seven', total: 7, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
    const err = await captureError(completePractice('s1', []))
    expect(err.kind).toBe('server')
  })

  it('complete rejects a response missing already_completed', async () => {
    ok({ session_id: 's1', score: 7, total: 7, completed_at: '2026-01-01T00:00:00Z' })
    const err = await captureError(completePractice('s1', []))
    expect(err.kind).toBe('server')
  })

  it('complete accepts a well-formed response', async () => {
    ok({ session_id: 's1', score: 7, total: 7, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
    await expect(completePractice('s1', [])).resolves.toBeTruthy()
  })
})

describe('mobile-readiness malformed response', () => {
  it('rejects a non-null snapshot missing evidence_level', async () => {
    ok({ snapshot: { overall_score: 50, reason_codes: [] }, refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('accepts a null snapshot (the intentional "no readiness yet" case)', async () => {
    ok({ snapshot: null, refreshed: false })
    await expect(fetchLatestReadiness()).resolves.toBeTruthy()
  })

  it('accepts a well-formed snapshot', async () => {
    ok({
      snapshot: { overall_score: 50, evidence_level: 'low', reason_codes: [], coverage_score: 0, knowledge_score: 0, risk_management_score: 0, confidence_score: 0, weak_tasks: [], algorithm_version: 'v3', computed_at: '2026-01-01T00:00:00Z' },
      refreshed: false,
    })
    await expect(fetchLatestReadiness()).resolves.toBeTruthy()
  })
})
