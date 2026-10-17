// Readiness Assessment funnel instrumentation audit -- regression
// coverage for the two gaps the audit confirmed against live production
// data: (1) a Stripe checkout-session-creation failure left zero
// server-side trace anywhere, and (2) a failed readiness-assessment
// follow-up email send was recorded as "sent" anyway, permanently
// skipping that lead on every future run. Same static-source-assertion
// approach as checkoutObservability.test.js/emailLifecycle.test.js:
// both touched files are Deno Edge Functions that can't be imported
// directly under Node/vitest (top-level remote URL imports,
// Deno.env.get() calls), so this asserts against the real source
// text/structure rather than trying to execute it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const checkoutSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/create-checkout-session/index.ts'), 'utf8')
const lifecycleSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts'), 'utf8')

describe('create-checkout-session/index.ts: server-side checkout-failure observability', () => {
  it('creates the Supabase client before the try block, so the catch block below can still use it', () => {
    const serveIdx = checkoutSource.indexOf('serve(async (req) => {')
    expect(serveIdx).toBeGreaterThan(-1)
    const tryIdx = checkoutSource.indexOf('try {', serveIdx)
    const supabaseCreateIdx = checkoutSource.indexOf('const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)', serveIdx)
    expect(supabaseCreateIdx).toBeGreaterThan(-1)
    expect(supabaseCreateIdx).toBeLessThan(tryIdx)
  })

  it('captures the requested purpose into an outer-scoped variable before any purpose branch runs', () => {
    const purposeAssignIdx = checkoutSource.indexOf('const purpose = body.purpose')
    const captureIdx = checkoutSource.indexOf('checkoutFailurePurpose = typeof purpose')
    expect(purposeAssignIdx).toBeGreaterThan(-1)
    expect(captureIdx).toBeGreaterThan(-1)
    expect(captureIdx).toBeGreaterThan(purposeAssignIdx)
    // Must happen before the first purpose branch (`if (purpose ===`), not after.
    const firstBranchIdx = checkoutSource.indexOf("if (purpose === 'unlock-checkride-prep')")
    expect(captureIdx).toBeLessThan(firstBranchIdx)
  })

  it('the outer catch block writes a checkout_session_create_failed analytics_events row before returning the error', () => {
    const catchIdx = checkoutSource.lastIndexOf('} catch (err) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBlock = checkoutSource.slice(catchIdx)
    const insertIdx = catchBlock.indexOf("event_name: 'checkout_session_create_failed'")
    const returnIdx = catchBlock.indexOf('return jsonError(String(err), 500)')
    expect(insertIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeLessThan(returnIdx)
    expect(catchBlock.slice(0, returnIdx)).toContain("from('analytics_events')")
    expect(catchBlock.slice(0, returnIdx)).toContain('checkoutFailurePurpose')
  })

  it('the observability write is itself wrapped in a try/catch, so a logging failure can never replace the real error response', () => {
    const catchIdx = checkoutSource.lastIndexOf('} catch (err) {')
    const catchBlock = checkoutSource.slice(catchIdx)
    const innerTryIdx = catchBlock.indexOf('try {')
    const insertIdx = catchBlock.indexOf("event_name: 'checkout_session_create_failed'")
    const innerCatchIdx = catchBlock.indexOf('} catch (logErr) {')
    const returnIdx = catchBlock.indexOf('return jsonError(String(err), 500)')
    expect(innerTryIdx).toBeGreaterThan(-1)
    expect(innerCatchIdx).toBeGreaterThan(-1)
    expect(innerTryIdx).toBeLessThan(insertIdx)
    expect(insertIdx).toBeLessThan(innerCatchIdx)
    // The real error response must still be returned unconditionally,
    // after the inner try/catch, not nested inside it.
    expect(innerCatchIdx).toBeLessThan(returnIdx)
  })

  it('does not touch any purpose branch -- no pricing/amount_cents/stripe.checkout.sessions.create call sites changed', () => {
    // Every purpose branch's Stripe call + logCheckoutAttempt() call
    // should still appear exactly as many times as before this repair --
    // this is a coarse guard against the repair having accidentally
    // touched branch logic instead of only the shared top/catch.
    const stripeCallCount = (checkoutSource.match(/stripe\.checkout\.sessions\.create\(/g) || []).length
    const logAttemptCount = (checkoutSource.match(/await logCheckoutAttempt\(/g) || []).length
    expect(stripeCallCount).toBeGreaterThanOrEqual(10)
    expect(logAttemptCount).toBeGreaterThanOrEqual(10)
    expect(stripeCallCount).toBe(logAttemptCount)
  })
})

describe('send-lifecycle-emails/index.ts: readiness-assessment follow-up send-failure handling', () => {
  it('sendEmail() now returns the invoke() result instead of discarding it', () => {
    const marker = 'async function sendEmail(\n  supabase: any,\n  results: any,\n  to: string,\n  subject: string,\n  contentHtml: string,'
    const startIdx = lifecycleSource.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const endIdx = lifecycleSource.indexOf('\n}', startIdx)
    const body = lifecycleSource.slice(startIdx, endIdx)
    expect(body).toContain("supabase.functions.invoke('send-email'")
    expect(body).toContain('return res')
  })

  function followupBody() {
    const marker = 'async function processReadinessAssessmentFollowup(supabase: any, results: any) {'
    const startIdx = lifecycleSource.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    let depth = 0
    let i = lifecycleSource.indexOf('{', startIdx)
    const braceOpen = i
    for (; i < lifecycleSource.length; i++) {
      if (lifecycleSource[i] === '{') depth++
      else if (lifecycleSource[i] === '}') { depth--; if (depth === 0) break }
    }
    return lifecycleSource.slice(braceOpen + 1, i)
  }

  it('checks res?.error immediately after sendEmail() and continues (skipping the stamp) on failure', () => {
    const body = followupBody()
    const sendIdx = body.indexOf('const res = await sendEmail(supabase, results, lead.email, subject, html)')
    expect(sendIdx).toBeGreaterThan(-1)
    const errCheckIdx = body.indexOf('if (res?.error)', sendIdx)
    const continueIdx = body.indexOf('continue', errCheckIdx)
    const stampIdx = body.indexOf("update({ [`email_${stage}_sent_at`]:", sendIdx)
    expect(errCheckIdx).toBeGreaterThan(sendIdx)
    expect(continueIdx).toBeGreaterThan(errCheckIdx)
    expect(stampIdx).toBeGreaterThan(-1)
    // The error-path continue must appear before the stamp, so a failed
    // send can never reach the _sent_at update at all.
    expect(continueIdx).toBeLessThan(stampIdx)
  })

  it('a failed send pushes a descriptive, stage-labeled message into results.errors', () => {
    const body = followupBody()
    expect(body).toContain('readiness_assessment_followup ${stage} ${lead.id}: send-email failed:')
  })

  it('results.readiness_assessment_followup is incremented right after a successful send, before the _sent_at update is attempted', () => {
    const body = followupBody()
    const incrementIdx = body.indexOf('results.readiness_assessment_followup++')
    const stampIdx = body.indexOf("update({ [`email_${stage}_sent_at`]:")
    expect(incrementIdx).toBeGreaterThan(-1)
    expect(stampIdx).toBeGreaterThan(incrementIdx)
  })

  it('checks the _sent_at update error too, and logs it as a known resend risk rather than ignoring it', () => {
    const body = followupBody()
    const stampIdx = body.indexOf("update({ [`email_${stage}_sent_at`]:")
    const updateErrCheckIdx = body.indexOf('if (updateErr)', stampIdx)
    expect(stampIdx).toBeGreaterThan(-1)
    expect(updateErrCheckIdx).toBeGreaterThan(stampIdx)
    expect(body.slice(updateErrCheckIdx)).toContain('sent_at update failed after a successful send')
  })

  it('enforces a per-run send cap and counts (rather than drops) capped-out leads', () => {
    const body = followupBody()
    expect(body).toContain('if (sentThisRun >= READINESS_FOLLOWUP_MAX_SENDS_PER_RUN)')
    expect(body).toContain('results.readiness_assessment_followup_capped_skips')
  })

  it('dispatches through readinessFollowupStage() instead of an unbounded daysOld >= N chain', () => {
    const body = followupBody()
    expect(body).toContain('const stage = readinessFollowupStage(daysOld,')
    expect(body).not.toMatch(/daysOld >= 1 && !lead\.email_day1_sent_at/)
  })
})

describe('send-lifecycle-emails/index.ts: readinessFollowupStage() -- real execution, not source matching', () => {
  // eslint-disable-next-line no-new-func
  const ceilingBody = (() => {
    const marker = 'const READINESS_FOLLOWUP_STALE_CEILING_DAYS = '
    const startIdx = lifecycleSource.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const endIdx = lifecycleSource.indexOf('\n', startIdx)
    return lifecycleSource.slice(startIdx, endIdx)
  })()

  function extractFunctionBody(source, functionMarker) {
    const startIdx = source.indexOf(functionMarker)
    if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
    const parenClose = source.indexOf(')', startIdx)
    const braceOpen = source.indexOf('{', parenClose)
    let depth = 0
    let i = braceOpen
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) break }
    }
    return source.slice(braceOpen + 1, i)
  }

  // eslint-disable-next-line no-new-func
  const readinessFollowupStage = new Function(
    'daysOld', 'sent',
    `${ceilingBody};\n${extractFunctionBody(lifecycleSource, 'function readinessFollowupStage(daysOld: number, sent: ReadinessFollowupSentFlags): ReadinessFollowupStage {')}`
  )

  const NONE_SENT = { day1: false, day3: false, day6: false }

  it('fires day1 inside [1, 3) days old when unsent', () => {
    expect(readinessFollowupStage(1.5, NONE_SENT)).toBe('day1')
    expect(readinessFollowupStage(0.9, NONE_SENT)).toBeNull()
  })

  it('fires day3 inside [3, 6) days old when unsent', () => {
    expect(readinessFollowupStage(4, NONE_SENT)).toBe('day3')
    expect(readinessFollowupStage(4, { ...NONE_SENT, day3: true })).toBeNull()
  })

  it('fires day6 at 6+ days old when unsent, with no upper bound below the staleness ceiling', () => {
    expect(readinessFollowupStage(6, NONE_SENT)).toBe('day6')
    expect(readinessFollowupStage(30, NONE_SENT)).toBe('day6')
    expect(readinessFollowupStage(6, { ...NONE_SENT, day6: true })).toBeNull()
  })

  it('a lead that is already well past the day1/day3 windows by the time it is first seen skips straight to day6 instead of firing stale day1/day3 copy', () => {
    // The real production case this repair targets: a lead stuck 13.7
    // days with nothing sent yet (the one real backlog lead at the time
    // of this audit) must land on day6, never day1 or day3.
    expect(readinessFollowupStage(13.7, NONE_SENT)).toBe('day6')
  })

  it('suppresses entirely once past the staleness ceiling, regardless of what has or has not been sent', () => {
    expect(readinessFollowupStage(46, NONE_SENT)).toBeNull()
    expect(readinessFollowupStage(46, { day1: true, day3: true, day6: false })).toBeNull()
  })

  it('never fires more than one stage for the same (daysOld, sent) snapshot', () => {
    for (const daysOld of [0.5, 1, 1.5, 2.9, 3, 4, 5.9, 6, 10, 44, 45, 46]) {
      const stage = readinessFollowupStage(daysOld, NONE_SENT)
      expect([null, 'day1', 'day3', 'day6']).toContain(stage)
    }
  })
})

describe('send-lifecycle-emails/index.ts: processReadinessAssessmentFollowup() -- real execution against a mocked Supabase client', () => {
  function extractAsyncFunctionBody(source, functionMarker) {
    const startIdx = source.indexOf(functionMarker)
    if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
    const parenClose = source.indexOf(')', startIdx)
    const braceOpen = source.indexOf('{', parenClose)
    let depth = 0
    let i = braceOpen
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) break }
    }
    return source.slice(braceOpen + 1, i)
  }

  function extractConst(source, constMarker) {
    const startIdx = source.indexOf(constMarker)
    expect(startIdx, `const not found: ${constMarker}`).toBeGreaterThan(-1)
    const endIdx = source.indexOf('\n', startIdx)
    return source.slice(startIdx, endIdx).replace(/;\s*$/, '')
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

  // Builds a real, executable processReadinessAssessmentFollowup() from
  // the actual shipped source (brace-matched, not hand-copied), with its
  // free variables (helpers this function calls but doesn't define)
  // supplied as closure parameters instead of re-implemented -- so this
  // test exercises the real orchestration logic (cap, dedup-by-profile,
  // error handling, stamp-after-send), not a parallel reimplementation
  // that could drift from the source.
  function buildProcessReadinessAssessmentFollowup() {
    const stageMarker = 'function readinessFollowupStage(daysOld: number, sent: ReadinessFollowupSentFlags): ReadinessFollowupStage {'
    const ceilingLine = extractConst(lifecycleSource, 'const READINESS_FOLLOWUP_STALE_CEILING_DAYS = ')
    const capLine = extractConst(lifecycleSource, 'const READINESS_FOLLOWUP_MAX_SENDS_PER_RUN = ')
    const stageBody = extractAsyncFunctionBody(lifecycleSource, stageMarker)
    const loopBody = extractAsyncFunctionBody(lifecycleSource, 'async function processReadinessAssessmentFollowup(supabase: any, results: any) {')

    const preamble = `
      ${ceilingLine};
      ${capLine};
      function readinessFollowupStage(daysOld, sent) { ${stageBody} }
      function readinessFollowupEmailContent(stage) { return { subject: 'subj-' + stage, html: '<p>html-' + stage + '</p>' } }
      function raWeakCategories() { return [] }
      function escapeIlike(v) { return v }
    `
    return new AsyncFunction('supabase', 'results', 'sendEmail', `${preamble}\n${loopBody}`)
  }

  // Minimal mock matching the subset of the real supabase-js chainable
  // query builder this function actually calls: .from('readiness_
  // assessment_leads').select(...) to list leads and .update(...).eq(...)
  // to stamp a _sent_at column, plus .from('profiles').select().ilike()
  // .maybeSingle() for the dedup lookup. Built as one object (not
  // composed via spread, which silently drops whichever property is
  // listed first) so every table always gets a consistent set of
  // methods.
  function makeSupabase({ leads, existingProfileEmails = new Set(), updateError = null } = {}) {
    const updateCalls = []
    return {
      from(table) {
        if (table === 'profiles') {
          return {
            select() { return this },
            ilike(_col, email) { this._email = email; return this },
            async maybeSingle() {
              return { data: existingProfileEmails.has(this._email) ? { id: 'existing' } : null }
            },
          }
        }
        // readiness_assessment_leads: the only other table this function touches.
        return {
          async select() { return { data: leads } },
          update(payload) {
            return {
              eq(_col, id) {
                updateCalls.push({ id, payload })
                return Promise.resolve({ error: updateError })
              },
            }
          },
        }
      },
      _updateCalls: updateCalls,
    }
  }

  function makeLead(overrides = {}) {
    return {
      id: overrides.id ?? 'lead-1',
      email: overrides.email ?? 'lead@example.com',
      full_name: 'Test Lead',
      checkride_timing: 'within_30_days',
      score: 72,
      readiness_level: 'Getting Close',
      category_results: {},
      created_at: new Date(Date.now() - (overrides.daysOld ?? 13.7) * 86400000).toISOString(),
      email_day1_sent_at: overrides.day1 ? new Date().toISOString() : null,
      email_day3_sent_at: overrides.day3 ? new Date().toISOString() : null,
      email_day6_sent_at: overrides.day6 ? new Date().toISOString() : null,
    }
  }

  it('sends exactly one email -- the day6 "last look" -- for a 13.7-day-old, never-contacted lead with no matching profile', async () => {
    const run = buildProcessReadinessAssessmentFollowup()
    const lead = makeLead({ daysOld: 13.7 })
    const supabase = makeSupabase({ leads: [lead] })
    const sent = []
    const sendEmail = async (_sb, _results, to, subject) => { sent.push({ to, subject }); return { error: null } }
    const results = { readiness_assessment_followup: 0, errors: [] }

    await run(supabase, results, sendEmail)

    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe('subj-day6')
    expect(results.readiness_assessment_followup).toBe(1)
    expect(results.errors).toHaveLength(0)
  })

  it('skips a lead entirely once its email matches an existing profile, even if it is otherwise eligible', async () => {
    const run = buildProcessReadinessAssessmentFollowup()
    const lead = makeLead({ daysOld: 13.7, email: 'member@example.com' })
    const supabase = makeSupabase({ leads: [lead], existingProfileEmails: new Set(['member@example.com']) })
    const sendEmail = async () => { throw new Error('sendEmail must not be called for an already-member lead') }
    const results = { readiness_assessment_followup: 0, errors: [] }

    await run(supabase, results, sendEmail)

    expect(results.readiness_assessment_followup).toBe(0)
    expect(results.errors).toHaveLength(0)
  })

  it('does not stamp _sent_at and logs a retryable error when the send itself fails', async () => {
    const run = buildProcessReadinessAssessmentFollowup()
    const lead = makeLead({ daysOld: 13.7 })
    const supabase = makeSupabase({ leads: [lead] })
    const sendEmail = async () => ({ error: { message: 'provider down' } })
    const results = { readiness_assessment_followup: 0, errors: [] }

    await run(supabase, results, sendEmail)

    expect(results.readiness_assessment_followup).toBe(0)
    expect(supabase._updateCalls).toHaveLength(0)
    expect(results.errors[0]).toMatch(/send-email failed.*provider down/)
  })

  it('logs (but does not drop) a successful send whose _sent_at update then fails', async () => {
    const run = buildProcessReadinessAssessmentFollowup()
    const lead = makeLead({ daysOld: 13.7 })
    const supabase = makeSupabase({ leads: [lead], updateError: { message: 'db write failed' } })
    const sendEmail = async () => ({ error: null })
    const results = { readiness_assessment_followup: 0, errors: [] }

    await run(supabase, results, sendEmail)

    // The send counts as a real send (it happened) even though the
    // bookkeeping write failed -- that failure is surfaced, not silent.
    expect(results.readiness_assessment_followup).toBe(1)
    expect(results.errors[0]).toMatch(/sent_at update failed after a successful send/)
  })

  it('stops sending once the per-run cap is hit and counts the rest as capped-skips instead of silently dropping them', async () => {
    const run = buildProcessReadinessAssessmentFollowup()
    const leads = Array.from({ length: 30 }, (_, i) => makeLead({ id: `lead-${i}`, email: `lead${i}@example.com`, daysOld: 13.7 }))
    const supabase = makeSupabase({ leads })
    const sendEmail = async () => ({ error: null })
    const results = { readiness_assessment_followup: 0, errors: [] }

    await run(supabase, results, sendEmail)

    expect(results.readiness_assessment_followup).toBe(25)
    expect(results.readiness_assessment_followup_capped_skips).toBe(5)
  })
})
