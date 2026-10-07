// Attribution audit (Oct 2026) -- regression coverage for the
// UTM_SOURCE_ALIASES map + sanitizeUtm() in create-free-account/index.ts
// and create-checkout-session/index.ts. Both are plain JS/TS with no
// Deno-only syntax inside their bodies, so they're extracted and
// executed directly via `new Function(...)` (same convention as
// emailTemplates.test.js's extractFunctionBody()) rather than needing a
// full Deno vm sandbox -- real behavioral coverage of the exact code
// that ships, not a static text assertion.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Brace-matches from the first `(` after the marker -- works for a
// `function name(...) { ... }` declaration.
function extractFunctionBody(source, functionNameMarker) {
  const startIdx = source.indexOf(functionNameMarker)
  if (startIdx === -1) throw new Error(`Marker not found: ${functionNameMarker}`)
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

// Brace-matches from the first `{` after the marker -- for a
// `const NAME: Type = { ... }` object literal, which has no parens to
// anchor on the way extractFunctionBody does.
function extractObjectLiteral(source, constNameMarker) {
  const startIdx = source.indexOf(constNameMarker)
  if (startIdx === -1) throw new Error(`Marker not found: ${constNameMarker}`)
  const braceOpen = source.indexOf('{', startIdx)
  let depth = 0
  let i = braceOpen
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) break }
  }
  return source.slice(braceOpen, i + 1)
}

// sanitizeUtm() closes over UTM_SOURCE_ALIASES (a sibling top-level
// const, not a parameter), so both are extracted together and run as
// one function body with a `utm` parameter -- matching how they're
// actually wired in each real source file.
function loadSanitizeUtm(relativePath) {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
  const aliasesLiteral = extractObjectLiteral(source, 'const UTM_SOURCE_ALIASES')
  const aliasesDecl = `const UTM_SOURCE_ALIASES = ${aliasesLiteral}`
  // `new Function` runs via the JS engine directly (no TS transform),
  // so the one inline type annotation inside the body (`const out:
  // Record<string, string | null> = {}`) has to be stripped first or
  // it's a plain SyntaxError -- the parameter's own `utm: any` type
  // lives in the signature, which isn't part of the extracted body, so
  // it never reaches here.
  const fnBody = extractFunctionBody(source, 'function sanitizeUtm(utm').replace(/:\s*Record<[^>]*>/g, '')
  // eslint-disable-next-line no-new-func
  return new Function('utm', `${aliasesDecl}\n${fnBody}`)
}

describe.each([
  ['create-free-account', 'portal/supabase/functions/create-free-account/index.ts'],
  ['create-checkout-session', 'portal/supabase/functions/create-checkout-session/index.ts'],
])('%s sanitizeUtm() UTM source canonicalization', (_name, relativePath) => {
  const sanitizeUtm = loadSanitizeUtm(relativePath)

  it('collapses fb/meta into facebook, case-insensitively', () => {
    expect(sanitizeUtm({ source: 'fb' }).source).toBe('facebook')
    expect(sanitizeUtm({ source: 'Meta' }).source).toBe('facebook')
    expect(sanitizeUtm({ source: 'FACEBOOK' }).source).toBe('facebook')
  })

  it('collapses ig into instagram', () => {
    expect(sanitizeUtm({ source: 'ig' }).source).toBe('instagram')
    expect(sanitizeUtm({ source: 'IG' }).source).toBe('instagram')
  })

  it('lowercases an unrecognized source instead of dropping or guessing at it', () => {
    expect(sanitizeUtm({ source: 'google' }).source).toBe('google')
    expect(sanitizeUtm({ source: 'TikTok' }).source).toBe('tiktok')
  })

  it('never touches medium -- paid_social vs social stays a real distinction', () => {
    expect(sanitizeUtm({ source: 'fb', medium: 'paid_social' }).medium).toBe('paid_social')
    expect(sanitizeUtm({ source: 'fb', medium: 'social' }).medium).toBe('social')
  })

  it('still drops a malformed/missing source instead of canonicalizing garbage', () => {
    expect(sanitizeUtm({}).source).toBeNull()
    expect(sanitizeUtm({ source: 123 }).source).toBeNull()
  })
})
