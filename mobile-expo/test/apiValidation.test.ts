// Sprint 1A Rev2 section 9 (hardened in Rev3 section 3): a clearly
// malformed 200 response from any of the four rendered mobile-* APIs
// must become a normalized, user-safe ApiError -- never an uncaught
// render crash, never a non-completable client state. Mocks the same
// functions.invoke seam as apiClient.test.ts so these exercise the real
// validate.ts/bootstrap.ts/dailyDrill.ts/practice.ts/readiness.ts code.
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

function bootstrapFixture(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
    training: { certificate_type: 'private_pilot', aircraft_class: 'ASEL', acs_version: '2024', checkride_date: null },
    access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
    progress: { xp: 100, current_rank: 'Solo Pilot', current_streak: 2, longest_streak: 5, readiness_summary: null },
    home: { todays_drill: null, weak_areas: [] },
    ...overrides,
  }
}

describe('mobile-bootstrap malformed response', () => {
  it('rejects a 200 response missing required top-level objects', async () => {
    ok({ user: { id: 'u1' } }) // training/access/progress/home missing
    const err = await captureError(fetchBootstrap())
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('server')
    expect(err.userMessage).not.toMatch(/undefined|null|TypeError/i)
  })

  // Rev3 section 3: empty objects must no longer pass as "well-formed."
  it('rejects a response where nested fields are the wrong type', async () => {
    ok(bootstrapFixture({ progress: { xp: 'lots', current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects access.checkride_prep that is not a boolean', async () => {
    ok(bootstrapFixture({ access: { checkride_prep: 'yes', ground_school_pack: false, study_pack_entitlements: [] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a readiness_summary with an invalid evidence_level', async () => {
    ok(
      bootstrapFixture({
        progress: {
          xp: 0,
          current_rank: null,
          current_streak: 0,
          longest_streak: 0,
          readiness_summary: { overall_score: 50, evidence_level: 'super-high', reason_codes: [] },
        },
      })
    )
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a home.todays_drill with an invalid status', async () => {
    ok(bootstrapFixture({ home: { todays_drill: { id: 'd1', status: 'not-a-status', estimated_minutes: 5, target_acs_tasks: [] }, weak_areas: [] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('accepts a realistic, fully-populated well-formed response', async () => {
    ok(
      bootstrapFixture({
        home: {
          todays_drill: { id: 'd1', status: 'pending', estimated_minutes: 8, target_acs_tasks: [] },
          weak_areas: [],
        },
        progress: {
          xp: 100,
          current_rank: 'Solo Pilot',
          current_streak: 2,
          longest_streak: 5,
          readiness_summary: { overall_score: 60, evidence_level: 'moderate', reason_codes: ['low_sample_size'] },
        },
      })
    )
    await expect(fetchBootstrap()).resolves.toBeTruthy()
  })

  it('accepts a minimal response with every nullable field actually null', async () => {
    ok(
      bootstrapFixture({
        user: { id: 'u1', full_name: null, email: null, role: null },
        training: { certificate_type: null, aircraft_class: null, acs_version: null, checkride_date: null },
        progress: { xp: 0, current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null },
      })
    )
    await expect(fetchBootstrap()).resolves.toBeTruthy()
  })
})

describe('mobile-daily-drill: fetch vs start have different session_id invariants (Rev3 section 1)', () => {
  const QUESTIONS = [{ id: 'q1', question: 'Q', category: null }]

  it('rejects a response with no drill object', async () => {
    ok({ session_id: null, questions: [] })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  it('rejects a response where questions is not an array', async () => {
    ok({ drill: { id: 'd1', status: 'pending' }, session_id: null, questions: 'nope' })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  it('rejects a question missing a required field', async () => {
    ok({ drill: { id: 'd1', status: 'pending' }, session_id: null, questions: [{ id: 'q1' }] })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  it('rejects an unrecognized drill status', async () => {
    ok({ drill: { id: 'd1', status: 'archived' }, session_id: null, questions: [] })
    const err = await captureError(fetchDailyDrill())
    expect(err.kind).toBe('server')
  })

  // A: DEFAULT fetch accepts pending + session_id null -- the normal,
  // expected shape for a drill that hasn't had `start` called on it yet.
  // Production presently contains real pending rows with a null
  // practice_attempt_id; Rev2's validation incorrectly rejected this.
  it('A: fetch accepts pending + null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'pending' }, session_id: null, questions: QUESTIONS })
    await expect(fetchDailyDrill()).resolves.toBeTruthy()
  })

  // B: DEFAULT fetch accepts in_progress + session_id null, as
  // backward-compatible legacy (pre-v118-bridge) state.
  it('B: fetch accepts in_progress + null session_id (legacy data)', async () => {
    ok({ drill: { id: 'd1', status: 'in_progress' }, session_id: null, questions: QUESTIONS })
    await expect(fetchDailyDrill()).resolves.toBeTruthy()
  })

  // C: START accepts in_progress + non-null session_id -- the normal
  // "just created or resumed a real attempt" shape.
  it('C: start accepts in_progress + non-null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'in_progress' }, session_id: 's1', questions: QUESTIONS })
    await expect(startDailyDrill('d1')).resolves.toBeTruthy()
  })

  // D: START rejects in_progress + null session_id -- there is no code
  // path in the deployed start_daily_drill_practice_session() RPC that
  // produces this combination, so it's a genuine contract violation.
  it('D: start rejects in_progress + null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'in_progress' }, session_id: null, questions: QUESTIONS })
    const err = await captureError(startDailyDrill('d1'))
    expect(err.kind).toBe('server')
  })

  // E: completed + null session_id remains accepted (the deliberate
  // completed-but-never-linked edge case) for BOTH fetch and start.
  it('E: fetch accepts completed + null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'completed' }, session_id: null, questions: [] })
    await expect(fetchDailyDrill()).resolves.toBeTruthy()
  })

  it('E: start accepts completed + null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'completed' }, session_id: null, questions: [] })
    await expect(startDailyDrill('d1')).resolves.toBeTruthy()
  })

  // F: completed + linked (non-null session_id) remains accepted for
  // both fetch and start.
  it('F: fetch accepts completed + non-null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'completed' }, session_id: 's1', questions: [] })
    await expect(fetchDailyDrill()).resolves.toBeTruthy()
  })

  it('F: start accepts completed + non-null session_id', async () => {
    ok({ drill: { id: 'd1', status: 'completed' }, session_id: 's1', questions: [] })
    await expect(startDailyDrill('d1')).resolves.toBeTruthy()
  })
})

describe('mobile-practice reveal/complete malformed response', () => {
  it('reveal rejects a response missing model_answer', async () => {
    ok({ question_id: 'q1', common_mistakes: null, dpe_evaluating: null, real_world_application: null })
    const err = await captureError(revealQuestion('s1', 'q1'))
    expect(err.kind).toBe('server')
  })

  it('reveal rejects a non-null, non-string common_mistakes', async () => {
    ok({ question_id: 'q1', model_answer: 'Answer', common_mistakes: 42, dpe_evaluating: null, real_world_application: null })
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

  it('complete rejects a negative score', async () => {
    ok({ session_id: 's1', score: -1, total: 7, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
    const err = await captureError(completePractice('s1', []))
    expect(err.kind).toBe('server')
  })

  it('complete rejects a non-finite total', async () => {
    ok({ session_id: 's1', score: 1, total: Infinity, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
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

  it('complete accepts a zero score/total (a drill with no questions rated -- not expected in practice, but numerically valid)', async () => {
    ok({ session_id: 's1', score: 0, total: 0, completed_at: '2026-01-01T00:00:00Z', already_completed: false })
    await expect(completePractice('s1', [])).resolves.toBeTruthy()
  })
})

describe('mobile-readiness malformed response', () => {
  it('rejects a non-null snapshot missing evidence_level', async () => {
    ok({ snapshot: { overall_score: 50, reason_codes: [] }, refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('rejects an unrecognized evidence_level', async () => {
    ok({ snapshot: { overall_score: 50, evidence_level: 'super-high', reason_codes: [] }, refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('rejects reason_codes containing a non-string element', async () => {
    ok({ snapshot: { overall_score: 50, evidence_level: 'low', reason_codes: ['low_sample_size', 42] }, refreshed: false })
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
