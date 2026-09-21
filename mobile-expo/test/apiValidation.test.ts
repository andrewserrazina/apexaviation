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
import { revealQuestion, completePractice, startAdHocPractice, resumePractice } from '../lib/api/practice'
import { fetchLatestReadiness } from '../lib/api/readiness'
import { fetchLibraryCatalog, fetchLibraryContent } from '../lib/api/library'
import { registerPushToken, revokePushToken, listPushTokens, getNotificationPreferences, updateNotificationPreferences } from '../lib/api/pushToken'
import { startDpeSession, sendDpeMessage, endDpeSession, resumeDpeSession, fetchDpeHistory } from '../lib/api/dpe'
import { fetchReviewQueue, revealReviewItem, submitReviewOutcome } from '../lib/api/reviewQueue'
import { fetchGroundSchoolCatalog, fetchGroundSchoolContent } from '../lib/api/groundSchool'

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

// Rev2 blocker 5: before Sprint 1B.1, home.weak_areas was only checked to
// be an array -- the Practice hub now directly renders
// weak_area.area_code/task_code/evidence_score AND passes acs_task_id
// straight through, unmodified, as a targeted Start's request body. A
// malformed/undefined acs_task_id can be silently OMITTED during JSON
// serialization, which would make v119's server interpret the request as
// GENERAL practice -- so a visually-targeted "Practice I.A" CTA must
// never be allowed to degrade into untargeted practice just because
// bootstrap's own payload happened to be malformed.
describe('mobile-bootstrap home.weak_areas runtime validation (Rev2 blocker 5)', () => {
  function weakAreaFixture(overrides: Record<string, unknown> = {}) {
    return { acs_task_id: 'task-uuid-1', area_code: 'I', task_code: 'A', evidence_score: 0.5, ...overrides }
  }

  it('rejects a weak area missing acs_task_id', async () => {
    const { acs_task_id: _drop, ...rest } = weakAreaFixture()
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [rest] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with an empty-string acs_task_id', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ acs_task_id: '' })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area missing area_code', async () => {
    const { area_code: _drop, ...rest } = weakAreaFixture()
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [rest] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with an empty-string area_code', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ area_code: '' })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area missing task_code', async () => {
    const { task_code: _drop, ...rest } = weakAreaFixture()
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [rest] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with an empty-string task_code', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ task_code: '' })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with a non-numeric evidence_score', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ evidence_score: '0.5' })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with evidence_score=NaN', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ evidence_score: NaN })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with evidence_score=Infinity', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ evidence_score: Infinity })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with an out-of-range evidence_score above 1', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ evidence_score: 1.5 })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('rejects a weak area with a negative evidence_score', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [weakAreaFixture({ evidence_score: -0.1 })] } }))
    const err = await captureError(fetchBootstrap())
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed weak_areas array with boundary evidence_score values 0 and 1', async () => {
    ok(
      bootstrapFixture({
        home: {
          todays_drill: null,
          weak_areas: [weakAreaFixture({ acs_task_id: 'task-uuid-1', evidence_score: 0 }), weakAreaFixture({ acs_task_id: 'task-uuid-2', evidence_score: 1 })],
        },
      })
    )
    await expect(fetchBootstrap()).resolves.toBeTruthy()
  })

  it('accepts an empty weak_areas array', async () => {
    ok(bootstrapFixture({ home: { todays_drill: null, weak_areas: [] } }))
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

// Sprint 1B.1: startAdHocPractice was previously unvalidated (no
// assertShape call at all) and resumePractice is a brand-new client.
// Both share assertCommonPracticeShape's render-critical checks --
// nonempty session_id/mode/started_at, valid target_acs_tasks, and a
// NONEMPTY questions array (v119's backend fails closed to a 404 before
// ever creating an attempt with zero eligible questions, so an empty
// questions array is never a legitimate response to either action).
describe('mobile-practice start/resume malformed response (Sprint 1B.1)', () => {
  const VALID_QUESTIONS = [{ id: 'q1', question: 'Q1?', category: 'eligibility' }]
  const VALID_ACS_TASKS = [{ acs_task_id: 't1', area_code: 'I', task_code: 'A' }]

  // 1. valid Start response accepted
  it('startAdHocPractice accepts a well-formed response', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      target_acs_tasks: VALID_ACS_TASKS,
      questions: VALID_QUESTIONS,
    })
    await expect(startAdHocPractice({ session_size: 5 })).resolves.toBeTruthy()
  })

  // 2. malformed Start 200 rejected safely
  it('startAdHocPractice rejects a response with an empty questions array', async () => {
    ok({ session_id: 's1', mode: 'dpe_questions', started_at: '2026-01-01T00:00:00Z', target_acs_tasks: [], questions: [] })
    const err = await captureError(startAdHocPractice({ session_size: 5 }))
    expect(err.kind).toBe('server')
    expect(err.userMessage).not.toMatch(/undefined|null|TypeError/i)
  })

  it('startAdHocPractice rejects a response missing session_id', async () => {
    ok({ mode: 'dpe_questions', started_at: '2026-01-01T00:00:00Z', target_acs_tasks: [], questions: VALID_QUESTIONS })
    const err = await captureError(startAdHocPractice({ session_size: 5 }))
    expect(err.kind).toBe('server')
  })

  it('startAdHocPractice rejects a target_acs_tasks entry missing task_code', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      target_acs_tasks: [{ acs_task_id: 't1', area_code: 'I' }],
      questions: VALID_QUESTIONS,
    })
    const err = await captureError(startAdHocPractice({ session_size: 5 }))
    expect(err.kind).toBe('server')
  })

  // 3. valid Resume response accepted
  it('resumePractice accepts a well-formed in-progress response', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: null,
      target_acs_tasks: VALID_ACS_TASKS,
      questions: VALID_QUESTIONS,
    })
    await expect(resumePractice('s1')).resolves.toBeTruthy()
  })

  // 4. malformed Resume 200 rejected safely
  it('resumePractice rejects a response with an empty questions array', async () => {
    ok({ session_id: 's1', mode: 'dpe_questions', started_at: '2026-01-01T00:00:00Z', completed_at: null, target_acs_tasks: [], questions: [] })
    const err = await captureError(resumePractice('s1'))
    expect(err.kind).toBe('server')
  })

  it('resumePractice rejects a non-null, non-string completed_at', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: 12345,
      target_acs_tasks: [],
      questions: VALID_QUESTIONS,
    })
    const err = await captureError(resumePractice('s1'))
    expect(err.kind).toBe('server')
  })

  // 5. completed_at null accepted
  it('resumePractice accepts completed_at: null (an in-progress session)', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: null,
      target_acs_tasks: [],
      questions: VALID_QUESTIONS,
    })
    await expect(resumePractice('s1')).resolves.toBeTruthy()
  })

  // 6. completed_at string accepted
  it('resumePractice accepts completed_at as a string (an already-completed session)', async () => {
    ok({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-02T00:00:00Z',
      target_acs_tasks: [],
      questions: VALID_QUESTIONS,
    })
    const result = await resumePractice('s1')
    expect(result.completed_at).toBe('2026-01-02T00:00:00Z')
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

  // V142/Sprint 4: category_breakdown is now directly rendered by the ACS
  // Explorer (app/(app)/acs.tsx), which indexes EVIDENCE_COLOR/
  // EVIDENCE_LABEL by evidence_level and Math.round()s score whenever it
  // isn't null -- an unvalidated malformed entry here would crash that
  // render rather than fail closed to a normal retryable error.
  function categoryBreakdownFixture(overrides: Record<string, unknown> = {}) {
    return {
      category: 'weather',
      label: 'Weather',
      score: 80,
      evidence_level: 'strong',
      attempt_volume: 12,
      task_breadth_pct: 100,
      weak_task_count: 0,
      strong_task_count: 3,
      last_demonstrated_at: '2026-09-01T00:00:00Z',
      ai_dpe_reason_code: null,
      ...overrides,
    }
  }

  function readinessSummaryFixture(overrides: Record<string, unknown> = {}) {
    return {
      overall_score: 50,
      evidence_level: 'low',
      reason_codes: [],
      coverage_score: 0,
      knowledge_score: 0,
      risk_management_score: 0,
      confidence_score: 0,
      weak_tasks: [],
      algorithm_version: 'v3',
      computed_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('accepts a well-formed snapshot with category_breakdown', async () => {
    ok({
      snapshot: readinessSummaryFixture({ category_breakdown: [categoryBreakdownFixture()], assessable_task_count: 19, evidenced_task_count: 10 }),
      refreshed: false,
    })
    await expect(fetchLatestReadiness()).resolves.toBeTruthy()
  })

  it('accepts a well-formed snapshot with no category_breakdown at all (legacy pre-v3 row)', async () => {
    ok({ snapshot: readinessSummaryFixture(), refreshed: false })
    await expect(fetchLatestReadiness()).resolves.toBeTruthy()
  })

  it('rejects a category_breakdown entry with an unrecognized evidence_level', async () => {
    ok({ snapshot: readinessSummaryFixture({ category_breakdown: [categoryBreakdownFixture({ evidence_level: 'super-high' })] }), refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('rejects a category_breakdown entry with a non-numeric score', async () => {
    ok({ snapshot: readinessSummaryFixture({ category_breakdown: [categoryBreakdownFixture({ score: '80' })] }), refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('accepts a category_breakdown entry with a null score (no evidence yet)', async () => {
    ok({ snapshot: readinessSummaryFixture({ category_breakdown: [categoryBreakdownFixture({ score: null, evidence_level: 'none' })] }), refreshed: false })
    await expect(fetchLatestReadiness()).resolves.toBeTruthy()
  })

  it('rejects a category_breakdown entry missing label', async () => {
    const { label: _drop, ...rest } = categoryBreakdownFixture()
    ok({ snapshot: readinessSummaryFixture({ category_breakdown: [rest] }), refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('rejects a category_breakdown that is not an array', async () => {
    ok({ snapshot: readinessSummaryFixture({ category_breakdown: 'nope' }), refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })

  it('rejects a malformed top-level assessable_task_count', async () => {
    ok({ snapshot: readinessSummaryFixture({ assessable_task_count: '19' }), refreshed: false })
    const err = await captureError(fetchLatestReadiness())
    expect(err.kind).toBe('server')
  })
})

// Sprint 1C Phase 1: mobile-library's catalog is browsable without
// entitlement, so `owned` is the ONE thing a malformed catalog must never
// be allowed to misrender -- see lib/api/library.ts and
// portal/supabase/functions/mobile-library/index.ts.
function packSummaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'airspace_mastery',
    name: 'Apex Advantage Airspace Mastery',
    subtitle: 'Master the airspace system',
    price_cents: 4900,
    currency: 'usd',
    certificate_type: 'private_pilot',
    estimated_minutes_min: 120,
    estimated_minutes_max: 180,
    sort_order: 1,
    owned: false,
    ...overrides,
  }
}

// A minimal but fully well-formed MobileStudyPackContent -- one of each
// section, matching the exact wire shape Sprint 1C Phase 0's read-only
// production inspection established (cross-checked against
// site/portal-stable.js's Study Pack renderer).
function studyPackContentFixture(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    product: { name: 'Apex Advantage Airspace Mastery' },
    lessons: [
      {
        id: 'lesson-1',
        lesson_number: 1,
        title: 'The Big Picture',
        estimated_time: '15 minutes',
        intro: ['Why airspace exists.'],
        sections: {
          what_is_it: ['...'],
          why_it_matters: ['...'],
          flight_operations: ['...'],
          adm_legal_vs_wise: ['...'],
          checkride_connection: ['...'],
          safety_connection: ['...'],
        },
        knowledge_check: [
          {
            id: 'kc-1',
            question_number: 1,
            question: 'What is Class B airspace?',
            correct_answer: 'Controlled airspace around the busiest airports.',
            explanation: 'Class B surrounds the nation’s busiest airports.',
            common_mistake: null,
          },
        ],
      },
    ],
    scenarios: [
      {
        id: 'scenario-1',
        scenario_number: 1,
        title: 'Unexpected Class C transition',
        situation: 'You are approaching Class C airspace.',
        decision_point: 'Do you request clearance now?',
        student_commitment_prompt: 'What would you do?',
        reveal_discussion: 'Contact approach control before entry.',
        recommended_action: 'Establish two-way radio contact.',
        debrief: 'Always confirm contact before entering.',
      },
    ],
    checkride_corner: [
      {
        id: 'ckc-1',
        question_number: 1,
        topic: 'Airspace',
        question: 'What is required to enter Class D airspace?',
        difficulty_label: 'Foundational',
        model_answer: 'Two-way radio communication established.',
        common_student_mistake: 'Confusing established contact with merely calling in.',
        dpe_follow_up: null,
        strong_follow_up_answer: null,
      },
    ],
    mastery_check: {
      questions: [
        {
          id: 'mc-1',
          question: 'Which airspace requires an ATC clearance to enter?',
          options: [
            { key: 'a', text: 'Class B' },
            { key: 'b', text: 'Class G' },
          ],
          correct_option: 'a',
          explanation: 'Class B requires an explicit clearance.',
        },
      ],
      passing_percent: 80,
      retakes_allowed: true,
    },
    quick_reference: {
      sections: [
        {
          title: 'Airspace Speed Limits',
          tables: [{ rows: [['Class', 'Speed Limit'], ['B', '250 kt below 10,000 ft']] }],
          paragraphs: ['Always check current NOTAMs.'],
        },
      ],
    },
    ...overrides,
  }
}

describe('mobile-library catalog malformed response', () => {
  it('accepts a well-formed catalog', async () => {
    ok({ packs: [packSummaryFixture()] })
    await expect(fetchLibraryCatalog()).resolves.toBeTruthy()
  })

  it('accepts an empty catalog', async () => {
    ok({ packs: [] })
    await expect(fetchLibraryCatalog()).resolves.toEqual({ packs: [] })
  })

  it('rejects a response where packs is not an array', async () => {
    ok({ packs: null })
    const err = await captureError(fetchLibraryCatalog())
    expect(err.kind).toBe('server')
  })

  it('rejects a pack missing required fields', async () => {
    const { certificate_type: _drop, ...rest } = packSummaryFixture()
    ok({ packs: [rest] })
    const err = await captureError(fetchLibraryCatalog())
    expect(err.kind).toBe('server')
  })

  it('rejects a pack with a malformed (non-boolean) owned field', async () => {
    ok({ packs: [packSummaryFixture({ owned: 'yes' })] })
    const err = await captureError(fetchLibraryCatalog())
    expect(err.kind).toBe('server')
  })

  it('rejects a pack with a malformed price_cents', async () => {
    ok({ packs: [packSummaryFixture({ price_cents: '4900' })] })
    const err = await captureError(fetchLibraryCatalog())
    expect(err.kind).toBe('server')
  })
})

describe('mobile-library content malformed response', () => {
  it('accepts a well-formed content response', async () => {
    ok({ version: '1.0.0', content: studyPackContentFixture() })
    const result = await fetchLibraryContent('airspace_mastery')
    expect(result.version).toBe('1.0.0')
  })

  it('rejects a response missing version at the outer contract level', async () => {
    ok({ content: studyPackContentFixture() })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('rejects a response where content is not an object', async () => {
    ok({ version: '1.0.0', content: 'not-an-object' })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('rejects content missing the lessons array', async () => {
    const { lessons: _drop, ...rest } = studyPackContentFixture()
    ok({ version: '1.0.0', content: rest })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('rejects a lesson missing a required section key', async () => {
    const content = studyPackContentFixture()
    const { what_is_it: _drop, ...restSections } = content.lessons[0].sections
    content.lessons[0] = { ...content.lessons[0], sections: restSections }
    ok({ version: '1.0.0', content })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('rejects a mastery_check question with a non-array options field', async () => {
    const content = studyPackContentFixture()
    content.mastery_check = { ...content.mastery_check, questions: [{ ...content.mastery_check.questions[0], options: 'a' }] }
    ok({ version: '1.0.0', content })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('rejects a quick_reference table whose rows are not string arrays', async () => {
    const content = studyPackContentFixture()
    content.quick_reference = { sections: [{ ...content.quick_reference.sections[0], tables: [{ rows: [[1, 2]] }] }] }
    ok({ version: '1.0.0', content })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })

  it('never fabricates a missing checkride_corner -- rejects rather than defaulting to empty', async () => {
    const { checkride_corner: _drop, ...rest } = studyPackContentFixture()
    ok({ version: '1.0.0', content: rest })
    const err = await captureError(fetchLibraryContent('airspace_mastery'))
    expect(err.kind).toBe('server')
  })
})

function deviceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    platform: 'ios',
    installation_id: 'install-1',
    app_version: '0.1.0',
    last_seen_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function preferencesFixture(overrides: Record<string, unknown> = {}) {
  return {
    daily_drill_enabled: true,
    daily_drill_time: '07:00:00',
    checkride_countdown_enabled: true,
    weak_area_enabled: true,
    streak_enabled: true,
    ...overrides,
  }
}

describe('mobile-push-token malformed response', () => {
  it('accepts a well-formed register response', async () => {
    ok({ device: deviceFixture() })
    const result = await registerPushToken({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]' })
    expect(result.device.id).toBe('device-1')
  })

  it('rejects a register response with an invalid platform', async () => {
    ok({ device: deviceFixture({ platform: 'windows' }) })
    const err = await captureError(registerPushToken({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]' }))
    expect(err.kind).toBe('server')
  })

  it('rejects a register response missing required device fields', async () => {
    const { last_seen_at: _drop, ...rest } = deviceFixture()
    ok({ device: rest })
    const err = await captureError(registerPushToken({ platform: 'ios', expo_push_token: 'ExponentPushToken[abc]' }))
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed revoke response', async () => {
    ok({ device: deviceFixture() })
    const result = await revokePushToken('device-1')
    expect(result.device.id).toBe('device-1')
  })

  it('rejects a revoke response with a malformed device', async () => {
    ok({ device: { id: 'device-1' } })
    const err = await captureError(revokePushToken('device-1'))
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed list response, including an empty list', async () => {
    ok({ devices: [] })
    await expect(listPushTokens()).resolves.toEqual({ devices: [] })
  })

  it('rejects a list response where devices is not an array', async () => {
    ok({ devices: null })
    const err = await captureError(listPushTokens())
    expect(err.kind).toBe('server')
  })

  it('rejects a list response containing one malformed device among valid ones', async () => {
    ok({ devices: [deviceFixture(), { id: 'device-2', platform: 'android' }] })
    const err = await captureError(listPushTokens())
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed get_preferences response', async () => {
    ok({ preferences: preferencesFixture() })
    const result = await getNotificationPreferences()
    expect(result.daily_drill_time).toBe('07:00:00')
  })

  it('rejects a preferences response with a non-boolean toggle', async () => {
    ok({ preferences: preferencesFixture({ streak_enabled: 'yes' }) })
    const err = await captureError(getNotificationPreferences())
    expect(err.kind).toBe('server')
  })

  it('rejects a preferences response missing a required field', async () => {
    const { weak_area_enabled: _drop, ...rest } = preferencesFixture()
    ok({ preferences: rest })
    const err = await captureError(getNotificationPreferences())
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed update_preferences response', async () => {
    ok({ preferences: preferencesFixture({ daily_drill_enabled: false }) })
    const result = await updateNotificationPreferences({ daily_drill_enabled: false })
    expect(result.daily_drill_enabled).toBe(false)
  })

  it('rejects a malformed update_preferences response', async () => {
    ok({ preferences: null })
    const err = await captureError(updateNotificationPreferences({ daily_drill_enabled: false }))
    expect(err.kind).toBe('server')
  })
})

function dpeDebriefFixture(overrides: Record<string, unknown> = {}) {
  return {
    overallReadiness: 'almost',
    summary: 'Solid overall, work on weather.',
    strengths: ['Airspace knowledge'],
    weaknesses: ['Weather minimums'],
    perDomain: [{ domain: 'Weather', verdict: 'weak', note: 'Missed VFR minimums for Class E.' }],
    ...overrides,
  }
}

function dpeTurnFixture(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    phase: 'question',
    message: 'Tell me about your certificate privileges.',
    debrief: null,
    questionsAsked: 1,
    status: 'in_progress',
    ...overrides,
  }
}

describe('mobile-dpe start/message/end malformed response', () => {
  it('accepts a well-formed start response', async () => {
    ok(dpeTurnFixture())
    const result = await startDpeSession()
    expect(result.sessionId).toBe('session-1')
  })

  it('rejects a response with an invalid phase', async () => {
    ok(dpeTurnFixture({ phase: 'answer' }))
    const err = await captureError(startDpeSession())
    expect(err.kind).toBe('server')
  })

  it('rejects a response with an invalid status', async () => {
    ok(dpeTurnFixture({ status: 'done' }))
    const err = await captureError(startDpeSession())
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed debrief-phase response', async () => {
    ok(dpeTurnFixture({ phase: 'debrief', status: 'completed', debrief: dpeDebriefFixture() }))
    const result = await sendDpeMessage('session-1', 'That concludes my answer.')
    expect(result.debrief?.overallReadiness).toBe('almost')
  })

  it('rejects a debrief with an invalid overallReadiness', async () => {
    ok(dpeTurnFixture({ phase: 'debrief', status: 'completed', debrief: dpeDebriefFixture({ overallReadiness: 'passed' }) }))
    const err = await captureError(sendDpeMessage('session-1', 'x'))
    expect(err.kind).toBe('server')
  })

  it('rejects a debrief with a non-array strengths field', async () => {
    ok(dpeTurnFixture({ phase: 'debrief', status: 'completed', debrief: dpeDebriefFixture({ strengths: 'good job' }) }))
    const err = await captureError(sendDpeMessage('session-1', 'x'))
    expect(err.kind).toBe('server')
  })

  it('rejects a perDomain entry with an invalid verdict', async () => {
    ok(dpeTurnFixture({ phase: 'debrief', status: 'completed', debrief: dpeDebriefFixture({ perDomain: [{ domain: 'Weather', verdict: 'excellent', note: 'x' }] }) }))
    const err = await captureError(sendDpeMessage('session-1', 'x'))
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed end response', async () => {
    ok(dpeTurnFixture({ phase: 'debrief', status: 'completed', debrief: dpeDebriefFixture() }))
    const result = await endDpeSession('session-1')
    expect(result.status).toBe('completed')
  })

  it('rejects a response missing sessionId', async () => {
    const { sessionId: _drop, ...rest } = dpeTurnFixture()
    ok(rest)
    const err = await captureError(startDpeSession())
    expect(err.kind).toBe('server')
  })
})

describe('mobile-dpe resume malformed response', () => {
  function dpeResumeFixture(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 'session-1',
      status: 'in_progress',
      questionsAsked: 2,
      debrief: null,
      turns: [
        { role: 'dpe', message: 'Opening question.', at: '2026-01-01T00:00:00Z' },
        { role: 'student', message: 'My answer.', at: '2026-01-01T00:01:00Z' },
      ],
      ...overrides,
    }
  }

  it('accepts a well-formed resume response', async () => {
    ok(dpeResumeFixture())
    const result = await resumeDpeSession('session-1')
    expect(result.turns).toHaveLength(2)
  })

  it('rejects a resume response where turns is not an array', async () => {
    ok(dpeResumeFixture({ turns: 'none' }))
    const err = await captureError(resumeDpeSession('session-1'))
    expect(err.kind).toBe('server')
  })

  it('rejects a resume turn with an invalid role', async () => {
    ok(dpeResumeFixture({ turns: [{ role: 'examiner', message: 'x', at: '2026-01-01T00:00:00Z' }] }))
    const err = await captureError(resumeDpeSession('session-1'))
    expect(err.kind).toBe('server')
  })

  it('rejects a resume turn missing a message', async () => {
    ok(dpeResumeFixture({ turns: [{ role: 'dpe', at: '2026-01-01T00:00:00Z' }] }))
    const err = await captureError(resumeDpeSession('session-1'))
    expect(err.kind).toBe('server')
  })
})

describe('mobile-dpe history malformed response', () => {
  function dpeSessionSummaryFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'session-1',
      status: 'completed',
      questionsAsked: 9,
      debrief: dpeDebriefFixture(),
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:20:00Z',
      ...overrides,
    }
  }

  it('accepts a well-formed history response, including an empty list', async () => {
    ok({ sessions: [] })
    await expect(fetchDpeHistory()).resolves.toEqual({ sessions: [] })
  })

  it('accepts a session summary with a null debrief (in-progress session)', async () => {
    ok({ sessions: [dpeSessionSummaryFixture({ debrief: null, status: 'in_progress' })] })
    const result = await fetchDpeHistory()
    expect(result.sessions[0].debrief).toBeNull()
  })

  it('rejects a response where sessions is not an array', async () => {
    ok({ sessions: null })
    const err = await captureError(fetchDpeHistory())
    expect(err.kind).toBe('server')
  })

  it('rejects a session summary missing required fields', async () => {
    const { questionsAsked: _drop, ...rest } = dpeSessionSummaryFixture()
    ok({ sessions: [rest] })
    const err = await captureError(fetchDpeHistory())
    expect(err.kind).toBe('server')
  })
})

describe('mobile-review-queue list malformed response (Phase 2)', () => {
  function reviewItemFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'item-1',
      source_type: 'dpe_question',
      source_id: 'q1',
      module_id: null,
      acs_category: 'airspace',
      reason: 'incorrect',
      priority: 3,
      review_count: 1,
      next_review_at: '2026-01-01T00:00:00Z',
      question: 'What class of airspace surrounds a Class B primary airport?',
      ...overrides,
    }
  }

  it('accepts a well-formed list response, including an empty list', async () => {
    ok({ items: [] })
    await expect(fetchReviewQueue()).resolves.toEqual({ items: [] })
  })

  it('accepts a non-dpe_question item with a null question', async () => {
    ok({ items: [reviewItemFixture({ source_type: 'module_quiz_question', module_id: 'PPL-M01', question: null })] })
    const result = await fetchReviewQueue()
    expect(result.items[0].question).toBeNull()
  })

  it('rejects a response where items is not an array', async () => {
    ok({ items: null })
    const err = await captureError(fetchReviewQueue())
    expect(err.kind).toBe('server')
  })

  it('rejects an item with an invalid source_type', async () => {
    ok({ items: [reviewItemFixture({ source_type: 'flashcard' })] })
    const err = await captureError(fetchReviewQueue())
    expect(err.kind).toBe('server')
  })

  it('rejects an item missing required fields', async () => {
    const { next_review_at: _drop, ...rest } = reviewItemFixture()
    ok({ items: [rest] })
    const err = await captureError(fetchReviewQueue())
    expect(err.kind).toBe('server')
  })
})

describe('mobile-review-queue reveal/outcome malformed response (Phase 2)', () => {
  it('accepts a well-formed reveal response', async () => {
    ok({ review_item_id: 'item-1', model_answer: 'Class B.', common_mistakes: null, dpe_evaluating: null, real_world_application: null })
    const result = await revealReviewItem('item-1')
    expect(result.model_answer).toBe('Class B.')
  })

  it('rejects a reveal response missing model_answer', async () => {
    ok({ review_item_id: 'item-1', common_mistakes: null, dpe_evaluating: null, real_world_application: null })
    const err = await captureError(revealReviewItem('item-1'))
    expect(err.kind).toBe('server')
  })

  it('accepts a well-formed outcome response', async () => {
    ok({ review_item_id: 'item-1', outcome: 'reinforced', next_review_at: '2026-01-02T00:00:00Z', was_replay: false })
    const result = await submitReviewOutcome('item-1', 'reinforced', 'key-1')
    expect(result.was_replay).toBe(false)
  })

  it('rejects an outcome response with an invalid outcome value', async () => {
    ok({ review_item_id: 'item-1', outcome: 'skipped', next_review_at: '2026-01-02T00:00:00Z', was_replay: false })
    const err = await captureError(submitReviewOutcome('item-1', 'reinforced', 'key-1'))
    expect(err.kind).toBe('server')
  })

  it('rejects an outcome response with a non-boolean was_replay', async () => {
    ok({ review_item_id: 'item-1', outcome: 'reinforced', next_review_at: '2026-01-02T00:00:00Z', was_replay: 'false' })
    const err = await captureError(submitReviewOutcome('item-1', 'reinforced', 'key-1'))
    expect(err.kind).toBe('server')
  })
})

describe('mobile-ground-school catalog malformed response (Phase 3)', () => {
  it('accepts a well-formed catalog response', async () => {
    ok({ modules: [{ module_id: 'PPL-M01', has_authored_content: true, unlocked: true }] })
    const result = await fetchGroundSchoolCatalog()
    expect(result.modules).toHaveLength(1)
  })

  it('rejects a response where modules is not an array', async () => {
    ok({ modules: null })
    const err = await captureError(fetchGroundSchoolCatalog())
    expect(err.kind).toBe('server')
  })

  it('rejects a module summary missing required fields', async () => {
    ok({ modules: [{ module_id: 'PPL-M01', has_authored_content: true }] })
    const err = await captureError(fetchGroundSchoolCatalog())
    expect(err.kind).toBe('server')
  })
})

describe('mobile-ground-school content malformed response (Phase 3)', () => {
  function contentFixture(overrides: Record<string, unknown> = {}) {
    return {
      modulePurpose: 'Orient the student to the certification path.',
      objectives: [{ id: 'obj-1', label: 'Describe eligibility.' }],
      guidedNotes: [{ id: 'gn-1', section: 'Eligibility', prompt: 'What are the requirements?' }],
      keyConcepts: [{ id: 'acs', term: 'ACS', definition: 'Airman Certification Standards.' }],
      scenario: { narrative: 'A career-changer...', prompts: [{ id: 'sp-1', prompt: "What's happening?" }] },
      checkrideCorner: [{ id: 'cc-1', question: 'What are the requirements?' }],
      apexChallenge: { instructions: 'Write a plan.', fields: [{ id: 'target-date', type: 'date', label: 'Target Date' }] },
      reflectionQuestions: [{ id: 'reflect-1', prompt: 'What is your biggest obstacle?' }],
      knowledgeCheckQuestions: [{ id: 'kcq-1', prompt: 'Name the requirements.' }],
      ...overrides,
    }
  }

  function quizFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'PPL-M01-Q01',
      question_type: 'multiple_choice',
      prompt: 'Which stroke follows compression?',
      choices: [{ key: 'A', label: 'Intake' }],
      correct_choice: 'A',
      model_answer: 'Intake follows compression.',
      ...overrides,
    }
  }

  it('accepts a well-formed content response with every section present', async () => {
    ok({ content: contentFixture(), quiz: [quizFixture()], content_version: '2026-01-01T00:00:00Z' })
    const result = await fetchGroundSchoolContent('PPL-M01')
    expect(result.content?.objectives).toHaveLength(1)
    expect(result.quiz).toHaveLength(1)
  })

  it('accepts a null content (module not yet authored) with an empty quiz', async () => {
    ok({ content: null, quiz: [], content_version: null })
    const result = await fetchGroundSchoolContent('PPL-M05')
    expect(result.content).toBeNull()
    expect(result.quiz).toEqual([])
  })

  it('accepts a content response missing every optional section', async () => {
    ok({ content: {}, quiz: [], content_version: '2026-01-01T00:00:00Z' })
    const result = await fetchGroundSchoolContent('PPL-M02')
    expect(result.content).toEqual({})
  })

  it('rejects a malformed objectives entry', async () => {
    ok({ content: contentFixture({ objectives: [{ id: 'obj-1' }] }), quiz: [], content_version: null })
    const err = await captureError(fetchGroundSchoolContent('PPL-M01'))
    expect(err.kind).toBe('server')
  })

  it('rejects a malformed scenario (prompts not an array)', async () => {
    ok({ content: contentFixture({ scenario: { narrative: 'x', prompts: 'none' } }), quiz: [], content_version: null })
    const err = await captureError(fetchGroundSchoolContent('PPL-M01'))
    expect(err.kind).toBe('server')
  })

  it('rejects a malformed apexChallenge field type', async () => {
    ok({ content: contentFixture({ apexChallenge: { instructions: 'x', fields: [{ id: 'f1', type: 'checkbox', label: 'x' }] } }), quiz: [], content_version: null })
    const err = await captureError(fetchGroundSchoolContent('PPL-M01'))
    expect(err.kind).toBe('server')
  })

  it('rejects a quiz question with an invalid question_type', async () => {
    ok({ content: null, quiz: [quizFixture({ question_type: 'essay' })], content_version: null })
    const err = await captureError(fetchGroundSchoolContent('PPL-M03'))
    expect(err.kind).toBe('server')
  })

  it('accepts a short_answer quiz question with null choices/correct_choice', async () => {
    ok({ content: null, quiz: [quizFixture({ question_type: 'short_answer', choices: null, correct_choice: null })], content_version: null })
    const result = await fetchGroundSchoolContent('PPL-M02')
    expect(result.quiz[0].correct_choice).toBeNull()
  })

  it('rejects a response with a non-string/non-null content_version', async () => {
    ok({ content: null, quiz: [], content_version: 12345 })
    const err = await captureError(fetchGroundSchoolContent('PPL-M01'))
    expect(err.kind).toBe('server')
  })
})
