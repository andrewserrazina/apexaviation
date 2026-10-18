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
  const sendEmailMarker = 'async function sendEmail(\n  supabase: any,\n  results: any,\n  to: string,\n  subject: string,\n  contentHtml: string,\n  options?: { replyTo?: string; exemptFromGlobalCap?: boolean; marketingRecipientCap?: boolean },\n) {'
  const sendEmailBody = extractFunctionBody(lifecycleSource, sendEmailMarker)
  expect(sendEmailBody.length).toBeGreaterThan(0)

  function buildSendEmail({ successCap = 10, failureCap = 10, cooldownSeconds = 86400 } = {}) {
    const preamble = `
      const GLOBAL_SEND_SUCCESS_CAP = ${successCap}
      const GLOBAL_SEND_FAILURE_CAP = ${failureCap}
      const MARKETING_RECIPIENT_COOLDOWN_SECONDS = ${cooldownSeconds}
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

  // Stage 5 incident fix: mocks the real RPC this depends on
  // (claim_marketing_recipient_slot). claimedEmails is a shared Set so
  // concurrency tests can observe cross-call state, same idea as the
  // Stage 3 atomic-reservation mock.
  function makeMockSupabaseWithCooldown({ sendError = null, rpcError = null } = {}) {
    const claimedEmails = new Set()
    const invokeCalls = []
    const rpcCalls = []
    return {
      rpc: async (fnName, args) => {
        rpcCalls.push({ fnName, args })
        if (rpcError) return { data: null, error: rpcError }
        const key = String(args.p_email).toLowerCase().trim()
        if (claimedEmails.has(key)) return { data: false, error: null }
        claimedEmails.add(key)
        return { data: true, error: null }
      },
      functions: {
        invoke: async (_name, { body }) => {
          invokeCalls.push(body)
          return sendError ? { error: sendError } : { error: null }
        },
      },
      _invokeCalls: invokeCalls,
      _rpcCalls: rpcCalls,
      _claimedEmails: claimedEmails,
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

// Stage 5 incident fix (Oct 2026): a real production run sent one
// profile three separate marketing emails (inactivity, new-member
// activation, checkride upsell) within about a second, and another
// profile two (inactivity, checkride upsell) -- each campaign only
// dedups against itself, so nothing stopped several independently-
// eligible campaigns from firing for the same recipient in one run.
// These tests execute the real, updated sendEmail(), including its new
// marketingRecipientCap branch, against a mock of the real RPC it
// calls (claim_marketing_recipient_slot) -- not a reimplementation.
describe('sendEmail(): cross-campaign marketing recipient cooldown -- real execution', () => {
  const sendEmailMarker = 'async function sendEmail(\n  supabase: any,\n  results: any,\n  to: string,\n  subject: string,\n  contentHtml: string,\n  options?: { replyTo?: string; exemptFromGlobalCap?: boolean; marketingRecipientCap?: boolean },\n) {'
  const sendEmailBody = extractFunctionBody(lifecycleSource, sendEmailMarker)

  function buildSendEmail({ successCap = 10, failureCap = 10 } = {}) {
    const preamble = `
      const GLOBAL_SEND_SUCCESS_CAP = ${successCap}
      const GLOBAL_SEND_FAILURE_CAP = ${failureCap}
      const MARKETING_RECIPIENT_COOLDOWN_SECONDS = 86400
      function template(html) { return html }
    `
    return new AsyncFunction('supabase', 'results', 'to', 'subject', 'contentHtml', 'options', `${preamble}\n${sendEmailBody}`)
  }

  function makeMockSupabaseWithCooldown({ sendError = null, rpcError = null } = {}) {
    const claimedEmails = new Set()
    const invokeCalls = []
    const rpcCalls = []
    return {
      rpc: async (fnName, args) => {
        rpcCalls.push({ fnName, args })
        if (rpcError) return { data: null, error: rpcError }
        const key = String(args.p_email).toLowerCase().trim()
        if (claimedEmails.has(key)) return { data: false, error: null }
        claimedEmails.add(key)
        return { data: true, error: null }
      },
      functions: {
        invoke: async (_name, { body }) => {
          invokeCalls.push(body)
          return sendError ? { error: sendError } : { error: null }
        },
      },
      _invokeCalls: invokeCalls,
      _rpcCalls: rpcCalls,
      _claimedEmails: claimedEmails,
    }
  }

  it('two different marketing campaigns for the same recipient in the same run -- the second is suppressed, the first is not', async () => {
    const sendEmail = buildSendEmail()
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const first = await sendEmail(supabase, results, 'student@example.com', 'inactivity nudge', 'h', { marketingRecipientCap: true })
    const second = await sendEmail(supabase, results, 'student@example.com', 'checkride upsell', 'h', { marketingRecipientCap: true })
    expect(first.error).toBeFalsy()
    expect(second.error?.code).toBe('MARKETING_RECIPIENT_CAP')
    expect(supabase._invokeCalls).toHaveLength(1) // the provider was only ever called for the first campaign
    expect(results.marketing_recipient_cap_skips).toBe(1)
  })

  it('a suppressed send never consumes the global success/failure budget', async () => {
    const sendEmail = buildSendEmail()
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    await sendEmail(supabase, results, 'student@example.com', 'first', 'h', { marketingRecipientCap: true })
    const suppressed = await sendEmail(supabase, results, 'student@example.com', 'second', 'h', { marketingRecipientCap: true })
    expect(suppressed.error?.code).toBe('MARKETING_RECIPIENT_CAP')
    expect(results.__sendBudget).toEqual({ successes: 1, failures: 0 }) // only the first (real) send touched the budget
  })

  it('different recipients are independent -- no cross-talk between unrelated students', async () => {
    const sendEmail = buildSendEmail()
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const a = await sendEmail(supabase, results, 'studentA@example.com', 'subj', 'h', { marketingRecipientCap: true })
    const b = await sendEmail(supabase, results, 'studentB@example.com', 'subj', 'h', { marketingRecipientCap: true })
    expect(a.error).toBeFalsy()
    expect(b.error).toBeFalsy()
    expect(supabase._invokeCalls).toHaveLength(2)
  })

  it('two concurrent sendEmail() calls for the SAME recipient -- only one can claim the slot, the other is refused before the provider is ever called', async () => {
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const makeCall = () => buildSendEmail()(supabase, results, 'student@example.com', 'subj', 'h', { marketingRecipientCap: true })
    const [a, b] = await Promise.all([makeCall(), makeCall()])
    const errors = [a.error?.code, b.error?.code].filter(Boolean)
    expect(errors).toEqual(['MARKETING_RECIPIENT_CAP'])
    expect(supabase._invokeCalls).toHaveLength(1)
  })

  it('a provider failure after a successful claim is reported as an error, and the claim stays in effect -- an immediate retry to the same recipient is still refused', async () => {
    const supabase = makeMockSupabaseWithCooldown({ sendError: { message: 'provider down' } })
    const sendEmail = buildSendEmail()
    const results = {}
    const first = await sendEmail(supabase, results, 'student@example.com', 'subj', 'h', { marketingRecipientCap: true })
    expect(first.error.message).toBe('provider down')
    const retry = await sendEmail(supabase, results, 'student@example.com', 'subj (retry)', 'h', { marketingRecipientCap: true })
    expect(retry.error?.code).toBe('MARKETING_RECIPIENT_CAP') // claimed before the failed send, so it's still claimed
    expect(supabase._invokeCalls).toHaveLength(1) // the provider was never called a second time
  })

  it('the cooldown-claim RPC itself failing (a database error, not a normal "already claimed") is handled conservatively -- no send attempted', async () => {
    const supabase = makeMockSupabaseWithCooldown({ rpcError: { message: 'connection reset' } })
    const sendEmail = buildSendEmail()
    const results = {}
    const result = await sendEmail(supabase, results, 'student@example.com', 'subj', 'h', { marketingRecipientCap: true })
    expect(result.error?.code).toBe('MARKETING_RECIPIENT_CAP_CHECK_FAILED')
    expect(supabase._invokeCalls).toHaveLength(0)
    expect(results.marketing_recipient_cap_check_failures).toBe(1)
  })

  it('exempt sends (e.g. the mock-oral reminder) never touch the recipient cooldown at all, even to the same address already capped for marketing', async () => {
    const supabase = makeMockSupabaseWithCooldown()
    const sendEmail = buildSendEmail()
    const results = {}
    await sendEmail(supabase, results, 'student@example.com', 'inactivity', 'h', { marketingRecipientCap: true })
    const exempt = await sendEmail(supabase, results, 'student@example.com', 'mock oral reminder', 'h', { exemptFromGlobalCap: true })
    expect(exempt.error).toBeFalsy()
    expect(supabase._rpcCalls).toHaveLength(1) // only the marketing call touched the cooldown RPC at all
  })

  it('a plain non-marketing, non-exempt send (e.g. first_question_completed) is unaffected by another campaign\'s cooldown claim on the same recipient', async () => {
    const supabase = makeMockSupabaseWithCooldown()
    const sendEmail = buildSendEmail()
    const results = {}
    await sendEmail(supabase, results, 'student@example.com', 'inactivity', 'h', { marketingRecipientCap: true })
    const plain = await sendEmail(supabase, results, 'student@example.com', 'first question completed', 'h')
    expect(plain.error).toBeFalsy()
    expect(supabase._invokeCalls).toHaveLength(2)
  })

  // Review fix: the cooldown RPC used to run BEFORE the global cap
  // checks, so a call arriving after the cap was already exhausted
  // would still claim the recipient's 24h slot even though no email was
  // ever attempted -- incorrectly suppressing that recipient on a later
  // run for a send that never happened. The cap checks must run first.
  it('global success cap already exhausted -> GLOBAL_SEND_CAP, and the recipient cooldown is never even checked (no reservation made for a send that was never attempted)', async () => {
    const sendEmail = buildSendEmail({ successCap: 0 }) // already exhausted from the very first call
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const result = await sendEmail(supabase, results, 'student@example.com', 'inactivity', 'h', { marketingRecipientCap: true })
    expect(result.error?.code).toBe('GLOBAL_SEND_CAP')
    expect(supabase._rpcCalls).toHaveLength(0) // claim_marketing_recipient_slot was never called
    expect(supabase._invokeCalls).toHaveLength(0)
    expect(supabase._claimedEmails.size).toBe(0) // no reservation exists for this recipient
  })

  it('global failure cap already exhausted -> GLOBAL_SEND_FAILURE_CAP, and the recipient cooldown is never even checked', async () => {
    const sendEmail = buildSendEmail({ failureCap: 0 }) // already exhausted
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const result = await sendEmail(supabase, results, 'student@example.com', 'checkride upsell', 'h', { marketingRecipientCap: true })
    expect(result.error?.code).toBe('GLOBAL_SEND_FAILURE_CAP')
    expect(supabase._rpcCalls).toHaveLength(0)
    expect(supabase._claimedEmails.size).toBe(0)
  })

  it('the cap becoming exhausted MID-RUN (by a prior send) also prevents any further recipient-cooldown reservation for a different recipient', async () => {
    const sendEmail = buildSendEmail({ successCap: 1 })
    const supabase = makeMockSupabaseWithCooldown()
    const results = {}
    const first = await sendEmail(supabase, results, 'studentA@example.com', 'inactivity', 'h', { marketingRecipientCap: true })
    expect(first.error).toBeFalsy() // consumes the one success slot
    const second = await sendEmail(supabase, results, 'studentB@example.com', 'checkride upsell', 'h', { marketingRecipientCap: true })
    expect(second.error?.code).toBe('GLOBAL_SEND_CAP')
    expect(supabase._claimedEmails.has('studenta@example.com')).toBe(true) // the real first send did reserve
    expect(supabase._claimedEmails.has('studentb@example.com')).toBe(false) // the capped second send did not
  })
})

describe('Stage 5: marketingRecipientCap scoping matches the existing email_marketing_opt_out split', () => {
  it('all seven marketing-campaign sendEmail() call sites pass marketingRecipientCap: true', () => {
    const markers = [
      "sendEmail(supabase, results, profile.email, 'Pick up where you left off', emailTemplateReactivationInactive((profile.full_name || 'there').split(' ')[0]), { marketingRecipientCap: true })",
      "sendEmail(supabase, results, profile.email, 'Your Apex Weekly Training Report', emailTemplateWeeklyProgress({ questions, days, scenarios, aiDpe, strongest, weakest }), { marketingRecipientCap: true })",
      'sendEmail(supabase, results, profile.email, "We miss you at Apex Advantage", emailTemplateInactivity((profile.full_name || \'there\').split(\' \')[0]), { marketingRecipientCap: true })',
      'sendEmail(supabase, results, profile.email, content.subject, html, { marketingRecipientCap: true })',
      'sendEmail(supabase, results, profile.email, checkrideUpsellSubject(day, pricing), emailTemplateCheckrideUpsell(day, pricing, timingBucket), { marketingRecipientCap: true })',
      'sendEmail(supabase, results, profile.email, `A good place to start, ${firstName}`, html, { replyTo: ACTIVATION_REPLY_TO, marketingRecipientCap: true })',
      'sendEmail(supabase, results, profile.email, subject, html, { ...(replyTo ? { replyTo } : {}), marketingRecipientCap: true })',
    ]
    for (const marker of markers) expect(lifecycleSource).toContain(marker)
  })

  it('the three non-marketing per-profile campaigns (first_question_completed, milestones, countdown) do NOT carry marketingRecipientCap', () => {
    expect(lifecycleSource).toContain("sendEmail(supabase, results, profile.email, 'You completed your first question', emailTemplate1FirstQuestion())")
    expect(lifecycleSource).toContain('sendEmail(supabase, results, profile.email, `${score}% Checkride Ready`, emailTemplateMilestone(threshold))')
    expect(lifecycleSource).toContain("sendEmail(supabase, results, profile.email, 'Checkride Mode: complete', emailTemplateCheckrideModeDone())")
    expect(lifecycleSource).toContain('sendEmail(supabase, results, profile.email, `${threshold} ${daysNoun(threshold)} until your checkride`, emailTemplateCountdown(threshold))')
  })
})

describe('Stage 5: main per-profile loop stops once the global send budget is exhausted', () => {
  it('the loop body checks __sendBudget against both caps and breaks before any per-profile work, right after the loop opens', () => {
    const loopMarker = 'for (const profile of profiles ?? []) {'
    const loopStart = lifecycleSource.indexOf(loopMarker)
    expect(loopStart).toBeGreaterThan(-1)
    const nextChunk = lifecycleSource.slice(loopStart, loopStart + 1200)
    expect(nextChunk).toContain('const budget = results.__sendBudget')
    expect(nextChunk).toContain('budget.successes >= GLOBAL_SEND_SUCCESS_CAP || budget.failures >= GLOBAL_SEND_FAILURE_CAP')
    expect(nextChunk).toContain('break')
  })

  // Review fix: `break` exits the for-loop normally (not a `return`),
  // so control falls through to whatever follows it. This locks in
  // that run_streak_maintenance/processRecoverySortieNotifications/
  // refresh_mission_progress -- and the final Response -- still appear
  // AFTER the loop in source, i.e. still execute on every path out of
  // the loop, including an early break.
  it('post-loop maintenance (run_streak_maintenance, processRecoverySortieNotifications, refresh_mission_progress) and the final Response all still appear after the loop -- an early break still reaches them', () => {
    const loopStart = lifecycleSource.indexOf('for (const profile of profiles ?? []) {')
    const loopBodyStart = loopStart + 'for (const profile of profiles ?? []) {'.length
    const loopEnd = findMatchingBrace(lifecycleSource, lifecycleSource.indexOf('{', loopBodyStart - 1))
    const afterLoop = lifecycleSource.slice(loopEnd)
    expect(afterLoop.indexOf("supabase.rpc('run_streak_maintenance')")).toBeGreaterThan(-1)
    expect(afterLoop.indexOf('processRecoverySortieNotifications')).toBeGreaterThan(-1)
    expect(afterLoop.indexOf("supabase.rpc('refresh_mission_progress')")).toBeGreaterThan(-1)
    expect(afterLoop.indexOf('return new Response(JSON.stringify(results)')).toBeGreaterThan(-1)
  })
})

describe('Stage 5 review fix: global caps are checked before the recipient-cooldown reservation', () => {
  it('in source, both global-cap early-returns appear before the claim_marketing_recipient_slot RPC call', () => {
    const successCapIdx = lifecycleSource.indexOf("code: 'GLOBAL_SEND_CAP' } }")
    const failureCapIdx = lifecycleSource.indexOf("code: 'GLOBAL_SEND_FAILURE_CAP' } }")
    const rpcCallIdx = lifecycleSource.indexOf("supabase.rpc('claim_marketing_recipient_slot'")
    expect(successCapIdx).toBeGreaterThan(-1)
    expect(failureCapIdx).toBeGreaterThan(-1)
    expect(rpcCallIdx).toBeGreaterThan(-1)
    expect(successCapIdx).toBeLessThan(rpcCallIdx)
    expect(failureCapIdx).toBeLessThan(rpcCallIdx)
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

  // Stage 4 (Oct 2026): abandoned-checkout recovery and Readiness
  // Assessment follow-up are commercially time-sensitive and typically
  // have only a handful of candidates on any given day, but the bulk
  // per-profile loop (inactivity/reactivation/activation/checkride-
  // upsell -- hundreds of candidates at this audit) used to run first
  // and could exhaust the whole shared GLOBAL_SEND_SUCCESS_CAP before
  // these ever got a slot. This locks in that they now run first.
  it('abandoned-checkout recovery and Readiness Assessment follow-up run BEFORE the bulk per-profile loop, so they claim cap slots first', () => {
    const abandonedCheckoutIdx = lifecycleSource.indexOf('await processAbandonedCheckouts(supabase, results)')
    const readinessFollowupIdx = lifecycleSource.indexOf('await processReadinessAssessmentFollowup(supabase, results)')
    const mainLoopIdx = lifecycleSource.indexOf('for (const profile of profiles ?? [])')
    expect(abandonedCheckoutIdx).toBeGreaterThan(-1)
    expect(readinessFollowupIdx).toBeGreaterThan(-1)
    expect(mainLoopIdx).toBeGreaterThan(-1)
    expect(abandonedCheckoutIdx).toBeLessThan(mainLoopIdx)
    expect(readinessFollowupIdx).toBeLessThan(mainLoopIdx)
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

  it('the CRON_SECRET check itself (before the Stage 3 test-mode branch even starts) contains no database, service-role client, or email-dispatch call -- nothing privileged can execute before auth resolves', () => {
    // Narrower than guardBody on purpose: guardBody now also contains
    // the Stage 3 single-recipient test-mode block, which legitimately
    // does call createClient()/sendEmail() -- but only after its OWN
    // independent checks pass. This test is specifically about the
    // plain CRON_SECRET check having zero privileged calls, so it stops
    // at the test-mode block's own start marker.
    const cronCheckOnly = guardBody.slice(0, guardBody.indexOf("const testRecipientHeader = req.headers.get('X-Lifecycle-Test-Recipient')"))
    expect(cronCheckOnly.length).toBeGreaterThan(0)
    expect(cronCheckOnly).not.toMatch(/supabase\.|functions\.invoke|createClient\(/)
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

// Stage 3 (Oct 2026): a single-recipient test-mode branch, gated behind
// its own independent flag + recipient allowlist (on top of the
// existing LIFECYCLE_CRON_SECRET check), that must never touch the real
// profiles table or any real campaign's dedup/log tables, and must
// never fall through into the real batch below it. Real execution,
// same convention as the rest of this file -- the test-mode block's
// actual source is extracted and run, including the real sendEmail().
describe('serve(): single-recipient test mode -- real execution', () => {
  const testModeStartMarker = "const testRecipientHeader = req.headers.get('X-Lifecycle-Test-Recipient')"
  const realBatchMarker = 'const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)'
  const testModeStartIdx = lifecycleSource.indexOf(testModeStartMarker)
  const realBatchIdx = lifecycleSource.indexOf(realBatchMarker, testModeStartIdx)
  if (testModeStartIdx === -1 || realBatchIdx === -1) {
    throw new Error('test-mode block markers not found -- source may have changed shape')
  }
  const testModeBlock = lifecycleSource.slice(testModeStartIdx, realBatchIdx)

  const sendEmailMarker = 'async function sendEmail(\n  supabase: any,\n  results: any,\n  to: string,\n  subject: string,\n  contentHtml: string,\n  options?: { replyTo?: string; exemptFromGlobalCap?: boolean; marketingRecipientCap?: boolean },\n) {'
  // extractFunctionBody (not extractFunctionSourceBlock): the real
  // signature has TypeScript parameter type annotations (`supabase:
  // any`, etc.), which the native Function/AsyncFunction constructor
  // can't parse as plain JS. Same fix the top-of-file sendEmail() tests
  // already use -- reuse the real body text, rebuild an untyped
  // signature around it.
  const sendEmailBody = extractFunctionBody(lifecycleSource, sendEmailMarker)
  const sendEmailSource = `async function sendEmail(supabase, results, to, subject, contentHtml, options) {${sendEmailBody}}`

  // reserved/reservationError control the single lifecycle_test_reserve_send
  // RPC call directly -- no separate SELECT step exists anymore (that
  // was the race). rpcCalls/invokeCalls/insertCalls each record what was
  // actually called, so a test can assert the provider/log were (or
  // weren't) reached.
  function makeMockCreateClient({ reserved = true, reservationError = null, sendError = null, insertError = null } = {}) {
    const rpcCalls = []
    const invokeCalls = []
    const insertCalls = []
    const client = {
      rpc: async (fnName, args) => {
        rpcCalls.push({ fnName, args })
        return { data: reservationError ? null : reserved, error: reservationError }
      },
      from(table) {
        return {
          insert: async (row) => {
            insertCalls.push({ table, row })
            return { error: insertError }
          },
        }
      },
      functions: {
        invoke: async (_name, { body }) => {
          invokeCalls.push(body)
          return sendError ? { error: sendError } : { error: null }
        },
      },
    }
    const createClient = () => client
    createClient._rpcCalls = rpcCalls
    createClient._invokeCalls = invokeCalls
    createClient._insertCalls = insertCalls
    return createClient
  }

  // A second mock, used only for the concurrency test: its `rpc` does a
  // synchronous check-and-set with no `await` between reading and
  // writing `reservedAt`, modeling the atomicity a real single
  // `UPDATE ... WHERE ... RETURNING` SQL statement gets for free from
  // Postgres's row lock. This proves the CALLING code correctly treats
  // the RPC's boolean result as the sole arbiter (it never does a
  // second, separate check) -- true cross-connection atomicity is a
  // property of the SQL statement itself (see v159's migration
  // comment), not something a Node-only test can independently verify.
  function makeAtomicMockCreateClient({ failFirstSend = false } = {}) {
    let reservedAt = null
    const cooldownMs = 300000
    const rpcCalls = []
    const invokeCalls = []
    const insertCalls = []
    const client = {
      rpc: async (fnName, args) => {
        rpcCalls.push({ fnName, args })
        const now = Date.now()
        if (reservedAt !== null && now - reservedAt < cooldownMs) {
          return { data: false, error: null }
        }
        reservedAt = now
        return { data: true, error: null }
      },
      from(table) {
        return { insert: async (row) => { insertCalls.push({ table, row }); return { error: null } } }
      },
      functions: {
        invoke: async (_name, { body }) => {
          invokeCalls.push(body)
          return failFirstSend ? { error: { message: 'ambiguous network failure' } } : { error: null }
        },
      },
    }
    const createClient = () => client
    createClient._rpcCalls = rpcCalls
    createClient._invokeCalls = invokeCalls
    createClient._insertCalls = insertCalls
    return createClient
  }

  function buildTestModeHandler(createClient) {
    const preamble = `
      function template(html) { return html }
      function emailHeadline(t) { return '<h2>' + t + '</h2>' }
      function emailParagraph(t) { return '<p>' + t + '</p>' }
      ${sendEmailSource}
    `
    return new AsyncFunction(
      'req', 'LIFECYCLE_TEST_MODE_ENABLED', 'LIFECYCLE_TEST_RECIPIENT_EMAIL', 'LIFECYCLE_TEST_SEND_COOLDOWN_MS',
      'SUPABASE_URL', 'SERVICE_ROLE_KEY', 'createClient', 'console',
      `${preamble}\n${testModeBlock}\n  return 'FELL_THROUGH_TO_REAL_BATCH'`
    )
  }

  function makeReq(headers = {}) {
    return { headers: { get: (k) => (k in headers ? headers[k] : null) } }
  }

  const noopConsole = { log: () => {}, error: () => {} }

  it('no X-Lifecycle-Test-Recipient header -> falls through to real batch untouched (normal cron calls are unaffected)', async () => {
    const createClient = makeMockCreateClient()
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({}), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    expect(result).toBe('FELL_THROUGH_TO_REAL_BATCH')
    expect(createClient._invokeCalls).toHaveLength(0)
  })

  it('test mode disabled (flag false) -> 403, no send attempted, client never even constructed', async () => {
    const throwingCreateClient = () => { throw new Error('createClient should never be called when test mode is disabled') }
    const handler = buildTestModeHandler(throwingCreateClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), false, 'allowed@apexaviationtx.com', 300000, 'url', 'key', throwingCreateClient, noopConsole)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(403)
    expect((await result.clone().json()).reason).toBe('test mode disabled')
  })

  it('test recipient allowlist not configured -> 500, no send attempted', async () => {
    const throwingCreateClient = () => { throw new Error('should never be called') }
    const handler = buildTestModeHandler(throwingCreateClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'anyone@example.com' }), true, undefined, 300000, 'url', 'key', throwingCreateClient, noopConsole)
    expect(result.status).toBe(500)
  })

  it('recipient not on the allowlist -> 403, no send attempted', async () => {
    const createClient = makeMockCreateClient()
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'someone-else@example.com' }), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    expect(result.status).toBe(403)
    expect(createClient._invokeCalls).toHaveLength(0)
  })

  it('allowlisted recipient, case-insensitive match, reservation granted -> exactly one email sent to that one recipient, clearly marked as a test', async () => {
    const createClient = makeMockCreateClient({ reserved: true })
    const handler = buildTestModeHandler(createClient)
    const result = await handler(
      makeReq({ 'X-Lifecycle-Test-Recipient': 'ops@apexaviationtx.com' }),
      true, 'Ops@ApexAviationTX.com', 300000, 'url', 'key', createClient, noopConsole
    )
    expect(result.status).toBe(200)
    const body = await result.clone().json()
    expect(body.executed).toBe(true)
    expect(body.provider_accepted).toBe(true)
    expect(createClient._rpcCalls).toHaveLength(1)
    expect(createClient._rpcCalls[0].fnName).toBe('lifecycle_test_reserve_send')
    expect(createClient._rpcCalls[0].args.p_cooldown_seconds).toBe(300) // 300000ms / 1000
    expect(createClient._invokeCalls).toHaveLength(1)
    expect(createClient._invokeCalls[0].to).toBe('ops@apexaviationtx.com')
    expect(createClient._invokeCalls[0].subject).toContain('[Apex Lifecycle Test]')
    expect(createClient._insertCalls).toHaveLength(1) // the audit-log row, written after the send
  })

  it('reservation refused (cooldown active) -> 429, provider never called, no audit row written', async () => {
    const createClient = makeMockCreateClient({ reserved: false })
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    expect(result.status).toBe(429)
    expect(createClient._invokeCalls).toHaveLength(0)
    expect(createClient._insertCalls).toHaveLength(0)
  })

  it('reservation RPC itself errors (database failure) -> 500, provider never called -- a DB failure prevents sending, not just a lost cooldown row', async () => {
    const createClient = makeMockCreateClient({ reservationError: { message: 'connection reset' } })
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    expect(result.status).toBe(500)
    expect(createClient._invokeCalls).toHaveLength(0)
  })

  it('provider rejects the send -> reported as not accepted, and still audit-logged (the reservation, not this log, is what guards against duplicate sends)', async () => {
    const createClient = makeMockCreateClient({ sendError: { message: 'provider down' } })
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    const body = await result.clone().json()
    expect(body.executed).toBe(true)
    expect(body.provider_accepted).toBe(false)
    expect(body.provider_error).toContain('provider down')
    expect(createClient._insertCalls).toHaveLength(1)
    expect(createClient._insertCalls[0].row.provider_accepted).toBe(false)
  })

  it('audit-log insert failure after a successful send does not change the reported outcome -- the send already happened, only the log write failed', async () => {
    const createClient = makeMockCreateClient({ reserved: true, insertError: { message: 'log write failed' } })
    const handler = buildTestModeHandler(createClient)
    const result = await handler(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    const body = await result.clone().json()
    expect(body.executed).toBe(true)
    expect(body.provider_accepted).toBe(true)
  })

  it('two concurrent requests -- only one can reserve a send; the other is refused before ever calling the provider', async () => {
    const createClient = makeAtomicMockCreateClient()
    const handler = buildTestModeHandler(createClient)
    const makeCall = () => handler(
      makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }),
      true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole
    )
    const [a, b] = await Promise.all([makeCall(), makeCall()])
    expect([a.status, b.status].sort()).toEqual([200, 429])
    expect(createClient._invokeCalls).toHaveLength(1)
    expect(createClient._rpcCalls).toHaveLength(2)
  })

  it('an ambiguous/failed provider outcome still leaves the cooldown reserved -- an immediate retry cannot double-send', async () => {
    const createClient = makeAtomicMockCreateClient({ failFirstSend: true })
    const handler = buildTestModeHandler(createClient)
    const makeCall = () => handler(
      makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }),
      true, 'allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole
    )
    const first = await makeCall()
    const firstBody = await first.clone().json()
    expect(firstBody.executed).toBe(true)
    expect(firstBody.provider_accepted).toBe(false) // the ambiguous/failed outcome

    const second = await makeCall()
    expect(second.status).toBe(429) // still refused -- the reservation from the first call, taken before its failed send, is still active
    expect(createClient._invokeCalls).toHaveLength(1) // the provider was only ever called once
  })

  it('neither disabled-mode nor wrong-recipient responses ever disclose the configured allowlisted address', async () => {
    const createClient = makeMockCreateClient()
    const disabled = await buildTestModeHandler(createClient)(makeReq({ 'X-Lifecycle-Test-Recipient': 'x@example.com' }), false, 'secret-allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    const wrongRecipient = await buildTestModeHandler(createClient)(makeReq({ 'X-Lifecycle-Test-Recipient': 'x@example.com' }), true, 'secret-allowed@apexaviationtx.com', 300000, 'url', 'key', createClient, noopConsole)
    expect(await disabled.clone().text()).not.toContain('secret-allowed')
    expect(await wrongRecipient.clone().text()).not.toContain('secret-allowed')
  })

  it('every present-header path returns a Response and never reaches the real batch, across all four tested outcomes (disabled / unconfigured / wrong recipient / reservation refused)', async () => {
    const createClient = makeMockCreateClient({ reserved: false })
    const h = (flags) => buildTestModeHandler(createClient)(makeReq({ 'X-Lifecycle-Test-Recipient': 'allowed@apexaviationtx.com' }), ...flags, createClient, noopConsole)
    const outcomes = await Promise.all([
      h([false, 'allowed@apexaviationtx.com', 300000, 'url', 'key']),
      h([true, undefined, 300000, 'url', 'key']),
      h([true, 'different@apexaviationtx.com', 300000, 'url', 'key']),
      h([true, 'allowed@apexaviationtx.com', 300000, 'url', 'key']), // reservation refused in this mock
    ])
    for (const outcome of outcomes) expect(outcome).toBeInstanceOf(Response)
  })

  it('structurally: the test-mode block never references the real profiles table or any real campaign dedup/log table', () => {
    expect(testModeBlock).not.toMatch(/from\(['"]profiles['"]\)/)
    expect(testModeBlock).not.toContain('portal_email_log')
    expect(testModeBlock).not.toContain('portal_milestone_emails')
    expect(testModeBlock).not.toContain('markMilestoneSent')
    expect(testModeBlock).toContain('lifecycle_test_sends')
  })

  it('structurally: exactly one sendEmail() call, addressed to a single header-derived string -- cannot be used to send to multiple recipients in one invocation', () => {
    const calls = testModeBlock.match(/\bsendEmail\(/g) || []
    expect(calls).toHaveLength(1)
    expect(testModeBlock).toContain('sendEmail(\n      testSupabase, {}, testRecipientHeader,')
  })

  it('structurally: the test send is exempt from the global cap, so it can never consume or be blocked by the production send budget', () => {
    expect(testModeBlock).toContain('{ exemptFromGlobalCap: true }')
  })
})
