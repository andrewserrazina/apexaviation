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
