// Regression coverage for isEligibleProfile() and makeReferralCode() --
// the one-time referral-program nudge in
// supabase/functions/send-referral-nudge/index.ts. Extracted from the
// real shipped source (brace-matching + new Function), same convention
// already used in captureWaitlistLead.test.js for Deno Edge Functions
// that can't be imported directly under Node/vitest.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = path.join(REPO_ROOT, 'supabase/functions/send-referral-nudge/index.ts')
const source = readFileSync(SOURCE_PATH, 'utf8')

function extractBlock(src, marker, label = marker) {
  const startIdx = src.indexOf(marker)
  expect(startIdx, `${label} not found`).toBeGreaterThan(-1)
  const braceOpen = src.indexOf('{', startIdx)
  let depth = 0
  let i = braceOpen
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(startIdx, i + 1)
}

const makeReferralCodeSrc = extractBlock(source, 'function makeReferralCode(', 'makeReferralCode')
  .replace("function makeReferralCode(fullName: string | null): string {", 'function makeReferralCode(fullName) {')

const isEligibleSrc = extractBlock(source, 'function isEligibleProfile(', 'isEligibleProfile')
  .replace(
    'function isEligibleProfile(profile: ReferralEligibilityProfile): boolean {',
    'function isEligibleProfile(profile) {',
  )

// eslint-disable-next-line no-new-func
const makeReferralCode = new Function(`
  ${makeReferralCodeSrc}
  return makeReferralCode
`)()

// eslint-disable-next-line no-new-func
const isEligibleProfile = new Function(`
  ${isEligibleSrc}
  return isEligibleProfile
`)()

describe('makeReferralCode() (real shipped source, executed)', () => {
  it('uses the first name, uppercased, letters only, max 8 chars, plus 4 digits', () => {
    expect(makeReferralCode('Jordan Avery')).toMatch(/^JORDAN\d{4}$/)
    expect(makeReferralCode('alexandria-rose')).toMatch(/^ALEXANDR\d{4}$/)
  })

  it('strips non-letter characters from the first name', () => {
    expect(makeReferralCode("O'Brien")).toMatch(/^OBRIEN\d{4}$/)
  })

  it('falls back to PILOT for a null/empty name', () => {
    expect(makeReferralCode(null)).toMatch(/^PILOT\d{4}$/)
    expect(makeReferralCode('')).toMatch(/^PILOT\d{4}$/)
  })

  it('falls back to PILOT when the first name has no letters at all', () => {
    expect(makeReferralCode('123 456')).toMatch(/^PILOT\d{4}$/)
  })
})

describe('isEligibleProfile() (real shipped source, executed)', () => {
  const base = { role: 'student', email: 'a@b.com', email_marketing_opt_out: false, checkride_prep_unlocked: false }

  it('accepts a student with no opt-out and no prep unlock', () => {
    expect(isEligibleProfile(base)).toBe(true)
  })

  it('rejects non-students', () => {
    expect(isEligibleProfile({ ...base, role: 'instructor' })).toBe(false)
    expect(isEligibleProfile({ ...base, role: 'admin' })).toBe(false)
  })

  it('rejects a profile with no email', () => {
    expect(isEligibleProfile({ ...base, email: null })).toBe(false)
    expect(isEligibleProfile({ ...base, email: '' })).toBe(false)
  })

  it('rejects anyone opted out of marketing email', () => {
    expect(isEligibleProfile({ ...base, email_marketing_opt_out: true })).toBe(false)
  })

  it('rejects anyone who already has Checkride Prep unlocked -- the reward has no value to them', () => {
    expect(isEligibleProfile({ ...base, checkride_prep_unlocked: true })).toBe(false)
  })

  it('treats null opt-out/unlock flags as not-opted-out/not-unlocked (DB default)', () => {
    expect(isEligibleProfile({ ...base, email_marketing_opt_out: null, checkride_prep_unlocked: null })).toBe(true)
  })
})
