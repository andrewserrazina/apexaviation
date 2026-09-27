// Revenue Funnel + Attribution Integrity sprint (Section 5/9) --
// regression coverage for stripe-webhook/index.ts's event-lifecycle
// redesign. Same extraction approach as emailLifecycle.test.js: the real
// serve() callback body is pulled out of the actual source file by
// brace-matching (not hand-copied into the test, which could silently
// drift from the shipped code) and re-evaluated as plain JS via
// `new Function(...)`, with every external dependency (Supabase client,
// Stripe SDK, the purpose-specific handlers) injected as a fake/spy.
// This is a Deno Edge Function with top-level remote-URL imports and
// Deno.env.get() calls that don't exist under Node/vitest, so the module
// itself can never be imported directly -- extraction is the only way to
// exercise the real logic here.
//
// What this deliberately does NOT test: Stripe signature verification
// (unchanged by this sprint, stubbed to always "succeed") and the
// internals of any individual purpose handler (handleUnlockCheckridePrep
// etc. -- covered separately by inspecting their own idempotency guards
// directly in source, since those are one-shot DB-shaped checks, not
// stateful retry logic). This file is specifically about the outer
// stripe_webhook_events lifecycle: received/processing/processed/failed,
// attempt_count, and which HTTP status code Stripe sees for each outcome.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WEBHOOK_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/stripe-webhook/index.ts')
const webhookSource = readFileSync(WEBHOOK_PATH, 'utf8')

function findMatchingBrace(source, openIdx) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

// Extracts the real serve(async (req) => { ... }) callback body, strips
// the handful of TypeScript-only annotations/casts it contains (type
// annotations and `as Stripe.X` casts -- Stripe's actual runtime SDK
// shape is untouched, only compile-time-only syntax is removed), and
// returns it ready to hand to `new Function(...params, body)`.
function extractServeCallbackBody() {
  const marker = 'serve(async (req) => {'
  const startIdx = webhookSource.indexOf(marker)
  expect(startIdx, 'serve(async (req) => {...}) not found').toBeGreaterThan(-1)
  const braceOpen = startIdx + marker.length - 1
  const braceClose = findMatchingBrace(webhookSource, braceOpen)
  let body = webhookSource.slice(braceOpen + 1, braceClose)
  body = body.replace(/ as Stripe\.[A-Za-z.]+/g, '')
  body = body.replace(/: Stripe\.[A-Za-z.]+/g, '')
  // TypeScript non-null assertion (`signature!`) -- invalid in plain JS.
  body = body.replace(/([a-zA-Z_$][\w$]*)!(?=[,)\s;])/g, '$1')
  return body
}

// Records every from()/insert()/update()/select()/eq()/in()/maybeSingle()
// call and resolves each awaited chain from a scripted response queue, in
// the exact order this codebase's serve() body actually calls them
// (verified against the real source below, not guessed) -- sufficient
// because the test controls both the code under test and the call
// sequence, without needing a real query-shape-aware mock.
function makeFakeSupabase(responses, calls) {
  let i = 0
  function chain(table, op) {
    const record = { table, op, methods: [] }
    calls.push(record)
    const obj = {
      insert(v) { record.methods.push(['insert', v]); return obj },
      update(v) { record.methods.push(['update', v]); return obj },
      select(v) { record.methods.push(['select', v]); return obj },
      eq(...a) { record.methods.push(['eq', a]); return obj },
      in(...a) { record.methods.push(['in', a]); return obj },
      maybeSingle() { record.methods.push(['maybeSingle']); return obj },
      then(resolve, reject) {
        const r = responses[i] !== undefined ? responses[i] : { data: null, error: null }
        i++
        return Promise.resolve(r).then(resolve, reject)
      },
    }
    return obj
  }
  return { from(table) { return chain(table) } }
}

function makeFakeReq() {
  return {
    headers: { get: () => 'sig_stub' },
    text: async () => '{}',
  }
}

// Builds and runs the real serve() body with every free variable it
// references supplied as a fake/stub. handlerSpy stands in for whichever
// purpose handler the test's session.metadata.purpose selects
// (unlock-checkride-prep -> handleUnlockCheckridePrep here; the specific
// name doesn't matter to the envelope logic under test).
async function runServeBody({ responses, event, handlerSpy }) {
  const calls = []
  const supabase = makeFakeSupabase(responses, calls)
  const body = extractServeCallbackBody()
  const paramNames = [
    'req', 'SUPABASE_URL', 'SERVICE_ROLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'cryptoProvider', 'createClient',
    'stripe', 'PermanentWebhookError', 'MAX_FULFILLMENT_ATTEMPTS',
    'handleUnlockCheckridePrep', 'handleGroundSchoolRegistration', 'handleMockOralBooking',
    'handleMockOralBookingV2', 'handleUnlockStudyPack', 'handleJoinMembership',
    'handleUnlockGroundSchoolPack', 'handleUpgradeGroundSchoolPack',
    'handleSubscriptionUpdated', 'handleSubscriptionDeleted', 'handleInvoicePaymentFailed',
  ]
  // eslint-disable-next-line no-new-func
  const fn = new Function(...paramNames, `return (async () => { ${body} })()`)
  const stripe = { webhooks: { constructEventAsync: async () => event } }
  class PermanentWebhookError extends Error {}
  const noop = async () => {}
  const response = await fn(
    makeFakeReq(), 'https://stub.supabase.co', 'stub_service_role_key', 'whsec_stub', {}, () => supabase,
    stripe, PermanentWebhookError, 10,
    handlerSpy || noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
  )
  const json = await response.json()
  return { response, json, calls }
}

const CHECKOUT_EVENT = (overrides = {}) => ({
  id: 'evt_test_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', metadata: { purpose: 'unlock-checkride-prep' }, ...overrides } },
})

describe('stripe-webhook serve(): event lifecycle (Section 5)', () => {
  it('a brand-new event runs the handler once and is marked processed (200)', async () => {
    const handler = vi.fn(async () => {})
    const { response, json, calls } = await runServeBody({
      responses: [
        { error: null }, // insert stripe_webhook_events (first delivery, succeeds)
        { error: null }, // update checkout_session_attempts.completed_at
        { error: null }, // update checkout_session_attempts.fulfillment_status = succeeded
        { error: null }, // update stripe_webhook_events.status = processed
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(json.received).toBe(true)
    expect(json.duplicate).toBeUndefined()
    const lastCall = calls[calls.length - 1]
    expect(lastCall.table).toBe('stripe_webhook_events')
    expect(lastCall.methods[0]).toEqual(['update', expect.objectContaining({ status: 'processed' })])
  })

  it('a redelivery of an already-processed event is skipped -- handler never runs again (200 duplicate)', async () => {
    const handler = vi.fn(async () => {})
    const { response, json } = await runServeBody({
      responses: [
        { error: { code: '23505' } }, // insert conflicts -- we've seen this event id
        { data: { status: 'processed', attempt_count: 1 }, error: null }, // lookup: already fully fulfilled
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(json.duplicate).toBe(true)
  })

  it('a redelivery of a previously-FAILED event actually retries the handler -- the core fix', async () => {
    const handler = vi.fn(async () => {})
    const { response, json, calls } = await runServeBody({
      responses: [
        { error: { code: '23505' } }, // insert conflicts
        { data: { status: 'failed', attempt_count: 1 }, error: null }, // lookup: NOT yet fulfilled
        { data: { event_id: 'evt_test_1' }, error: null }, // claim succeeds (status -> processing)
        { error: null }, // update checkout_session_attempts.completed_at
        { error: null }, // update checkout_session_attempts.fulfillment_status = succeeded
        { error: null }, // update stripe_webhook_events.status = processed
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    // This is exactly the failure mode the sprint reported: previously,
    // ANY insert conflict short-circuited to {duplicate:true} 200 before
    // ever reaching this point, regardless of whether fulfillment had
    // actually succeeded -- a paid-but-unfulfilled order had no path back
    // to being fulfilled. Retrying the handler here is the fix.
    expect(handler).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(json.duplicate).toBeUndefined()
  })

  it('a transient handler failure marks the event failed and returns a real non-2xx (Stripe will retry)', async () => {
    const handler = vi.fn(async () => { throw new Error('temporary DB hiccup') })
    const { response, json, calls } = await runServeBody({
      responses: [
        { error: null }, // insert succeeds (first delivery)
        { error: null }, // update checkout_session_attempts.completed_at
        { error: null }, // catch: update stripe_webhook_events.status = failed
        { error: null }, // catch: update checkout_session_attempts.fulfillment_status = failed
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(response.status).toBe(500)
    expect(json.retryable).toBe(true)
    const failedEventsUpdate = calls.find((c) => c.table === 'stripe_webhook_events' && c.methods[0][0] === 'update' && c.methods[0][1].status === 'failed')
    expect(failedEventsUpdate).toBeTruthy()
    const failedSessionUpdate = calls.find((c) => c.table === 'checkout_session_attempts' && c.methods[0][1]?.fulfillment_status === 'failed')
    expect(failedSessionUpdate).toBeTruthy()
  })

  it('an unrecognized checkout purpose is a permanent (non-retryable) failure -- 200, not 500', async () => {
    const { response, json } = await runServeBody({
      responses: [
        { error: null }, // insert succeeds
        { error: null }, // update checkout_session_attempts.completed_at
        { error: null }, // catch: update stripe_webhook_events.status = failed
        { error: null }, // catch: update checkout_session_attempts.fulfillment_status = failed
      ],
      event: CHECKOUT_EVENT({ metadata: { purpose: 'some-purpose-that-does-not-exist' } }),
    })
    expect(response.status).toBe(200)
    expect(json.error).toMatch(/Unknown checkout purpose/)
  })

  it('gives up after MAX_FULFILLMENT_ATTEMPTS instead of retrying forever', async () => {
    const handler = vi.fn(async () => {})
    const { response, json } = await runServeBody({
      responses: [
        { error: { code: '23505' } }, // insert conflicts
        { data: { status: 'failed', attempt_count: 10 }, error: null }, // already at the ceiling
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(json.gave_up).toBe(true)
  })

  it('a concurrent in-flight delivery of the same event asks Stripe to retry shortly (409), never runs the handler twice in parallel', async () => {
    const handler = vi.fn(async () => {})
    const { response, json } = await runServeBody({
      responses: [
        { error: { code: '23505' } }, // insert conflicts
        { data: { status: 'processing', attempt_count: 1 }, error: null }, // another delivery is mid-flight
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(409)
    expect(json.in_progress).toBe(true)
  })

  it('losing the claim race (another delivery grabbed it first) also backs off with 409', async () => {
    const handler = vi.fn(async () => {})
    const { response, json } = await runServeBody({
      responses: [
        { error: { code: '23505' } }, // insert conflicts
        { data: { status: 'failed', attempt_count: 1 }, error: null }, // eligible to retry...
        { data: null, error: null }, // ...but the claim UPDATE matched zero rows -- lost the race
      ],
      event: CHECKOUT_EVENT(),
      handlerSpy: handler,
    })
    expect(handler).not.toHaveBeenCalled()
    expect(response.status).toBe(409)
    expect(json.in_progress).toBe(true)
  })
})

describe('stripe-webhook purpose handlers: idempotency guards against a genuine retry (Section 5)', () => {
  // Now that a retry can actually reach these handlers again (the fix
  // above), each one that writes to a table with a real stripe_session_id
  // uniqueness guarantee must recognize "already fulfilled" and stop --
  // otherwise a legitimate retry after a transient failure would either
  // throw on the DB's own unique-constraint violation (mock_oral_requests,
  // portal_access_purchases) or, worse, misread "the slot/enrollment is no
  // longer available" as a genuine conflict and wrongly refund an
  // already-correctly-fulfilled customer (handleMockOralBookingV2,
  // handleGroundSchoolRegistration). Static source checks, not execution
  // -- each of these functions does substantial real Supabase/Stripe work
  // beyond the guard itself.
  function extractHandler(name) {
    const marker = `async function ${name}(`
    const start = webhookSource.indexOf(marker)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    const parenClose = webhookSource.indexOf(')', start)
    const braceOpen = webhookSource.indexOf('{', parenClose)
    const braceClose = findMatchingBrace(webhookSource, braceOpen)
    return webhookSource.slice(braceOpen + 1, braceClose)
  }

  it('handleUnlockCheckridePrep treats a stripe_session_id collision on portal_access_purchases as already-fulfilled', () => {
    const body = extractHandler('handleUnlockCheckridePrep')
    const insertIdx = body.indexOf("supabase.from('portal_access_purchases').insert(")
    expect(insertIdx).toBeGreaterThan(-1)
    const after = body.slice(insertIdx)
    expect(after).toContain("purchaseError.code === '23505'")
    const guardIdx = after.indexOf("purchaseError.code === '23505'")
    expect(after.slice(guardIdx, guardIdx + 120)).toContain('return')
  })

  it('handleMockOralBooking treats a stripe_session_id collision on mock_oral_requests as already-fulfilled', () => {
    const body = extractHandler('handleMockOralBooking')
    expect(body).toContain("insertError.code === '23505'")
  })

  it('handleMockOralBookingV2 checks for an existing booking BEFORE touching the slot at all', () => {
    const body = extractHandler('handleMockOralBookingV2')
    const guardIdx = body.indexOf("from('mock_oral_bookings').select('id').eq('stripe_session_id', session.id)")
    const claimIdx = body.indexOf("from('mock_oral_availability')\n    .update({ status: 'booked'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(claimIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(claimIdx)
  })

  it('handleGroundSchoolRegistration checks both the scheduled-class and legacy paths for an existing enrollment before acting', () => {
    const body = extractHandler('handleGroundSchoolRegistration')
    expect(body).toContain("from('scheduled_ground_class_enrollments')\n      .select('id')\n      .eq('stripe_session_id', session.id)")
    expect(body).toContain("from('ground_registrations')\n    .select('id')\n    .eq('stripe_session_id', session.id)")
  })
})
