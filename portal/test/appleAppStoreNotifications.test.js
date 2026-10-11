// Apple IAP implementation -- regression coverage for apple-app-store-
// notifications/index.ts's own glue logic: idempotent notification
// logging, the REFUND/REVOKE -> re-check-other-grants -> maybe-unlock
// decision tree, and REFUND_REVERSED re-activation. The actual
// signature/chain verification is tested for real in
// appleIapVerifySignedPayload.test.js; here
// verifyAndDecodeAppleSignedPayload is an injected stub, same split as
// stripeWebhookRetry.test.js's own "envelope vs. verification
// internals" approach.
//
// Same extraction technique as stripeWebhookRetry.test.js and
// mobileIapVerifyPurchase.test.js, for the same reason (Deno-only
// globals/remote imports this Edge Function has at its top level): the
// real serve() callback AND the real profileHasAnotherValidGrant()
// helper are both pulled out of the actual shipped source by brace-
// matching and re-evaluated together via `new Function(...)`, so
// profileHasAnotherValidGrant is exercised for real too, not
// reimplemented by hand in this test.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FN_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/apple-app-store-notifications/index.ts')
const source = readFileSync(FN_PATH, 'utf8')

function findMatchingBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('No matching closing brace found')
}

function extractServeCallbackBody() {
  const marker = 'serve(async (req) => {'
  const startIdx = source.indexOf(marker)
  expect(startIdx, 'serve(async (req) => {...}) not found').toBeGreaterThan(-1)
  const braceOpen = startIdx + marker.length - 1
  const braceClose = findMatchingBrace(source, braceOpen)
  let body = source.slice(braceOpen + 1, braceClose)
  body = body.replace(/let notification: AppleResponseBodyV2DecodedPayload/, 'let notification')
  body = body.replace(/verifyAndDecodeAppleSignedPayload<AppleResponseBodyV2DecodedPayload>/, 'verifyAndDecodeAppleSignedPayload')
  body = body.replace(/let transaction: AppleJWSTransactionDecodedPayload/, 'let transaction')
  body = body.replace(/verifyAndDecodeAppleSignedPayload<AppleJWSTransactionDecodedPayload>/, 'verifyAndDecodeAppleSignedPayload')
  return body
}

function extractProfileHasAnotherValidGrant() {
  const marker = 'async function profileHasAnotherValidGrant('
  const startIdx = source.indexOf(marker)
  expect(startIdx, 'profileHasAnotherValidGrant not found').toBeGreaterThan(-1)
  const braceOpen = source.indexOf('{', startIdx)
  const braceClose = findMatchingBrace(source, braceOpen)
  let fnSource = source.slice(startIdx, braceClose + 1)
  // Strip the TS parameter/return-type annotations only -- the function
  // body itself is untouched.
  fnSource = fnSource.replace(
    /async function profileHasAnotherValidGrant\(\s*supabase: ReturnType<typeof createClient>,\s*profileId: string,\s*excludingTransactionId: string\s*\): Promise<boolean> \{/,
    'async function profileHasAnotherValidGrant(supabase, profileId, excludingTransactionId) {'
  )
  return fnSource
}

function makeFakeSupabase({ selectResponses = [], insertResponses = [] }, calls) {
  let selectIdx = 0
  let insertIdx = 0
  return {
    from(table) {
      const record = { table, methods: [] }
      calls.push(record)
      const obj = {
        select(...a) {
          record.methods.push(['select', a])
          return obj
        },
        eq(...a) {
          record.methods.push(['eq', a])
          return obj
        },
        neq(...a) {
          record.methods.push(['neq', a])
          return obj
        },
        is(...a) {
          record.methods.push(['is', a])
          return obj
        },
        limit(...a) {
          record.methods.push(['limit', a])
          return obj
        },
        maybeSingle() {
          record.methods.push(['maybeSingle'])
          const r = selectResponses[selectIdx] ?? { data: null, error: null }
          selectIdx++
          return Promise.resolve(r)
        },
        insert(v) {
          record.methods.push(['insert', v])
          const r = insertResponses[insertIdx] ?? { error: null }
          insertIdx++
          return Promise.resolve(r)
        },
        update(v) {
          record.methods.push(['update', v])
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
      return obj
    },
  }
}

async function runServeBody({ body, verifyImpl, selectResponses = [], insertResponses = [] }) {
  const calls = []
  const supabase = makeFakeSupabase({ selectResponses, insertResponses }, calls)
  const serveBody = extractServeCallbackBody()
  const helperSource = extractProfileHasAnotherValidGrant()
  const paramNames = ['req', 'SUPABASE_URL', 'SERVICE_ROLE_KEY', 'APPLE_BUNDLE_ID', 'APPLE_PRODUCT_ID', 'createClient', 'verifyAndDecodeAppleSignedPayload', 'AppleSignedPayloadError', 'json', 'REVOKING_TYPES']
  // eslint-disable-next-line no-new-func
  const fn = new Function(...paramNames, `${helperSource}\nreturn (async () => { ${serveBody} })()`)

  class AppleSignedPayloadError extends Error {}
  function json(responseBody, status = 200) {
    return { status, json: async () => responseBody }
  }
  const req = { json: async () => body }

  const response = await fn(
    req,
    'https://stub.supabase.co',
    'stub_service_role_key',
    'com.apexaviationtx.advantage',
    'com.apexaviationtx.advantage.checkride_prep',
    () => supabase,
    verifyImpl,
    AppleSignedPayloadError,
    json,
    new Set(['REFUND', 'REVOKE'])
  )
  const payload = await response.json()
  return { response, payload, calls }
}

function notificationPayload(overrides = {}) {
  return {
    notificationUUID: 'notif-1',
    notificationType: 'REFUND',
    data: { signedTransactionInfo: 'jws-stub' },
    ...overrides,
  }
}

function transactionPayload(overrides = {}) {
  return {
    bundleId: 'com.apexaviationtx.advantage',
    productId: 'com.apexaviationtx.advantage.checkride_prep',
    transactionId: 'txn-1',
    ...overrides,
  }
}

describe('apple-app-store-notifications serve()', () => {
  it('a REFUND with no other valid grant revokes the transaction AND unlocks checkride_prep_unlocked back to false', async () => {
    const verifyImpl = async (jws) => (jws === 'outer-jws' ? notificationPayload() : transactionPayload())
    const { payload, calls } = await runServeBody({
      body: { signedPayload: 'outer-jws' },
      verifyImpl,
      insertResponses: [{ error: null }], // notification log insert succeeds
      selectResponses: [
        { data: { id: 'row-1', profile_id: 'profile-1', revoked_at: null }, error: null }, // apple_iap_transactions lookup
        { data: null, error: null }, // profileHasAnotherValidGrant: no other apple grant
        { data: null, error: null }, // profileHasAnotherValidGrant: no web purchase
      ],
    })
    expect(payload.status).toBe('revoked')
    const profileUpdate = calls.find((c) => c.table === 'profiles')
    expect(profileUpdate.methods[0]).toEqual(['update', { checkride_prep_unlocked: false }])
  })

  it('a REFUND for a profile that ALSO has a web/Stripe purchase on file revokes the Apple row but never touches checkride_prep_unlocked', async () => {
    const verifyImpl = async (jws) => (jws === 'outer-jws' ? notificationPayload() : transactionPayload())
    const { payload, calls } = await runServeBody({
      body: { signedPayload: 'outer-jws' },
      verifyImpl,
      insertResponses: [{ error: null }],
      selectResponses: [
        { data: { id: 'row-1', profile_id: 'profile-1', revoked_at: null }, error: null },
        { data: null, error: null }, // no other apple grant
        { data: { id: 'purchase-1' }, error: null }, // but DOES have a web purchase on file
      ],
    })
    expect(payload.status).toBe('revoked')
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
    const transactionsUpdate = calls.find((c) => c.table === 'apple_iap_transactions' && c.methods.some(([m]) => m === 'update'))
    expect(transactionsUpdate).toBeTruthy()
  })

  it('a duplicate delivery of the same notification is short-circuited before any revoke/unlock logic runs', async () => {
    const verifyImpl = async () => notificationPayload()
    const { payload, calls } = await runServeBody({
      body: { signedPayload: 'outer-jws' },
      verifyImpl,
      insertResponses: [{ error: { code: '23505' } }], // already logged this notificationUUID
    })
    expect(payload.status).toBe('already_processed')
    expect(calls.length).toBe(1) // only the log-insert attempt, nothing else
  })

  it('REFUND_REVERSED re-activates a revoked transaction and re-grants access', async () => {
    const verifyImpl = async (jws) => (jws === 'outer-jws' ? notificationPayload({ notificationType: 'REFUND_REVERSED' }) : transactionPayload())
    const { payload, calls } = await runServeBody({
      body: { signedPayload: 'outer-jws' },
      verifyImpl,
      insertResponses: [{ error: null }],
      selectResponses: [{ data: { id: 'row-1', profile_id: 'profile-1', revoked_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    expect(payload.status).toBe('restored')
    const profileUpdate = calls.find((c) => c.table === 'profiles')
    expect(profileUpdate.methods[0]).toEqual(['update', { checkride_prep_unlocked: true }])
  })

  it('acknowledges (no-op) a notification type with nothing for a non-consumable to act on', async () => {
    const verifyImpl = async () => notificationPayload({ notificationType: 'DID_RENEW' })
    const { payload, calls } = await runServeBody({
      body: { signedPayload: 'outer-jws' },
      verifyImpl,
      insertResponses: [{ error: null }],
    })
    expect(payload.status).toBe('acknowledged')
    expect(calls.length).toBe(1) // only the log-insert, no transaction/profile lookups at all
  })

  it('rejects a request with no signedPayload', async () => {
    const { response, payload } = await runServeBody({ body: {}, verifyImpl: async () => notificationPayload() })
    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/signedPayload/)
  })
})
