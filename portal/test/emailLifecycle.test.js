// Email-system audit -- regression tests for the lifecycle-email logic
// in send-lifecycle-emails/index.ts and its client-triggered twin in
// site/portal-stable.js.
//
// send-lifecycle-emails/index.ts is a Deno Edge Function: it has
// top-level remote URL imports and Deno.env.get() calls that don't exist
// under Node/vitest, so the whole module can't be imported directly.
// Instead, individual pure functions/consts are extracted by name from
// the REAL source text (brace-matched, not regex-guessed) and evaluated
// as plain JS -- same "test the actual shipped code, not a hand-copied
// reimplementation that could drift" approach staticPortalAuth.test.js
// already uses for site/portal-stable.js.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIFECYCLE_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts')
const PORTAL_STABLE_PATH = path.join(REPO_ROOT, 'site/portal-stable.js')

const lifecycleSource = readFileSync(LIFECYCLE_PATH, 'utf8')
const portalStableSource = readFileSync(PORTAL_STABLE_PATH, 'utf8')

function findMatchingBrace(source, openIdx) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

// Extracts a `function NAME(...) { ... }` body (braces stripped) so it
// can be re-wrapped as plain JS with `new Function(...)`. Only safe for
// functions with no nested parens in their parameter list, which is true
// of every function pulled out below.
function extractFunctionBody(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(braceOpen + 1, braceClose)
}

// Extracts a `const NAME = { ... }` object literal's value only (the type
// annotation between the name and `=`, e.g. `: Record<string, {...}>`,
// is never included in the reconstructed snippet, so it never needs
// stripping).
function extractConstObjectLiteral(source, constMarker) {
  const startIdx = source.indexOf(constMarker)
  if (startIdx === -1) throw new Error(`Const not found: ${constMarker}`)
  const eqIdx = source.indexOf('=', startIdx)
  const braceOpen = source.indexOf('{', eqIdx)
  const braceClose = findMatchingBrace(source, braceOpen)
  // eslint-disable-next-line no-new-func
  return new Function(`return (${source.slice(braceOpen, braceClose + 1)})`)()
}

function extractFunctionSourceBlock(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  if (startIdx === -1) throw new Error(`Function not found: ${functionMarker}`)
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(startIdx, braceClose + 1)
}

describe('daysNoun() -- countdown pluralization fix (email-system audit, item 1)', () => {
  // eslint-disable-next-line no-new-func
  const daysNoun = new Function('n', extractFunctionBody(lifecycleSource, 'function daysNoun('))

  it('is singular for exactly 1 day', () => {
    expect(daysNoun(1)).toBe('day')
  })

  it('is plural for 0 and for every other count', () => {
    expect(daysNoun(0)).toBe('days')
    expect(daysNoun(2)).toBe('days')
    expect(daysNoun(7)).toBe('days')
    expect(daysNoun(30)).toBe('days')
  })
})

describe('the countdown email subject line uses daysNoun(), not a hardcoded plural', () => {
  it('processCountdown() builds its subject with daysNoun(threshold), the fixed call site for the "1 days" bug', () => {
    const processCountdownSource = extractFunctionSourceBlock(lifecycleSource, 'async function processCountdown(')
    expect(processCountdownSource).toMatch(/\$\{threshold\}\s+\$\{daysNoun\(threshold\)\}\s+until your checkride/)
  })

  it('computes "today" from the member\'s own timezone, not the server\'s UTC day', () => {
    const processCountdownSource = extractFunctionSourceBlock(lifecycleSource, 'async function processCountdown(')
    expect(processCountdownSource).toContain('profile.timezone')
    expect(processCountdownSource).toContain('localDateString(')
  })
})

describe('checkrideUpsellSubject() -- day-30 apologetic tone fix', () => {
  // eslint-disable-next-line no-new-func
  const checkrideUpsellSubject = new Function('day, pricing', extractFunctionBody(lifecycleSource, 'function checkrideUpsellSubject('))
  const standardPricing = { tier: 'standard', amount_cents: 4900, founding_seats_remaining: 0, launch_expires_at: null }

  it('produces a distinct, non-empty subject for every scheduled touchpoint', () => {
    const days = [1, 3, 6, 7, 12, 14, 21, 30]
    const subjects = days.map((day) => checkrideUpsellSubject(day, standardPricing))
    expect(subjects.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
    expect(new Set(subjects).size).toBe(subjects.length)
  })

  it('day 30 reads as confident, not apologetic ("stop emailing")', () => {
    const subject = checkrideUpsellSubject(30, standardPricing)
    expect(subject.toLowerCase()).not.toContain('stop')
    expect(subject.toLowerCase()).not.toContain('one more look')
  })

  it('never invents a founding-seat count when the tier is standard', () => {
    const subject = checkrideUpsellSubject(7, standardPricing)
    expect(subject).not.toMatch(/\d+ founding/)
  })
})

describe('WEAK_AREA_CONTENT / CATEGORY_LABELS -- full 13-category ACS coverage (email-system audit, item 3)', () => {
  const weakAreaContent = extractConstObjectLiteral(lifecycleSource, 'const WEAK_AREA_CONTENT')
  const categoryLabels = extractConstObjectLiteral(lifecycleSource, 'const CATEGORY_LABELS')

  const REAL_PRIVATE_PILOT_CATEGORIES = [
    'eligibility', 'airworthiness', 'privileges', 'airspace', 'weather', 'performance',
    'aeromedical', 'crosscountry', 'emergency', 'adm', 'aerodynamics', 'aircraft-systems', 'airport-operations',
  ]

  it('covers exactly the 13 real Private Pilot ACS categories, no more, no fewer', () => {
    expect(Object.keys(weakAreaContent).sort()).toEqual([...REAL_PRIVATE_PILOT_CATEGORIES].sort())
  })

  it('CATEGORY_LABELS has a human-readable label for every WEAK_AREA_CONTENT key', () => {
    for (const cat of Object.keys(weakAreaContent)) {
      expect(categoryLabels[cat], `missing label for ${cat}`).toBeTruthy()
    }
  })

  it('every entry has both a subject and a body', () => {
    for (const [cat, entry] of Object.entries(weakAreaContent)) {
      expect(entry.subject, cat).toBeTruthy()
      expect(entry.body, cat).toBeTruthy()
    }
  })

  // Email-system audit, item 7: remove unsupported absolute claims about
  // what DPEs always ask or why applicants always fail.
  it('never uses unsubstantiated absolute claims ("always", "every DPE", "single most")', () => {
    const bannedPhrases = [/\balways\b/i, /\bevery dpe\b/i, /\bsingle most\b/i, /\bnever fail/i, /\bguarantee/i]
    for (const [cat, entry] of Object.entries(weakAreaContent)) {
      for (const phrase of bannedPhrases) {
        expect(entry.body, `${cat} body matched banned phrase ${phrase}`).not.toMatch(phrase)
        expect(entry.subject, `${cat} subject matched banned phrase ${phrase}`).not.toMatch(phrase)
      }
    }
  })
})

describe('weak-area content stays in sync between server cron and client-triggered copy', () => {
  // site/portal-stable.js's own header comment on this block says it's
  // "kept in sync manually" with the server-side WEAK_AREA_CONTENT --
  // exactly the kind of hand-maintained invariant that silently drifts,
  // so it's asserted here byte-for-byte (as data, not as source text) on
  // every test run.
  it('WEAK_AREA_CONTENT is identical, key-for-key and string-for-string, between the two copies', () => {
    const serverContent = extractConstObjectLiteral(lifecycleSource, 'const WEAK_AREA_CONTENT')
    const clientContent = extractConstObjectLiteral(portalStableSource, 'var WEAK_AREA_CONTENT')
    expect(clientContent).toEqual(serverContent)
  })
})

describe('lifecycleCtaUrl() -- CTA link UTM attribution (email-system audit, "audit every link/CTA/UTM")', () => {
  // eslint-disable-next-line no-new-func
  const lifecycleCtaUrl = new Function('campaign, content, hash', extractFunctionBody(lifecycleSource, 'function lifecycleCtaUrl('))

  it('always tags source/medium as email and carries the given campaign/content', () => {
    const url = lifecycleCtaUrl('weak_area', 'weak_area_weather', '')
    expect(url).toContain('utm_source=email')
    expect(url).toContain('utm_medium=email')
    expect(url).toContain('utm_campaign=weak_area')
    expect(url).toContain('utm_content=weak_area_weather')
  })

  it('puts the query string before the hash so section routing still works', () => {
    const url = lifecycleCtaUrl('milestone', 'first_question', '#dpe-library')
    const hashIdx = url.indexOf('#dpe-library')
    const queryIdx = url.indexOf('utm_source')
    expect(hashIdx).toBeGreaterThan(queryIdx)
    expect(url.endsWith('#dpe-library')).toBe(true)
  })

  it('omits the hash cleanly when none is given', () => {
    const url = lifecycleCtaUrl('weekly_progress', 'weekly_progress', '')
    expect(url).not.toContain('#')
  })
})

describe('inactivity-email coordination -- 7-day vs 14-day suppression (email-system audit, item 2)', () => {
  it('defines a shared coordination gap constant', () => {
    expect(lifecycleSource).toContain('const INACTIVITY_COORDINATION_GAP_DAYS')
  })

  it('processReactivationInactive() checks the 7-day inactivity email before sending', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processReactivationInactive(')
    expect(block).toContain('INACTIVITY_COORDINATION_GAP_DAYS')
    expect(block).toContain("'inactivity_7day'")
  })

  it('processInactivity() checks the reactivation-inactive email before sending', () => {
    const block = extractFunctionSourceBlock(lifecycleSource, 'async function processInactivity(')
    expect(block).toContain('INACTIVITY_COORDINATION_GAP_DAYS')
    expect(block).toContain("'reactivation_inactive'")
  })
})

describe('first-question milestone entitlement fix (email-system audit, item 5)', () => {
  it('processFirstQuestionMilestone() exists as its own function, independent of paid-gated processMilestones()', () => {
    expect(lifecycleSource).toContain('async function processFirstQuestionMilestone(')
  })

  it('the main serve() loop calls it unconditionally -- not gated behind checkride_prep_unlocked', () => {
    const serveIdx = lifecycleSource.indexOf('async function serve(')
    const altServeIdx = lifecycleSource.indexOf('serve(async')
    const anchorIdx = serveIdx !== -1 ? serveIdx : altServeIdx
    expect(anchorIdx, 'serve() entry point not found').not.toBe(-1)
    const callIdx = lifecycleSource.indexOf('processFirstQuestionMilestone(', anchorIdx)
    expect(callIdx, 'processFirstQuestionMilestone() is never called from serve()').toBeGreaterThan(-1)
    // The call site itself must not be inside an `if (...checkride_prep_unlocked...)` on the same line/guard.
    const callLineStart = lifecycleSource.lastIndexOf('\n', callIdx)
    const callLine = lifecycleSource.slice(callLineStart, callIdx)
    expect(callLine).not.toContain('checkride_prep_unlocked')
  })

  it('no longer ships the celebratory emoji on the first-question subject line', () => {
    expect(lifecycleSource).not.toContain('first question 🎉')
    expect(portalStableSource).not.toContain('first question 🎉')
  })
})
