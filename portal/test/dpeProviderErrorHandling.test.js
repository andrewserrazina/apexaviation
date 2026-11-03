// AI DPE Oral Practice -- Nov 2026 incident regression coverage.
//
// Production logs showed Oral Practice failing with a bare HTTP 500
// whenever the Anthropic account ran out of credit (a 400
// invalid_request_error, "Your credit balance is too low to access the
// Anthropic API"), with no way for either platform's own catch block,
// or the student, to tell that apart from a rate limit, an outage, or a
// real bug on our side. This file exercises the real classification
// (classifyAnthropicFailure, DpeProviderError, dpeProviderErrorResponse
// in _shared/dpeChatCore.ts) and the real catch-block branching in both
// dpe-chat/index.ts and mobile-dpe/index.ts -- not a reimplementation.
//
// Same extraction technique as mobileIapVerifyPurchase.test.js /
// appleAppStoreNotifications.test.js and the same reason: these are
// Deno Edge Functions with top-level remote-URL imports and
// Deno.env.get() calls that don't exist under Node/vitest, so the real
// function bodies are pulled out of the actual shipped source by
// brace-matching (never hand-copied, so they can't silently drift from
// what's deployed) and re-evaluated via `new Function(...)` with every
// external dependency injected.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CORE_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/_shared/dpeChatCore.ts')
const DPE_CHAT_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/dpe-chat/index.ts')
const MOBILE_DPE_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/mobile-dpe/index.ts')
const coreSource = readFileSync(CORE_PATH, 'utf8')
const dpeChatSource = readFileSync(DPE_CHAT_PATH, 'utf8')
const mobileDpeSource = readFileSync(MOBILE_DPE_PATH, 'utf8')

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

function findMatchingParen(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('No matching closing paren found')
}

// Extracts `marker ... { <body> }` (a function or class) from `src`.
// The real body-opening brace is the LAST `{` on the SAME LINE as the
// signature's closing paren (found via real paren-depth matching, which
// handles a multi-line parameter list like callClaudeOnce's fine) --
// not the first `{` after the marker. A return-type annotation that is
// itself an object type literal (e.g. dpeProviderErrorResponse's
// `): { status: number; code: string; message: string } {`) has its own
// balanced `{...}` BEFORE the real body, which a naive "first brace"
// scan would match instead of the body. A class has no parameter list
// at all (no `(` right after the marker before its own body `{`), so it
// falls back to the first `{` after the marker.
function extractBlock(src, marker, label = marker) {
  const startIdx = src.indexOf(marker)
  expect(startIdx, `${label} not found`).toBeGreaterThan(-1)
  const firstParen = src.indexOf('(', startIdx)
  const firstBrace = src.indexOf('{', startIdx)
  let searchFrom
  if (firstParen !== -1 && firstParen < firstBrace) {
    searchFrom = findMatchingParen(src, firstParen)
  } else {
    searchFrom = startIdx
  }
  const lineEnd = src.indexOf('\n', searchFrom)
  const braceOpen = src.lastIndexOf('{', lineEnd)
  expect(braceOpen, `${label}: no opening brace found on its signature's closing-paren line`).toBeGreaterThan(-1)
  const braceClose = findMatchingBrace(src, braceOpen)
  return src.slice(startIdx, braceClose + 1)
}

// --- dpeChatCore.ts: real source for every piece under test, with
// TypeScript-only annotations stripped (runtime logic untouched). ---
const DpeProviderErrorClassSrc = extractBlock(coreSource, 'export class DpeProviderError extends Error {', 'DpeProviderError')
  .replace('export class DpeProviderError extends Error {', 'class DpeProviderError extends Error {')
  .replace('kind: DpeProviderErrorKind\n  constructor(kind: DpeProviderErrorKind, message: string) {', 'constructor(kind, message) {')

const classifyAnthropicFailureSrc = extractBlock(coreSource, 'export function classifyAnthropicFailure(', 'classifyAnthropicFailure')
  .replace('export function classifyAnthropicFailure(status: number, errText: string): DpeProviderError {', 'function classifyAnthropicFailure(status, errText) {')
  .replace('let errorType: string | null = null', 'let errorType = null')

const dpeProviderErrorResponseSrc = extractBlock(coreSource, 'export function dpeProviderErrorResponse(', 'dpeProviderErrorResponse')
  .replace(
    'export function dpeProviderErrorResponse(err: DpeProviderError): { status: number; code: string; message: string } {',
    'function dpeProviderErrorResponse(err) {'
  )

const parseDpeTurnSrc = extractBlock(coreSource, 'export function parseDpeTurn(', 'parseDpeTurn')
  .replace('export function parseDpeTurn(raw: string): DpeTurn | null {', 'function parseDpeTurn(raw) {')

const callClaudeOnceSrc = extractBlock(coreSource, 'async function callClaudeOnce(', 'callClaudeOnce')
  .replace(/async function callClaudeOnce\(\s*systemPrompt: string,\s*messages: \{ role: 'user' \| 'assistant'; content: string \}\[\]\s*\): Promise<DpeTurn \| null> \{/, 'async function callClaudeOnce(systemPrompt, messages) {')
  .replace('let res: Response', 'let res')
  .replace('(block: { text?: string })', '(block)')

const callClaudeSrc = extractBlock(coreSource, 'export async function callClaude(', 'callClaude')
  .replace(/export async function callClaude\(\s*systemPrompt: string,\s*messages: \{ role: 'user' \| 'assistant'; content: string \}\[\]\s*\): Promise<DpeTurn> \{/, 'async function callClaude(systemPrompt, messages) {')

// Builds a real, live dpeChatCore "module" (the actual classification/
// retry/mapping logic, not a reimplementation) with ANTHROPIC_API_KEY,
// ANTHROPIC_MODEL, and fetch injected -- the only three things
// dpeChatCore.ts reads from its Deno-only environment or the network.
function buildDpeChatCore({ fetchImpl } = {}) {
  const src = `
    ${DpeProviderErrorClassSrc}
    ${classifyAnthropicFailureSrc}
    ${dpeProviderErrorResponseSrc}
    ${parseDpeTurnSrc}
    ${callClaudeOnceSrc}
    ${callClaudeSrc}
    return { DpeProviderError, classifyAnthropicFailure, dpeProviderErrorResponse, parseDpeTurn, callClaudeOnce, callClaude }
  `
  // eslint-disable-next-line no-new-func
  const factory = new Function('ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'fetch', src)
  return factory('test-key', 'claude-sonnet-5', fetchImpl)
}

function anthropicResponse(text) {
  return { ok: true, json: async () => ({ content: [{ text }] }) }
}
function anthropicErrorResponse(status, body) {
  return { ok: false, status, text: async () => body }
}

describe('classifyAnthropicFailure (real source from dpeChatCore.ts)', () => {
  const core = buildDpeChatCore()

  it('429 classifies as rate_limited', () => {
    const err = core.classifyAnthropicFailure(429, '{"error":{"type":"rate_limit_error","message":"rate limited"}}')
    expect(err.kind).toBe('rate_limited')
  })

  it('401 classifies as auth_config_error', () => {
    expect(core.classifyAnthropicFailure(401, '{"error":{"type":"authentication_error"}}').kind).toBe('auth_config_error')
  })

  it('403 classifies as auth_config_error', () => {
    expect(core.classifyAnthropicFailure(403, '{"error":{"type":"permission_error"}}').kind).toBe('auth_config_error')
  })

  it('400 with "credit balance" in the body classifies as insufficient_credits -- the exact Nov 2026 incident shape', () => {
    const body = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
    const err = core.classifyAnthropicFailure(400, body)
    expect(err.kind).toBe('insufficient_credits')
  })

  it('400 WITHOUT "credit balance" classifies as auth_config_error, not insufficient_credits -- a real malformed-request bug must never be misreported as a billing problem', () => {
    const err = core.classifyAnthropicFailure(400, '{"error":{"type":"invalid_request_error","message":"max_tokens: Field required"}}')
    expect(err.kind).toBe('auth_config_error')
  })

  it.each([500, 502, 503, 529])('%i classifies as provider_unavailable', (status) => {
    expect(core.classifyAnthropicFailure(status, '{"error":{"type":"overloaded_error"}}').kind).toBe('provider_unavailable')
  })

  it('a non-JSON error body never throws while classifying -- only affects whether errorType can be read', () => {
    expect(() => core.classifyAnthropicFailure(400, 'not json at all')).not.toThrow()
  })
})

describe('dpeProviderErrorResponse (real source from dpeChatCore.ts) -- every kind maps to a safe, non-technical response', () => {
  const core = buildDpeChatCore()
  const FORBIDDEN_SUBSTRINGS = ['credit', 'balance', 'billing', 'api key', 'anthropic_api_key', 'x-api-key', 'anthropic']

  it.each(['insufficient_credits', 'rate_limited', 'provider_unavailable', 'auth_config_error', 'malformed_response'])(
    '%s maps to a 5xx status with a machine-readable code and a message containing no technical/billing terms',
    (kind) => {
      const err = new core.DpeProviderError(kind, `internal detail for ${kind}`)
      const { status, code, message } = core.dpeProviderErrorResponse(err)
      expect(status).toBeGreaterThanOrEqual(500)
      expect(status).toBeLessThan(600)
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(typeof message).toBe('string')
      const lower = message.toLowerCase()
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        expect(lower, `message for ${kind} must not mention "${bad}": "${message}"`).not.toContain(bad)
      }
      // The internal constructor message (which could in principle carry
      // detail) must never leak into the client-facing message either.
      expect(message).not.toContain(`internal detail for ${kind}`)
    }
  )

  it('insufficient_credits, provider_unavailable, and auth_config_error all show the SAME learner-facing message (nothing different for the student to do) but keep DISTINCT codes for operator-side logs/alerts', () => {
    const codes = new Set()
    const messages = new Set()
    for (const kind of ['insufficient_credits', 'provider_unavailable', 'auth_config_error']) {
      const { code, message } = core.dpeProviderErrorResponse(new core.DpeProviderError(kind, 'x'))
      codes.add(code)
      messages.add(message)
    }
    expect(codes.size).toBe(3)
    expect(messages.size).toBe(1)
  })

  it('rate_limited gets its own, differently-worded message (distinct from the generic "unavailable" wording)', () => {
    const rateLimited = core.dpeProviderErrorResponse(new core.DpeProviderError('rate_limited', 'x'))
    const unavailable = core.dpeProviderErrorResponse(new core.DpeProviderError('provider_unavailable', 'x'))
    expect(rateLimited.message).not.toBe(unavailable.message)
  })
})

describe('callClaude / callClaudeOnce (real source from dpeChatCore.ts) -- end-to-end against a mocked Anthropic response', () => {
  it('a successful response still parses and returns normally (the existing successful experience is unchanged)', async () => {
    const core = buildDpeChatCore({
      fetchImpl: vi.fn().mockResolvedValue(anthropicResponse(JSON.stringify({ phase: 'question', message: 'Tell me about Class B airspace.', debrief: null }))),
    })
    const turn = await core.callClaude('system prompt', [{ role: 'user', content: 'hi' }])
    expect(turn).toEqual({ phase: 'question', message: 'Tell me about Class B airspace.', debrief: null })
  })

  it('an insufficient-credits 400 throws a classified DpeProviderError immediately, with NO retry (a second attempt would just fail again)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      anthropicErrorResponse(400, '{"error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}')
    )
    const core = buildDpeChatCore({ fetchImpl })
    await expect(core.callClaude('system prompt', [])).rejects.toMatchObject({ kind: 'insufficient_credits' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a 429 throws rate_limited with no retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(anthropicErrorResponse(429, '{"error":{"type":"rate_limit_error"}}'))
    const core = buildDpeChatCore({ fetchImpl })
    await expect(core.callClaude('system prompt', [])).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a network-level failure (fetch itself rejects) throws provider_unavailable, not an unhandled rejection', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network error'))
    const core = buildDpeChatCore({ fetchImpl })
    await expect(core.callClaude('system prompt', [])).rejects.toMatchObject({ kind: 'provider_unavailable' })
  })

  it('a malformed response retries exactly once, then throws malformed_response if still unparseable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(anthropicResponse('not valid json and no braces either'))
    const core = buildDpeChatCore({ fetchImpl })
    await expect(core.callClaude('system prompt', [])).rejects.toMatchObject({ kind: 'malformed_response' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a malformed response followed by a good one on retry succeeds (the existing retry-recovers-the-turn behavior is unchanged)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(anthropicResponse('garbage'))
      .mockResolvedValueOnce(anthropicResponse(JSON.stringify({ phase: 'followup', message: 'Why does that matter for density altitude?', debrief: null })))
    const core = buildDpeChatCore({ fetchImpl })
    const turn = await core.callClaude('system prompt', [])
    expect(turn.phase).toBe('followup')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

// --- dpe-chat/index.ts and mobile-dpe/index.ts: the real serve()
// catch-block branching, for both platforms, proving neither leaks the
// raw Anthropic error text and both apply the shared classification
// identically. ---
function extractServeCallbackBody(source) {
  const marker = 'serve(async (req) => {'
  const startIdx = source.indexOf(marker)
  expect(startIdx, 'serve(async (req) => {...}) not found').toBeGreaterThan(-1)
  const braceOpen = startIdx + marker.length - 1
  const braceClose = findMatchingBrace(source, braceOpen)
  // Strip the TS-only annotations this body has -- runtime logic (every
  // branch/condition) is untouched. mobile-dpe's `history` action has an
  // extra multi-line typed `row` callback param that dpe-chat (no
  // `history` action) doesn't.
  return source
    .slice(braceOpen + 1, braceClose)
    .replace(/: TranscriptTurn\[\]/g, '')
    .replace(/\(row: \{[\s\S]*?ended_at: string \| null\s*\}\)/, '(row)')
}

function makeFakeSupabaseForStart() {
  return {
    from(table) {
      if (table === 'dpe_categories') {
        return {
          select() {
            return {
              eq() {
                return { order: async () => ({ data: [], error: null }) }
              },
            }
          },
        }
      }
      if (table === 'ai_dpe_sessions') {
        return {
          insert() {
            return {
              select() {
                return { single: async () => ({ data: { id: 'session-1', status: 'in_progress', questions_asked: 1 }, error: null }) }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table in test fake: ${table}`)
    },
  }
}

// The real `json(body, status)` helper from each platform's own source
// (both are byte-identical) -- extracted rather than hand-rolled so the
// tests below assert against the exact Response shape the real
// functions actually return.
const realJsonHelperSrc = extractBlock(dpeChatSource, 'function json(body: unknown, status = 200): Response {', 'json helper')
  .replace('function json(body: unknown, status = 200): Response {', 'function json(body, status = 200) {')
// eslint-disable-next-line no-new-func
const realJson = new Function('corsHeaders', `${realJsonHelperSrc}\nreturn json`)({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
})

async function runPlatformServeBody(source, { callClaudeImpl, DpeProviderError, dpeProviderErrorResponse }) {
  const serveBody = extractServeCallbackBody(source)
  const paramNames = [
    'req',
    'SUPABASE_URL',
    'SERVICE_ROLE_KEY',
    'createClient',
    'requirePremiumAccess',
    'PremiumAccessError',
    'buildSystemPrompt',
    'callClaude',
    'toClaudeMessages',
    'CONTROL_END_NOTE',
    'DpeProviderError',
    'dpeProviderErrorResponse',
    'json',
  ]
  // eslint-disable-next-line no-new-func
  const fn = new Function(...paramNames, `return (async () => { ${serveBody} })()`)

  const req = {
    method: 'POST',
    headers: { get: () => 'Bearer user-token' },
    json: async () => ({ action: 'start' }),
  }

  return fn(
    req,
    'https://test.supabase.co',
    'test-service-role-key',
    () => makeFakeSupabaseForStart(),
    async () => ({ userId: 'user-1' }),
    class PremiumAccessError extends Error {
      constructor(message, status) {
        super(message)
        this.status = status
      }
    },
    () => 'system prompt',
    callClaudeImpl,
    (t) => t,
    '[SYSTEM: end]',
    DpeProviderError,
    dpeProviderErrorResponse,
    realJson
  )
}

describe.each([
  ['dpe-chat (web)', dpeChatSource],
  ['mobile-dpe (native)', mobileDpeSource],
])('%s serve() catch block -- real source, Nov 2026 classification', (_label, source) => {
  it('an insufficient-credits failure returns 503 with a safe message and code, never the raw Anthropic error text', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(
      new core.DpeProviderError('insufficient_credits', 'Anthropic API account has insufficient credits -- full raw body with billing text here')
    )
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(503)
    const body = JSON.parse(await response.text())
    expect(body.code).toBe('ai_dpe_insufficient_credits')
    expect(body.error.toLowerCase()).not.toContain('credit')
    expect(body.error.toLowerCase()).not.toContain('billing')
    expect(body.error).not.toContain('raw body')
  })

  it('a rate-limited failure returns 503 with the rate-limit-specific message', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(new core.DpeProviderError('rate_limited', 'rate limited'))
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(503)
    const body = JSON.parse(await response.text())
    expect(body.code).toBe('ai_dpe_rate_limited')
  })

  it('a provider-outage failure returns 503 with the provider_unavailable code', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(new core.DpeProviderError('provider_unavailable', 'down'))
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(503)
    const body = JSON.parse(await response.text())
    expect(body.code).toBe('ai_dpe_provider_unavailable')
  })

  it('an auth/config failure returns 503 with the auth_config_error code', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(new core.DpeProviderError('auth_config_error', 'bad key'))
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(503)
    const body = JSON.parse(await response.text())
    expect(body.code).toBe('ai_dpe_auth_config_error')
    expect(body.error.toLowerCase()).not.toContain('key')
  })

  it('a malformed-response failure returns 502 (unchanged from the pre-existing contract) with the malformed_response code', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(new core.DpeProviderError('malformed_response', 'The examiner had trouble responding. Please try again.'))
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(502)
    const body = JSON.parse(await response.text())
    expect(body.code).toBe('ai_dpe_malformed_response')
    expect(body.error).toBe('The examiner had trouble responding. Please try again.')
  })

  it('an unclassified error still falls back to a generic 500 with no code -- the existing fallback is unchanged', async () => {
    const core = buildDpeChatCore()
    const callClaudeImpl = vi.fn().mockRejectedValue(new Error('some totally different bug'))
    const response = await runPlatformServeBody(source, {
      callClaudeImpl,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(500)
    const body = JSON.parse(await response.text())
    expect(body.error).toBe('Internal error')
    expect(body.code).toBeUndefined()
  })

  it('a successful start (no failure at all) still returns 200 with the real turn -- the existing successful experience is unchanged', async () => {
    const core = buildDpeChatCore({
      fetchImpl: vi.fn().mockResolvedValue(anthropicResponse(JSON.stringify({ phase: 'question', message: 'Opening question.', debrief: null }))),
    })
    const response = await runPlatformServeBody(source, {
      callClaudeImpl: core.callClaude,
      DpeProviderError: core.DpeProviderError,
      dpeProviderErrorResponse: core.dpeProviderErrorResponse,
    })
    expect(response.status).toBe(200)
    const resBody = JSON.parse(await response.text())
    expect(resBody).toMatchObject({ sessionId: 'session-1', phase: 'question', message: 'Opening question.', debrief: null })
  })
})
