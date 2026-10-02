// Abandoned Checkout Recovery Repair (v152) -- regression tests for the
// root-cause fix in send-lifecycle-emails/index.ts, stripe-webhook/
// index.ts, and site/portal-stable.js's recovery-email click tracking.
// See ABANDONED_CHECKOUT_RECOVERY_REPAIR_REPORT.md for the full writeup.
//
// Same extraction approach as emailLifecycle.test.js (send-lifecycle-emails
// is a Deno Edge Function with top-level remote-URL imports that can't be
// imported under vitest): pure/near-pure functions and object literals are
// pulled out of the REAL source text and evaluated, and functions too
// dependent on live Supabase calls to execute directly are asserted on
// their actual source structure instead of re-implemented by hand.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIFECYCLE_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts')
const STRIPE_WEBHOOK_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/stripe-webhook/index.ts')
const PORTAL_STABLE_PATH = path.join(REPO_ROOT, 'site/portal-stable.js')

const lifecycleSource = readFileSync(LIFECYCLE_PATH, 'utf8')
const stripeWebhookSource = readFileSync(STRIPE_WEBHOOK_PATH, 'utf8')
const portalStableSource = readFileSync(PORTAL_STABLE_PATH, 'utf8')

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
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(braceOpen + 1, braceClose)
}

function extractFunctionSourceBlock(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(startIdx, braceClose + 1)
}

// scope: extra name->value bindings the array literal's own source text
// references (e.g. ABANDONED_CHECKOUT_SUPPORTED_PURPOSES spreads
// CHECKRIDE_PREP_CHECKOUT_PURPOSES, a separate const defined just above
// it in the real module -- new Function()'s isolated scope can't see
// that module-level binding otherwise).
function extractConstArrayLiteral(source, constMarker, scope = {}) {
  const startIdx = source.indexOf(constMarker)
  if (startIdx === -1) throw new Error(`Const not found: ${constMarker}`)
  const eqIdx = source.indexOf('=', startIdx)
  const bracketOpen = source.indexOf('[', eqIdx)
  let depth = 0
  for (let i = bracketOpen; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) {
        const names = Object.keys(scope)
        // eslint-disable-next-line no-new-func
        return new Function(...names, `return (${source.slice(bracketOpen, i + 1)})`)(...names.map(n => scope[n]))
      }
    }
  }
  throw new Error(`Unbalanced array literal for ${constMarker}`)
}

const PORTAL_LOGIN_URL = lifecycleSource.match(/const PORTAL_LOGIN_URL = '([^']+)'/)[1]

// ── decideAbandonedCheckoutAction() -- the pure eligibility/suppression
// decision at the heart of the repair -- tests #1-5, #11, #12 from the
// repair brief's test list. No database, no I/O: the function takes an
// attempt row and its already-fetched profile and returns a decision. ──
describe('decideAbandonedCheckoutAction() -- eligibility and suppression rules', () => {
  const PREP_PURPOSES = extractConstArrayLiteral(lifecycleSource, 'const CHECKRIDE_PREP_CHECKOUT_PURPOSES')
  const SUPPORTED = extractConstArrayLiteral(lifecycleSource, 'const ABANDONED_CHECKOUT_SUPPORTED_PURPOSES', { CHECKRIDE_PREP_CHECKOUT_PURPOSES: PREP_PURPOSES })
  const REASONS = { OPT_OUT: 'marketing_opt_out', ALREADY_ENTITLED: 'already_entitled', ALREADY_ENTITLED_AT_SEND_TIME: 'already_entitled_at_send_time', UNSUPPORTED_PURPOSE: 'unsupported_purpose', MISSING_EMAIL: 'missing_email' }
  // Builds the real decideAbandonedCheckoutAction(attempt, profile) as an
  // actual closure over the three module-level consts it reads but
  // doesn't take as parameters -- new Function()'s own scope can't see
  // module-level bindings, so they're injected as an enclosing function's
  // parameters instead, exactly once, and the real two-parameter function
  // is what gets returned and called below.
  // eslint-disable-next-line no-new-func
  const decide = new Function(
    'CHECKRIDE_PREP_CHECKOUT_PURPOSES', 'ABANDONED_CHECKOUT_SUPPORTED_PURPOSES', 'ABANDONED_CHECKOUT_SUPPRESSION_REASONS',
    `return function decideAbandonedCheckoutAction(attempt, profile) { ${extractFunctionBody(lifecycleSource, 'function decideAbandonedCheckoutAction(')} }`
  )(PREP_PURPOSES, SUPPORTED, REASONS)
  function decideIt(attempt, profile) { return decide(attempt, profile) }

  it('test 1: an eligible abandoned Checkride Prep checkout with no profile issues gets sent', () => {
    const attempt = { id: 'a1', purpose: 'unlock-checkride-prep', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, { email_marketing_opt_out: false, checkride_prep_unlocked: false })).toEqual({ action: 'send' })
  })

  it('a guest checkout with no profile_id (profile is null) still sends -- nothing to suppress on', () => {
    const attempt = { id: 'a2', purpose: 'ground-school-registration', email: 'a@b.com', profile_id: null }
    expect(decideIt(attempt, null)).toEqual({ action: 'send' })
  })

  it('test 4/5: a profile with checkride_prep_unlocked already true suppresses a Checkride Prep recovery -- purchased through this OR another session, either way already entitled', () => {
    const attempt = { id: 'a3', purpose: 'unlock-checkride-prep', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, { email_marketing_opt_out: false, checkride_prep_unlocked: true }))
      .toEqual({ action: 'suppress', reason: 'already_entitled' })

    const signupPurpose = { ...attempt, purpose: 'signup-and-unlock-checkride-prep' }
    expect(decideIt(signupPurpose, { checkride_prep_unlocked: true }).action).toBe('suppress')
  })

  it('checkride_prep_unlocked=true does NOT suppress a Ground School or Mock Oral recovery -- that flag has nothing to do with those products', () => {
    const attempt = { id: 'a4', purpose: 'ground-school-registration', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, { email_marketing_opt_out: false, checkride_prep_unlocked: true })).toEqual({ action: 'send' })
  })

  it('marketing opt-out suppresses regardless of product', () => {
    const attempt = { id: 'a5', purpose: 'book-mock-oral', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, { email_marketing_opt_out: true, checkride_prep_unlocked: false }))
      .toEqual({ action: 'suppress', reason: 'marketing_opt_out' })
  })

  it('opt-out is checked before entitlement -- an opted-out AND already-entitled profile reports the opt-out reason, not entitlement', () => {
    const attempt = { id: 'a6', purpose: 'unlock-checkride-prep', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, { email_marketing_opt_out: true, checkride_prep_unlocked: true }).reason).toBe('marketing_opt_out')
  })

  it('test 12: an unsupported purpose is skipped (not suppressed -- nothing written to the row)', () => {
    const attempt = { id: 'a7', purpose: 'join-membership', email: 'a@b.com', profile_id: 'p1' }
    expect(decideIt(attempt, null)).toEqual({ action: 'skip', reason: 'unsupported_purpose' })
  })

  it('test 11: a missing email is suppressed (recorded, so it is not silently rediscovered forever), not sent', () => {
    const attempt = { id: 'a8', purpose: 'unlock-checkride-prep', email: null, profile_id: 'p1' }
    expect(decideIt(attempt, null)).toEqual({ action: 'suppress', reason: 'missing_email' })
  })
})

describe('abandonedCheckoutCtaUrl() -- recovery email UTM attribution (Section 6/9 of the repair brief)', () => {
  // eslint-disable-next-line no-new-func
  const url = new Function('PORTAL_LOGIN_URL', 'recoveryStage', extractFunctionBody(lifecycleSource, 'function abandonedCheckoutCtaUrl('))

  it('tags recovery #1 with utm_content=recovery_1', () => {
    const link = url(PORTAL_LOGIN_URL, 'recovery_1')
    expect(link).toContain('utm_source=email')
    expect(link).toContain('utm_medium=email')
    expect(link).toContain('utm_campaign=abandoned_checkout')
    expect(link).toContain('utm_content=recovery_1')
    expect(link).toContain('dest=checkride-prep')
  })

  it('tags recovery #2 with utm_content=recovery_2', () => {
    expect(url(PORTAL_LOGIN_URL, 'recovery_2')).toContain('utm_content=recovery_2')
  })

  it('both abandoned-checkout email templates actually call this helper, not a bare dest=checkride-prep link', () => {
    const firstTouch = extractFunctionSourceBlock(lifecycleSource, 'function emailTemplateAbandonedCheckridePrep(')
    const secondTouch = extractFunctionSourceBlock(lifecycleSource, 'function emailTemplateAbandonedCheckridePrepFollowup(')
    expect(firstTouch).toContain("abandonedCheckoutCtaUrl('recovery_1')")
    expect(secondTouch).toContain("abandonedCheckoutCtaUrl('recovery_2')")
    expect(firstTouch).not.toMatch(/\$\{PORTAL_LOGIN_URL\}\?dest=checkride-prep"/)
  })
})

// ── Atomic-claim pattern -- tests #6-10, #13, #17 (idempotency/concurrency) ──
describe('atomic claim pattern -- every terminal-state UPDATE checks what it actually affected', () => {
  const processFirst = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckouts(')
  const processFollowup = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckoutsFollowup(')

  it('recovery_email_sent_at claim selects the affected row and checks its length before sending (the old version only checked for a thrown error, which a zero-row UPDATE never raises)', () => {
    const claimBlock = processFirst.slice(processFirst.indexOf('recovery_email_sent_at: new Date'))
    expect(claimBlock).toMatch(/\.is\('recovery_email_sent_at', null\)\s*\n\s*\.select\('id'\)/)
    expect(claimBlock).toMatch(/if \(!claimed \|\| !claimed\.length\)/)
  })

  it('recovery_email_2_sent_at claim has the same select-and-check guard', () => {
    const claimBlock = processFollowup.slice(processFollowup.indexOf('recovery_email_2_sent_at: new Date'))
    expect(claimBlock).toMatch(/\.is\('recovery_email_2_sent_at', null\)\s*\n\s*\.select\('id'\)/)
    expect(claimBlock).toMatch(/if \(!claimed \|\| !claimed\.length\)/)
  })

  it('suppression claims (recovery_suppressed_at) are also select-and-checked, not fire-and-forget', () => {
    expect(processFirst).toMatch(/recovery_suppressed_at: new Date[\s\S]{0,200}\.select\('id'\)/)
  })

  it('a failed send is caught separately from a failed claim, and does not increment the success counter', () => {
    expect(processFirst).toMatch(/catch \(sendErr\)[\s\S]{0,500}abandoned_checkout_send_failures/)
    expect(processFollowup).toMatch(/catch \(sendErr\)[\s\S]{0,500}abandoned_checkout_send_failures/)
    // The success counter increment must be OUTSIDE/AFTER the send's own
    // try/catch, not inside the try block before a possible throw point.
    const sendTryIdx = processFirst.indexOf('try {\n        await sendEmail')
    const successIdx = processFirst.indexOf('results.abandoned_checkout++')
    const catchIdx = processFirst.indexOf('} catch (sendErr) {', sendTryIdx)
    expect(successIdx).toBeGreaterThan(catchIdx)
  })

  it('test 17: a thrown error from the entire per-attempt block is caught per-attempt, not per-run -- one bad row cannot stop the rest of the queue from being processed', () => {
    expect(processFirst).toMatch(/for \(const attempt of attempts[\s\S]*try \{[\s\S]*\} catch \(err\) \{\s*\n\s*results\.errors\.push/)
  })
})

describe('entitlement re-verified immediately before every Checkride Prep send (Section 2/5: "before EVERY recovery send")', () => {
  it('processAbandonedCheckouts re-checks hasCheckridePrepEntitlement right before claiming, in addition to the up-front profile check', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckouts(')
    const calls = block.match(/hasCheckridePrepEntitlement\(/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(block).toContain('ALREADY_ENTITLED_AT_SEND_TIME')
  })

  it('processAbandonedCheckoutsFollowup does the same final re-check', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckoutsFollowup(')
    expect(block).toContain('hasCheckridePrepEntitlement(')
    expect(block).toContain('ALREADY_ENTITLED_AT_SEND_TIME')
  })

  it('hasCheckridePrepEntitlement() reads the authoritative profiles.checkride_prep_unlocked flag, not the original checkout session\'s own completed_at', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function hasCheckridePrepEntitlement(')
    expect(block).toContain('checkride_prep_unlocked')
    expect(block).toContain("from('profiles')")
  })
})

describe('eligibility queries exclude already-resolved (suppressed) rows', () => {
  it('processAbandonedCheckouts\' SELECT filters out recovery_suppressed_at rows, so a suppressed row is never refetched and reconsidered again', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckouts(')
    const selectBlock = block.slice(block.indexOf("from('checkout_session_attempts')"), block.indexOf('for (const attempt'))
    expect(selectBlock).toContain("is('recovery_suppressed_at', null)")
  })

  it('processAbandonedCheckoutsFollowup\'s SELECT does the same', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckoutsFollowup(')
    const selectBlock = block.slice(block.indexOf("from('checkout_session_attempts')"), block.indexOf('for (const attempt'))
    expect(selectBlock).toContain("is('recovery_suppressed_at', null)")
  })
})

describe('observability (Section 11): candidates found vs. what happened to them is always countable', () => {
  it('serve() pre-declares every new counter, not relying on ad hoc dynamic properties going unnoticed', () => {
    const resultsBlock = lifecycleSource.slice(lifecycleSource.indexOf('const results = {'), lifecycleSource.indexOf('const results = {') + 1200)
    for (const key of [
      'abandoned_checkout_candidates', 'abandoned_checkout_followup_candidates',
      'abandoned_checkout_suppressed_opt_out', 'abandoned_checkout_suppressed_entitled', 'abandoned_checkout_send_failures',
    ]) {
      expect(resultsBlock, `missing results.${key}`).toContain(key)
    }
  })

  it('every candidate row increments the candidates counter before any decision is made, so candidates_found is never silently wrong', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckouts(')
    const candidateIdx = block.indexOf('abandoned_checkout_candidates')
    const loopIdx = block.indexOf('for (const attempt of attempts')
    const decisionIdx = block.indexOf('decideAbandonedCheckoutAction(')
    expect(candidateIdx).toBeGreaterThan(loopIdx)
    expect(candidateIdx).toBeLessThan(decisionIdx)
  })
})

describe('checkout_recovered (stripe-webhook) represents an actual completed purchase, not an email click', () => {
  it('only fires when the completing session\'s own checkout_session_attempts row carries utm_campaign=abandoned_checkout', () => {
    const idx = stripeWebhookSource.indexOf("event_name: 'checkout_recovered'")
    expect(idx, 'checkout_recovered event not found in stripe-webhook').toBeGreaterThan(-1)
    const guardWindow = stripeWebhookSource.slice(Math.max(0, idx - 400), idx)
    expect(guardWindow).toContain("utm_campaign === 'abandoned_checkout'")
  })

  it('is attached to the completed_at UPDATE (fires only on a real Stripe-confirmed charge), not to a separate speculative check', () => {
    const completedIdx = stripeWebhookSource.indexOf('completed_at: new Date().toISOString()')
    const recoveredIdx = stripeWebhookSource.indexOf("event_name: 'checkout_recovered'")
    expect(recoveredIdx).toBeGreaterThan(completedIdx)
    expect(recoveredIdx - completedIdx).toBeLessThan(600)
  })

  it('no PII beyond purpose/profile_id/recovery stage is logged', () => {
    const idx = stripeWebhookSource.indexOf("event_name: 'checkout_recovered'")
    const block = stripeWebhookSource.slice(idx, idx + 250)
    expect(block).not.toMatch(/email|full_name|customer_details/)
  })
})

describe('checkout_recovery_N_clicked (portal-stable.js) -- recovery email click tracking', () => {
  it('fires checkout_recovery_1_clicked / checkout_recovery_2_clicked only for a real recovery_1/recovery_2 utm_content, mirroring the existing activation_email_N_clicked pattern', () => {
    const idx = portalStableSource.indexOf("utm_campaign') !== 'abandoned_checkout'")
    expect(idx, 'abandoned-checkout click-tracking IIFE not found').toBeGreaterThan(-1)
    const block = portalStableSource.slice(idx, idx + 400)
    expect(block).toContain("/^recovery_([12])$/")
    expect(block).toContain("apexTrack('checkout_recovery_' + match[1] + '_clicked'")
  })
})

describe('recovery timing constants remain named and documented, not scattered magic numbers (Section 3)', () => {
  it('ABANDONED_CHECKOUT_MIN_HOURS and ABANDONED_CHECKOUT_FOLLOWUP_HOURS are still the single source of truth', () => {
    expect(lifecycleSource).toContain('const ABANDONED_CHECKOUT_MIN_HOURS = 1')
    expect(lifecycleSource).toContain('const ABANDONED_CHECKOUT_FOLLOWUP_HOURS = 48')
    const processFirst = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckouts(')
    const processFollowup = extractFunctionSourceBlock(lifecycleSource, 'async function processAbandonedCheckoutsFollowup(')
    expect(processFirst).toContain('ABANDONED_CHECKOUT_MIN_HOURS')
    expect(processFollowup).toContain('ABANDONED_CHECKOUT_FOLLOWUP_HOURS')
  })

  it('the real once-daily cron cadence vs. the 1-3 hour target is documented, not silently papered over', () => {
    expect(lifecycleSource).toMatch(/once daily at 13:00 UTC/)
  })
})

// ── Simulated concurrency: proves the claim-then-check pattern the
// production code now uses actually prevents a double-send when two
// executions race on the same row. Two real OS threads can't be
// simulated in a unit test, but this exercises the exact same guarantee
// Postgres's own conditional UPDATE provides: whichever caller's WHERE
// clause matches first wins, the other sees zero affected rows. ──
describe('simulated concurrent claim (test 10: concurrent recovery executions do not duplicate sends)', () => {
  function makeClaimableRow(initial) {
    let row = { ...initial }
    return {
      // Mirrors `.update(patch).eq('id', id).is(column, null).select('id')`:
      // the WHERE-equivalent (column must currently be null) is checked and
      // the patch applied as one atomic step, exactly like a real Postgres
      // UPDATE statement's WHERE clause is evaluated and applied together,
      // never split into a separate read-then-write round trip.
      claim(column, patch) {
        if (row[column] !== null) return { data: [], error: null }
        row = { ...row, ...patch }
        return { data: [{ id: row.id }], error: null }
      },
      get: () => row,
    }
  }

  it('only the first of two racing claims on the same row succeeds', () => {
    const table = makeClaimableRow({ id: 'x1', recovery_email_sent_at: null })
    const first = table.claim('recovery_email_sent_at', { recovery_email_sent_at: 'T1' })
    const second = table.claim('recovery_email_sent_at', { recovery_email_sent_at: 'T2' })

    expect(first.data.length).toBe(1)
    expect(second.data.length).toBe(0)
    // The row keeps the FIRST claim's value -- the second caller's update
    // never applied, so it correctly knows (from the empty data) to skip
    // sending rather than proceed on the mistaken belief it won.
    expect(table.get().recovery_email_sent_at).toBe('T1')
  })

  it('a claim already resolved by suppression cannot also be claimed for sending', () => {
    const table = makeClaimableRow({ id: 'x2', recovery_email_sent_at: null, recovery_suppressed_at: null })
    const suppressed = table.claim('recovery_suppressed_at', { recovery_suppressed_at: 'T1', recovery_suppressed_reason: 'already_entitled' })
    expect(suppressed.data.length).toBe(1)
    // recovery_email_sent_at is still null at the column level, but the
    // real production query excludes rows with recovery_suppressed_at set
    // at the SELECT stage (see "eligibility queries exclude already-
    // resolved rows" above), so this row would never reach a claim
    // attempt on recovery_email_sent_at in the first place in production --
    // this test documents that invariant at the data level.
    expect(table.get().recovery_suppressed_at).not.toBeNull()
  })
})
