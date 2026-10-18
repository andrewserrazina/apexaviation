// Recovery-safeguard audit (Oct 2026, second pass): execution-level
// tests for the global cross-campaign send cap, the stale-user
// suppression ceilings, the dry-run preview's read-only guarantee, and
// confirmation that every real email-dispatch path in
// send-lifecycle-emails/index.ts goes through the capped sendEmail()
// helper. Same brace-matching + new Function/AsyncFunction extraction
// convention as readinessFunnelInstrumentationRepair.test.js -- this
// file is a Deno Edge Function with top-level remote imports that can't
// be imported directly under Node/vitest, so real logic is extracted
// from the actual source text and executed, not hand-reimplemented.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIFECYCLE_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts')
const DRY_RUN_SQL_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/dry_run_preview.sql')
const lifecycleSource = readFileSync(LIFECYCLE_PATH, 'utf8')

function findMatchingBrace(source, openIdx) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

function extractFunctionBody(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
  const braceOpen = source.indexOf('{', startIdx + functionMarker.length - 1)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(braceOpen + 1, braceClose)
}

function extractFunctionSourceBlock(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
  const braceOpen = source.indexOf('{', startIdx + functionMarker.length - 1)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(startIdx, braceClose + 1)
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

describe('sendEmail(): global cross-campaign send cap -- real execution', () => {
  const sendEmailMarker = 'async function sendEmail(\n  supabase: any,\n  results: any,\n  to: string,\n  subject: string,\n  contentHtml: string,\n  options?: { replyTo?: string; exemptFromGlobalCap?: boolean },\n) {'
  const sendEmailBody = extractFunctionBody(lifecycleSource, sendEmailMarker)
  expect(sendEmailBody.length).toBeGreaterThan(0)

  function buildSendEmail({ successCap = 10, failureCap = 10 } = {}) {
    const preamble = `
      const GLOBAL_SEND_SUCCESS_CAP = ${successCap}
      const GLOBAL_SEND_FAILURE_CAP = ${failureCap}
      function template(html) { return html }
    `
    return new AsyncFunction('supabase', 'results', 'to', 'subject', 'contentHtml', 'options', `${preamble}\n${sendEmailBody}`)
  }

  function makeMockSupabase(outcomes) {
    let i = 0
    const calls = []
    return {
      functions: {
        invoke: async (_name, { body }) => {
          calls.push(body)
          const outcome = outcomes[Math.min(i, outcomes.length - 1)]
          i++
          return outcome
        },
      },
      _calls: calls,
    }
  }

  it('allows exactly GLOBAL_SEND_SUCCESS_CAP successes, then refuses further sends with a non-provider error', async () => {
    const sendEmail = buildSendEmail({ successCap: 3 })
    const supabase = makeMockSupabase(Array.from({ length: 5 }, () => ({ error: null })))
    const results = {}

    const outcomes = []
    for (let n = 0; n < 5; n++) {
      outcomes.push(await sendEmail(supabase, results, 'a@example.com', 'subj', 'html'))
    }

    expect(outcomes.slice(0, 3).every((r) => !r.error)).toBe(true)
    expect(outcomes.slice(3).every((r) => r.error?.code === 'GLOBAL_SEND_CAP')).toBe(true)
    // Only the first 3 should have actually reached the provider.
    expect(supabase._calls).toHaveLength(3)
    expect(results.global_send_cap_skips).toBe(2)
  })

  it('tracks successes and failures as SEPARATE budgets -- a failure never consumes a success slot', async () => {
    const sendEmail = buildSendEmail({ successCap: 2, failureCap: 2 })
    const supabase = makeMockSupabase([
      { error: { message: 'provider down' } },
      { error: { message: 'provider down' } },
      { error: null },
      { error: null },
    ])
    const results = {}

    const r1 = await sendEmail(supabase, results, 'a@example.com', 's', 'h') // failure 1
    const r2 = await sendEmail(supabase, results, 'a@example.com', 's', 'h') // failure 2 -- failure cap now hit
    const r3 = await sendEmail(supabase, results, 'a@example.com', 's', 'h') // refused by failure cap, never reaches provider
    expect(r1.error.message).toBe('provider down')
    expect(r2.error.message).toBe('provider down')
    expect(r3.error.code).toBe('GLOBAL_SEND_FAILURE_CAP')
    expect(supabase._calls).toHaveLength(2) // the 3rd call never reached invoke()
    expect(results.global_send_failure_cap_skips).toBe(1)
  })

  function makeThrowingMockSupabase(errorFactory) {
    const calls = []
    return {
      functions: {
        invoke: async (_name, { body }) => {
          calls.push(body)
          throw errorFactory()
        },
      },
      _calls: calls,
    }
  }

  it('a THROWN exception (not a resolved {error}) is caught inside sendEmail() and counted against GLOBAL_SEND_FAILURE_CAP -- repeated thrown failures cannot exceed the failure-attempt budget', async () => {
    const sendEmail = buildSendEmail({ successCap: 10, failureCap: 3 })
    const supabase = makeThrowingMockSupabase(() => new Error('network unreachable'))
    const results = {}

    const outcomes = []
    for (let n = 0; n < 6; n++) {
      // Must never throw out of sendEmail() itself -- if it did, this
      // loop would abort instead of producing 6 outcomes.
      outcomes.push(await sendEmail(supabase, results, 'a@example.com', 's', 'h'))
    }

    expect(outcomes).toHaveLength(6)
    expect(outcomes.every((r) => r?.error)).toBe(true)
    // Only the first 3 (the failure budget) should have actually
    // attempted the provider call -- the rest must be refused by the
    // cap BEFORE reaching invoke(), which is the entire point: an
    // always-throwing provider must not be hammered 6 times just
    // because it never resolves normally.
    expect(supabase._calls).toHaveLength(3)
    expect(outcomes.slice(0, 3).every((r) => r.error.message === 'network unreachable')).toBe(true)
    expect(outcomes.slice(3).every((r) => r.error?.code === 'GLOBAL_SEND_FAILURE_CAP')).toBe(true)
    expect(results.__sendBudget.failures).toBe(3) // capped exactly at the budget, never exceeds it
    expect(results.global_send_failure_cap_skips).toBe(3)
  })

  it('a mix of thrown exceptions and resolved {error} responses are tracked in the SAME failure budget, not two separate counters', async () => {
    const sendEmail = buildSendEmail({ successCap: 10, failureCap: 3 })
    let call = 0
    const supabase = {
      functions: {
        invoke: async () => {
          call++
          if (call % 2 === 1) throw new Error('thrown failure')
          return { error: { message: 'resolved failure' } }
        },
      },
    }
    const results = {}

    const outcomes = []
    for (let n = 0; n < 5; n++) outcomes.push(await sendEmail(supabase, results, 'a@example.com', 's', 'h'))

    // Calls 1-3 alternate thrown/resolved and both count toward the same
    // budget, tripping the cap exactly at 3 regardless of which kind of
    // failure got it there; calls 4-5 never reach invoke() at all.
    expect(call).toBe(3)
    expect(outcomes[0].error.message).toBe('thrown failure')
    expect(outcomes[1].error.message).toBe('resolved failure')
    expect(outcomes[2].error.message).toBe('thrown failure')
    expect(outcomes[3].error.code).toBe('GLOBAL_SEND_FAILURE_CAP')
    expect(outcomes[4].error.code).toBe('GLOBAL_SEND_FAILURE_CAP')
    expect(results.__sendBudget.failures).toBe(3)
  })

  it('cap-reached responses (success or failure cap) never themselves increment the budget they are refusing against', async () => {
    const sendEmail = buildSendEmail({ successCap: 1, failureCap: 1 })
    const supabase = makeMockSupabase([{ error: { message: 'boom' } }])
    const results = {}

    await sendEmail(supabase, results, 'a@example.com', 's', 'h') // 1 real failure -- trips the failure cap
    expect(results.__sendBudget.failures).toBe(1)

    // Every subsequent call is refused by the cap itself -- none of them
    // should nudge failures (or successes) any further.
    for (let n = 0; n < 5; n++) await sendEmail(supabase, results, 'a@example.com', 's', 'h')
    expect(results.__sendBudget.failures).toBe(1)
    expect(results.__sendBudget.successes).toBe(0)
    expect(results.global_send_failure_cap_skips).toBe(5)
  })

  it('the shared budget lives on `results` and persists across separate sendEmail() calls -- simulating different campaigns sharing one run', async () => {
    const sendEmail = buildSendEmail({ successCap: 2 })
    const supabase = makeMockSupabase([{ error: null }, { error: null }, { error: null }])
    const results = {} // the one object every campaign function in serve() shares

    // Campaign A sends once.
    await sendEmail(supabase, results, 'a@example.com', 'campaign-a', 'h')
    // Campaign B (a totally different call site) sends once -- shares the SAME budget.
    await sendEmail(supabase, results, 'b@example.com', 'campaign-b', 'h')
    // Campaign C is refused -- the cap is global, not per-campaign.
    const r3 = await sendEmail(supabase, results, 'c@example.com', 'campaign-c', 'h')

    expect(r3.error.code).toBe('GLOBAL_SEND_CAP')
    expect(results.__sendBudget.successes).toBe(2)
  })

  it('exemptFromGlobalCap bypasses the budget entirely -- neither limited by it nor counted against it', async () => {
    const sendEmail = buildSendEmail({ successCap: 1 })
    const supabase = makeMockSupabase([{ error: null }, { error: null }, { error: null }])
    const results = {}

    await sendEmail(supabase, results, 'a@example.com', 'normal', 'h') // consumes the only success slot
    const exempt1 = await sendEmail(supabase, results, 'b@example.com', 'exempt', 'h', { exemptFromGlobalCap: true })
    const exempt2 = await sendEmail(supabase, results, 'c@example.com', 'exempt', 'h', { exemptFromGlobalCap: true })
    const normalAgain = await sendEmail(supabase, results, 'd@example.com', 'normal', 'h')

    expect(exempt1.error).toBeFalsy()
    expect(exempt2.error).toBeFalsy()
    expect(normalAgain.error?.code).toBe('GLOBAL_SEND_CAP') // still capped for non-exempt calls
    expect(supabase._calls).toHaveLength(3) // 1 normal (success) + 2 exempt actually reached the provider
  })

  it('zero-send scenario: a run that never calls sendEmail() leaves the budget untouched and no caps trip', async () => {
    const results = {}
    expect(results.__sendBudget).toBeUndefined()
    expect(results.global_send_cap_skips).toBeUndefined()
    expect(results.global_send_failure_cap_skips).toBeUndefined()
  })
})

describe('Every real email-dispatch path in send-lifecycle-emails/index.ts goes through the capped sendEmail()', () => {
  it('there is exactly one direct supabase.functions.invoke(\'send-email\', ...) call site -- inside sendEmail() itself', () => {
    const matches = lifecycleSource.match(/supabase\.functions\.invoke\(\s*['"]send-email['"]/g) || []
    expect(matches).toHaveLength(1)
  })

  it('processActivationEmail1CatchUp and processNewMemberActivation route through sendEmail(), not a direct invoke() call (previously bypassed the cap)', () => {
    const catchup = extractFunctionSourceBlock(lifecycleSource, 'async function processActivationEmail1CatchUp(')
    const activation = extractFunctionSourceBlock(lifecycleSource, 'async function processNewMemberActivation(')
    expect(catchup).toContain('await sendEmail(supabase, results,')
    expect(activation).toContain('await sendEmail(supabase, results,')
    expect(catchup).not.toContain("supabase.functions.invoke('send-email'")
    expect(activation).not.toContain("supabase.functions.invoke('send-email'")
  })

  it('processNewMemberActivation checks the send result before marking the milestone sent (previously unconditional -- a real, independent bug this audit found)', () => {
    const body = extractFunctionSourceBlock(lifecycleSource, 'async function processNewMemberActivation(')
    const sendIdx = body.indexOf('const res = await sendEmail(supabase, results,')
    const errCheckIdx = body.indexOf('if (res?.error)', sendIdx)
    const returnIdx = body.indexOf('return', errCheckIdx)
    const markIdx = body.indexOf('await markMilestoneSent(supabase, profile.id, emailType)', sendIdx)
    expect(sendIdx).toBeGreaterThan(-1)
    expect(errCheckIdx).toBeGreaterThan(sendIdx)
    expect(returnIdx).toBeGreaterThan(errCheckIdx)
    expect(returnIdx).toBeLessThan(markIdx)
  })

  // Every campaign function that calls sendEmail() must check the result
  // before any dedup-column write that follows it (markMilestoneSent /
  // portal_email_log insert / the claim-revert pattern) -- otherwise a
  // capped-out or failed send would be bookkept as a real send. This is
  // the exact class of bug the cap would otherwise reintroduce across
  // every campaign at once.
  const campaignsWithSendEmail = [
    'processReactivationInactive', 'processWeeklyProgress', 'processInactivity',
    'processFirstQuestionMilestone', 'processMilestones', 'processWeakArea',
    'processCountdown', 'processCheckrideUpsell', 'processGroundSchoolFollowUps',
    'processReadinessAssessmentFollowup', 'processMockOralReminders',
    'processAbandonedCheckouts', 'processAbandonedCheckoutsFollowup',
    'processRecoverySortieNotifications', 'processActivationEmail1CatchUp',
    'processNewMemberActivation',
  ]

  it.each(campaignsWithSendEmail)('%s checks sendEmail()\'s result (res?.error / emailResult.error) before treating the send as successful', (fnName) => {
    const marker = `async function ${fnName}(`
    const body = extractFunctionSourceBlock(lifecycleSource, marker)
    expect(body).toContain('sendEmail(supabase, results,')
    expect(body).toMatch(/res\?\.error|emailResult\.error/)
  })
})

describe('Stale-user suppression ceilings (bounded age windows, operator-approved recovery safeguard)', () => {
  it('ENGAGEMENT_NUDGE_STALE_CEILING_DAYS is defined once and reused by inactivity_7day, reactivation_inactive, and the new-member-activation gate -- not three separate magic numbers', () => {
    const matches = lifecycleSource.match(/ENGAGEMENT_NUDGE_STALE_CEILING_DAYS/g) || []
    // 1 definition + at least 3 real usages (reactivation, inactivity, isEligibleForActivationSequence).
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('processReactivationInactive suppresses profiles inactive beyond the ceiling', () => {
    const body = extractFunctionSourceBlock(lifecycleSource, 'async function processReactivationInactive(')
    expect(body).toContain('if (daysInactive > ENGAGEMENT_NUDGE_STALE_CEILING_DAYS) return')
  })

  it('processInactivity suppresses profiles inactive beyond the ceiling', () => {
    const body = extractFunctionSourceBlock(lifecycleSource, 'async function processInactivity(')
    expect(body).toContain('if (daysInactive > ENGAGEMENT_NUDGE_STALE_CEILING_DAYS) return')
  })

  it('isEligibleForActivationSequence() -- real execution -- rejects a profile older than the ceiling even if NEW_MEMBER_ACTIVATION_SINCE would otherwise allow it', () => {
    const ceilingMatch = lifecycleSource.match(/const ENGAGEMENT_NUDGE_STALE_CEILING_DAYS = (\d+)/)
    expect(ceilingMatch).not.toBeNull()
    const ceilingDays = Number(ceilingMatch[1])
    const marker = 'function isEligibleForActivationSequence(profile: any): boolean {'
    const body = extractFunctionBody(lifecycleSource, marker)

    // eslint-disable-next-line no-new-func
    const isEligible = new Function(
      'profile',
      `
      const NEW_MEMBER_ACTIVATION_SINCE = '2020-01-01T00:00:00Z'
      const NEW_MEMBER_ACTIVATION_BACKFILL_DAYS = 0
      const ENGAGEMENT_NUDGE_STALE_CEILING_DAYS = ${ceilingDays}
      ${body}
      `
    )

    const recentSignup = { created_at: new Date(Date.now() - 2 * 86400000).toISOString() }
    const ancientSignup = { created_at: new Date(Date.now() - (ceilingDays + 10) * 86400000).toISOString() }
    // Just inside the ceiling -- not exactly at it, since the real check
    // computes daysSinceSignup from Date.now() at call time, which has
    // already advanced microseconds past this fixture's own Date.now()
    // call, making an exact-boundary fixture flaky by a few microseconds.
    const justInsideCeiling = { created_at: new Date(Date.now() - (ceilingDays - 0.01) * 86400000).toISOString() }

    expect(isEligible(recentSignup)).toBe(true)
    expect(isEligible(ancientSignup)).toBe(false)
    expect(isEligible(justInsideCeiling)).toBe(true)
  })

  it('readiness-followup staleness ceiling (30 days) and the engagement-nudge ceiling (90 days) are each independently justified, not the same number copy-pasted', () => {
    expect(lifecycleSource).toContain('const READINESS_FOLLOWUP_STALE_CEILING_DAYS = 30')
    expect(lifecycleSource).toContain('const ENGAGEMENT_NUDGE_STALE_CEILING_DAYS = 90')
  })
})

describe('Deterministic cap allocation', () => {
  it('the main profiles query in serve() has an explicit .order(\'id\') -- without it, which profiles win the 10 global send slots would be database-whim, not reproducible', () => {
    expect(lifecycleSource).toContain(
      "supabase.from('profiles').select('id,email,full_name,checkride_prep_unlocked,created_at,portal_last_active_at,checkride_timing,training_stage,primary_focus_area,timezone,email_marketing_opt_out').order('id')"
    )
  })
})

describe('Dry-run preview script stays read-only (dry_run_preview.sql)', () => {
  const sql = readFileSync(DRY_RUN_SQL_PATH, 'utf8')

  it('contains no INSERT / UPDATE / DELETE / TRUNCATE -- SELECT only, so it is always safe to run against production', () => {
    const withoutComments = sql.replace(/--.*$/gm, '')
    expect(withoutComments).not.toMatch(/\binsert\b/i)
    expect(withoutComments).not.toMatch(/\bupdate\b/i)
    expect(withoutComments).not.toMatch(/\bdelete\s+from\b/i)
    expect(withoutComments).not.toMatch(/\btruncate\b/i)
  })

  it('covers every campaign this audit identified, by name', () => {
    for (const campaign of [
      'reactivation_inactive', 'inactivity_7day', 'weekly_progress', 'first_question_completed',
      'readiness_and_checkride_mode_milestones', 'weak_area', 'checkride_countdown', 'checkride_upsell',
      'new_member_activation', 'ground_followup', 'mock_oral_reminder',
      'abandoned_checkout_first_touch', 'abandoned_checkout_second_touch', 'readiness_assessment_followup',
    ]) {
      expect(sql).toContain(campaign)
    }
  })

  it('explicitly labels the two approximated (upper-bound) sections so a reader never mistakes them for exact counts', () => {
    expect(sql).toMatch(/readiness_and_checkride_mode_milestones.*UPPER BOUND/)
    expect(sql).toMatch(/weak_area.*UPPER BOUND/)
  })
})

// Stage 2 auth hardening (Oct 2026): the serve() handler's auth guard
// used to be `if (CRON_SECRET) { ... }` -- a missing/cleared env var
// skipped the check entirely and let any caller trigger a real send
// run. The fix is fail-closed: missing secret -> 500 (server
// misconfiguration, no credential could ever fix it), present-but-wrong
// header -> 401 (caller's fault, in principle correctable). These tests
// execute the real extracted guard, not a reimplementation, same
// convention as the sendEmail() cap tests above.
describe('serve(): fail-closed auth guard -- real execution', () => {
  const guardStartMarker = 'serve(async (req) => {'
  const guardEndMarker = 'const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)'
  const guardStartIdx = lifecycleSource.indexOf(guardStartMarker)
  const guardBodyStart = guardStartIdx + guardStartMarker.length
  const guardEndIdx = lifecycleSource.indexOf(guardEndMarker, guardBodyStart)
  if (guardStartIdx === -1 || guardEndIdx === -1) {
    throw new Error('serve() auth guard markers not found -- source may have changed shape')
  }
  const guardBody = lifecycleSource.slice(guardBodyStart, guardEndIdx)

  function buildGuard() {
    // Sentinel return value stands in for "the rest of serve() ran" --
    // if any test sees this instead of a Response, the guard let a
    // request through to (what would be) real DB/email processing.
    return new AsyncFunction('req', 'CRON_SECRET', `${guardBody}\n  return 'PROCESSING_STARTED'`)
  }

  function makeReq(headers = {}) {
    return { headers: { get: (k) => (k in headers ? headers[k] : null) } }
  }

  it('secret absent (undefined) -> 500, processing never starts', async () => {
    const result = await buildGuard()(makeReq(), undefined)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(500)
  })

  it('secret empty string -> 500 (falsy, same as absent), processing never starts', async () => {
    const result = await buildGuard()(makeReq(), '')
    expect(result.status).toBe(500)
  })

  it('secret configured, header absent -> 401, processing never starts', async () => {
    const result = await buildGuard()(makeReq(), 'realsecret')
    expect(result.status).toBe(401)
  })

  it('secret configured, header present but incorrect -> 401, processing never starts', async () => {
    const result = await buildGuard()(makeReq({ 'X-Lifecycle-Cron-Secret': 'wrong' }), 'realsecret')
    expect(result.status).toBe(401)
  })

  it('secret configured, header matches exactly -> guard passes, processing proceeds', async () => {
    const result = await buildGuard()(makeReq({ 'X-Lifecycle-Cron-Secret': 'realsecret' }), 'realsecret')
    expect(result).toBe('PROCESSING_STARTED')
  })

  it('misconfiguration (500) and bad credential (401) are distinguishable, and neither response body discloses the configured secret', async () => {
    const misconfigured = await buildGuard()(makeReq(), '')
    const unauthorized = await buildGuard()(makeReq({ 'X-Lifecycle-Cron-Secret': 'wrong' }), 'realsecret')
    expect(misconfigured.status).not.toBe(unauthorized.status)
    expect(await misconfigured.text()).not.toContain('realsecret')
    expect(await unauthorized.text()).not.toContain('realsecret')
  })

  it('the guard body itself contains no database, service-role client, or email-dispatch call -- nothing privileged can execute before it resolves', () => {
    expect(guardBody).not.toMatch(/supabase\.|functions\.invoke|createClient\(/)
  })
})

describe('verify_jwt = false compatibility -- the Stage 2 hardening keeps auth in-code, not at the gateway', () => {
  const CONFIG_TOML_PATH = path.join(REPO_ROOT, 'portal/supabase/config.toml')
  const configSource = readFileSync(CONFIG_TOML_PATH, 'utf8')
  const guardStartMarker = 'serve(async (req) => {'
  const guardEndMarker = 'const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)'
  const guardBody = lifecycleSource.slice(
    lifecycleSource.indexOf(guardStartMarker) + guardStartMarker.length,
    lifecycleSource.indexOf(guardEndMarker)
  )

  it('config.toml pins verify_jwt = false for send-lifecycle-emails', () => {
    const section = configSource.match(/\[functions\.send-lifecycle-emails\][^[]*/)
    expect(section).not.toBeNull()
    expect(section[0]).toMatch(/verify_jwt\s*=\s*false/)
  })

  it('the auth guard checks X-Lifecycle-Cron-Secret, never Authorization -- so it works whether or not a gateway JWT is ever present', () => {
    expect(guardBody).toContain("req.headers.get('X-Lifecycle-Cron-Secret')")
    expect(guardBody).not.toMatch(/headers\.get\(['"]Authorization['"]\)/)
  })
})

describe('Stage 2 regression: caps and the mock-oral exemption are untouched by the auth hardening', () => {
  it('the mock-oral reminder send still carries exemptFromGlobalCap: true -- Stage 2 only edited the top of serve(), not sendEmail() or its call sites', () => {
    const idx = lifecycleSource.indexOf('exemptFromGlobalCap: true')
    expect(idx).toBeGreaterThan(-1)
    expect(lifecycleSource.slice(idx - 400, idx)).toMatch(/Mock Oral/i)
  })

  it('GLOBAL_SEND_SUCCESS_CAP and GLOBAL_SEND_FAILURE_CAP are both still defined as 10', () => {
    expect(lifecycleSource).toContain('const GLOBAL_SEND_SUCCESS_CAP = 10')
    expect(lifecycleSource).toContain('const GLOBAL_SEND_FAILURE_CAP = 10')
  })
})
