// Apple IAP implementation -- regression coverage for mobile-iap-
// verify-purchase/index.ts's own glue logic: ownership/idempotency
// branching, bundle/product/type/environment/revocation checks, and
// the race-safe insert-then-reread path. The actual cryptographic
// verification (App Store Server API JWT signing, JWS chain
// validation) is tested directly and for real in appleIapJwt.test.js /
// appleIapCertChain.test.js / appleIapVerifySignedPayload.test.js --
// here, getTransactionInfo and verifyAndDecodeAppleSignedPayload are
// injected stubs, same reasoning as stripeWebhookRetry.test.js's own
// split between "envelope logic" and "purpose handler internals".
//
// Same extraction technique as stripeWebhookRetry.test.js and the same
// reason: this is a Deno Edge Function with top-level remote-URL
// imports and Deno.env.get() calls that don't exist under Node/vitest,
// so the real serve() callback body is pulled out of the actual source
// file by brace-matching (not hand-copied, so it can't silently drift
// from the shipped code) and re-evaluated via `new Function(...)` with
// every external dependency injected.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FN_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/mobile-iap-verify-purchase/index.ts')
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
  // Strip the handful of TypeScript-only annotations this body has --
  // the runtime logic (every branch/condition) is untouched.
  body = body.replace(/let environmentQueried: 'Production' \| 'Sandbox'/, 'let environmentQueried')
  body = body.replace(/let signedTransactionInfo: string \| undefined/, 'let signedTransactionInfo')
  body = body.replace(/let payload: AppleJWSTransactionDecodedPayload/, 'let payload')
  body = body.replace(/verifyAndDecodeAppleSignedPayload<AppleJWSTransactionDecodedPayload>/, 'verifyAndDecodeAppleSignedPayload')
  return body
}

function makeFakeSupabase({ authUser, selectResponses, insertResponses, updateResponses }, calls) {
  let selectIdx = 0
  let insertIdx = 0
  let updateIdx = 0
  return {
    auth: {
      getUser: async () => (authUser ? { data: { user: authUser }, error: null } : { data: { user: null }, error: new Error('no session') }),
    },
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
          const r = updateResponses[updateIdx] ?? { error: null }
          updateIdx++
          return { eq: () => Promise.resolve(r) }
        },
      }
      return obj
    },
  }
}

function makeFakeReq(body, authHeader = 'Bearer user-token') {
  return {
    method: 'POST',
    headers: { get: (name) => (name === 'Authorization' ? authHeader : null) },
    json: async () => body,
  }
}

const APPLE_CREDENTIALS_PARAMS = ['SUPABASE_URL', 'SERVICE_ROLE_KEY', 'APPLE_ISSUER_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY_PEM', 'APPLE_BUNDLE_ID', 'APPLE_PRODUCT_ID']

async function runServeBody({ authUser, body, authHeader = 'Bearer user-token', getTransactionInfoImpl, verifyImpl, selectResponses = [], insertResponses = [], updateResponses = [] }) {
  const calls = []
  const supabase = makeFakeSupabase({ authUser, selectResponses, insertResponses, updateResponses }, calls)
  const serveBody = extractServeCallbackBody()
  const paramNames = [
    'req',
    ...APPLE_CREDENTIALS_PARAMS,
    'createClient',
    'getTransactionInfo',
    'AppStoreServerApiError',
    'verifyAndDecodeAppleSignedPayload',
    'AppleSignedPayloadError',
    'json',
    'msToIso',
  ]
  // eslint-disable-next-line no-new-func
  const fn = new Function(...paramNames, `return (async () => { ${serveBody} })()`)

  class AppStoreServerApiError extends Error {
    constructor(message, status) {
      super(message)
      this.status = status
    }
  }
  class AppleSignedPayloadError extends Error {}

  function json(responseBody, status = 200) {
    return {
      status,
      json: async () => responseBody,
    }
  }
  function msToIso(ms) {
    return typeof ms === 'number' ? new Date(ms).toISOString() : null
  }

  const response = await fn(
    makeFakeReq(body, authHeader),
    'https://stub.supabase.co',
    'stub_service_role_key',
    'issuer-stub',
    'key-stub',
    'pem-stub',
    'com.apexaviationtx.advantage',
    'com.apexaviationtx.advantage.checkride_prep',
    () => supabase,
    getTransactionInfoImpl,
    AppStoreServerApiError,
    verifyImpl,
    AppleSignedPayloadError,
    json,
    msToIso
  )
  const payload = await response.json()
  return { response, payload, calls }
}

const AUTH_USER = { id: 'profile-1' }

function validTransactionPayload(overrides = {}) {
  return {
    bundleId: 'com.apexaviationtx.advantage',
    productId: 'com.apexaviationtx.advantage.checkride_prep',
    type: 'Non-Consumable',
    environment: 'Production',
    transactionId: 'txn-1',
    originalTransactionId: 'txn-1',
    purchaseDate: 1000,
    originalPurchaseDate: 1000,
    ...overrides,
  }
}

describe('mobile-iap-verify-purchase serve()', () => {
  it('rejects a request with no Authorization header', async () => {
    const { response, payload } = await runServeBody({
      authUser: null,
      authHeader: null,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: vi.fn(),
      verifyImpl: vi.fn(),
    })
    expect(response.status).toBe(401)
    expect(payload.error).toMatch(/Authorization/)
  })

  it('rejects a request whose token does not resolve to a real session', async () => {
    const { response, payload } = await runServeBody({
      authUser: null,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: vi.fn(),
      verifyImpl: vi.fn(),
    })
    expect(response.status).toBe(401)
    expect(payload.error).toMatch(/session/)
  })

  it('grants access for a brand-new, fully valid transaction and sets checkride_prep_unlocked', async () => {
    const { response, payload, calls } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload(),
      selectResponses: [{ data: null, error: null }], // no existing apple_iap_transactions row
      insertResponses: [{ error: null }],
      updateResponses: [{ error: null }],
    })
    expect(response.status).toBe(200)
    expect(payload.status).toBe('granted')
    expect(payload.transactionId).toBe('txn-1')

    const insertCall = calls.find((c) => c.table === 'apple_iap_transactions' && c.methods.some(([m]) => m === 'insert'))
    expect(insertCall).toBeTruthy()
    const insertedRow = insertCall.methods.find(([m]) => m === 'insert')[1]
    expect(insertedRow.profile_id).toBe('profile-1')
    expect(insertedRow.transaction_id).toBe('txn-1')

    const profileUpdateCall = calls.find((c) => c.table === 'profiles')
    expect(profileUpdateCall.methods[0]).toEqual(['update', { checkride_prep_unlocked: true }])
  })

  it('never grants access when the transaction is already claimed by a different profile', async () => {
    const { response, payload, calls } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload(),
      selectResponses: [{ data: { id: 'row-1', profile_id: 'someone-else', revoked_at: null }, error: null }],
    })
    expect(response.status).toBe(200)
    expect(payload.status).toBe('claimed_by_another_account')
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
  })

  it('reports revoked (never grants) when Apple’s own payload already carries a revocationDate', async () => {
    const { payload, calls } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload({ revocationDate: 5000 }),
    })
    expect(payload.status).toBe('revoked')
    expect(calls.length).toBe(0)
  })

  it('a duplicate-insert race (23505) re-reads the winning row and still reports granted for the SAME profile', async () => {
    const { payload } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload(),
      selectResponses: [
        { data: null, error: null }, // initial lookup: no row yet
        { data: { profile_id: 'profile-1', revoked_at: null }, error: null }, // re-read after the race
      ],
      insertResponses: [{ error: { code: '23505' } }],
      updateResponses: [{ error: null }],
    })
    expect(payload.status).toBe('granted')
  })

  it('a duplicate-insert race won by a DIFFERENT profile reports claimed_by_another_account, not granted', async () => {
    const { payload, calls } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload(),
      selectResponses: [{ data: null, error: null }, { data: { profile_id: 'someone-else', revoked_at: null }, error: null }],
      insertResponses: [{ error: { code: '23505' } }],
    })
    expect(payload.status).toBe('claimed_by_another_account')
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
  })

  it('rejects a payload whose bundleId does not match this app, without ever touching the database', async () => {
    const { payload, calls } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload({ bundleId: 'com.someoneelse.app' }),
    })
    expect(payload.status).toBe('verification_failed')
    expect(payload.reason).toBe('bundle_id_mismatch')
    expect(calls.length).toBe(0)
  })

  it('rejects a non-Non-Consumable product type', async () => {
    const { payload } = await runServeBody({
      authUser: AUTH_USER,
      body: { transactionId: 'txn-1' },
      getTransactionInfoImpl: async () => ({ environmentQueried: 'Production', response: { signedTransactionInfo: 'jws-stub' } }),
      verifyImpl: async () => validTransactionPayload({ type: 'Auto-Renewable Subscription' }),
    })
    expect(payload.status).toBe('verification_failed')
    expect(payload.reason).toBe('unexpected_product_type')
  })
})
