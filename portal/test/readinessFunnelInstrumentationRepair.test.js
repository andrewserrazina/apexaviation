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
    const marker = 'async function sendEmail(supabase: any, to: string, subject: string, contentHtml: string) {'
    const startIdx = lifecycleSource.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const endIdx = lifecycleSource.indexOf('\n}', startIdx)
    const body = lifecycleSource.slice(startIdx, endIdx)
    expect(body).toContain("return await supabase.functions.invoke('send-email'")
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

  it('checks res?.error for all three of day1/day3/day6 before stamping the corresponding _sent_at column', () => {
    const body = followupBody()
    for (const day of ['day1', 'day3', 'day6']) {
      const column = `email_${day}_sent_at`
      const stampIdx = body.indexOf(`.update({ ${column}:`)
      expect(stampIdx, `${column} stamp not found`).toBeGreaterThan(-1)
      // The nearest preceding `if (res?.error)` guard must come before the
      // stamp, and the stamp itself must be inside that guard's `else`
      // branch (i.e. the stamp text appears between the `else {` and its
      // matching `}`, which in this straight-line code just means it
      // appears after an `else {` that itself follows the res?.error check).
      const precedingBlock = body.slice(0, stampIdx)
      const lastResCheck = precedingBlock.lastIndexOf('if (res?.error)')
      const lastElse = precedingBlock.lastIndexOf('} else {')
      expect(lastResCheck, `${column}: no preceding res?.error check`).toBeGreaterThan(-1)
      expect(lastElse, `${column}: no preceding else branch`).toBeGreaterThan(lastResCheck)
    }
  })

  it('a failed send pushes a descriptive, day-labeled message into results.errors for all three days', () => {
    const body = followupBody()
    expect(body).toContain('readiness_assessment_followup day1 ${lead.id}: send-email failed:')
    expect(body).toContain('readiness_assessment_followup day3 ${lead.id}: send-email failed:')
    expect(body).toContain('readiness_assessment_followup day6 ${lead.id}: send-email failed:')
  })

  it('results.readiness_assessment_followup is only incremented on the success (non-error) path', () => {
    const body = followupBody()
    // Every increment must be preceded (within the same else-branch window)
    // by the _sent_at stamp for the same day -- i.e. increments never
    // happen directly after the sendEmail() call without the res?.error
    // check in between.
    const incrementCount = (body.match(/results\.readiness_assessment_followup\+\+/g) || []).length
    expect(incrementCount).toBe(3)
    for (const day of ['day1', 'day3', 'day6']) {
      const column = `email_${day}_sent_at`
      const stampIdx = body.indexOf(`.update({ ${column}:`)
      const nextIncrementIdx = body.indexOf('results.readiness_assessment_followup++', stampIdx)
      const nextResCheck = body.indexOf('if (res?.error)', stampIdx + 1)
      // The increment immediately following this day's stamp must come
      // before the NEXT day's res?.error check (i.e. belongs to this
      // branch), or there is no next check (this is the last day).
      if (nextResCheck !== -1) {
        expect(nextIncrementIdx).toBeLessThan(nextResCheck)
      } else {
        expect(nextIncrementIdx).toBeGreaterThan(-1)
      }
    }
  })

  it('does not change the day-eligibility thresholds (daysOld >= 1/3/6) or the mutual-exclusivity of the three branches', () => {
    const body = followupBody()
    expect(body).toContain('if (daysOld >= 1 && !lead.email_day1_sent_at)')
    expect(body).toContain('} else if (daysOld >= 3 && !lead.email_day3_sent_at)')
    expect(body).toContain('} else if (daysOld >= 6 && !lead.email_day6_sent_at)')
  })
})
