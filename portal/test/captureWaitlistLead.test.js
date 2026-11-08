// Regression coverage for classifyLocationSegment() -- the new logic
// added to capture-waitlist-lead/index.ts so the CRM can tell apart a
// website waitlist signup who wants Austin in-person flight training
// from one who only wants virtual/remote services. Extracted from the
// real shipped source (brace-matching + new Function), same convention
// already used elsewhere in this test suite for Deno Edge Functions
// that can't be imported directly under Node/vitest.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATH = path.join(REPO_ROOT, 'supabase/functions/capture-waitlist-lead/index.ts')
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

// These two are single-line `const X = new Set([...])` statements --
// no {} block for extractBlock's brace-matching to key off, so just
// grab the line itself.
function extractLine(src, marker, label = marker) {
  const startIdx = src.indexOf(marker)
  expect(startIdx, `${label} not found`).toBeGreaterThan(-1)
  const lineEnd = src.indexOf('\n', startIdx)
  return src.slice(startIdx, lineEnd)
}

const inPersonSrc = extractLine(source, 'const IN_PERSON_SERVICES', 'IN_PERSON_SERVICES')
const virtualSrc = extractLine(source, 'const VIRTUAL_SERVICES', 'VIRTUAL_SERVICES')
const classifySrc = extractBlock(source, 'function classifyLocationSegment(', 'classifyLocationSegment')
  .replace(
    "function classifyLocationSegment(services: string[]): 'austin_in_person' | 'virtual' | 'both' | null {",
    'function classifyLocationSegment(services) {'
  )
const buildNotesSrc = extractBlock(source, 'function buildNotes(', 'buildNotes')
  .replace(
    /function buildNotes\(\s*pageSource: string,\s*zip: string,\s*services: string\[\],\s*trainingGoal: string,\s*targetStartMonth: string,\s*ratesWork: string,\s*lessonWindow1: string,\s*lessonWindow2: string,\s*\): string \{/,
    'function buildNotes(pageSource, zip, services, trainingGoal, targetStartMonth, ratesWork, lessonWindow1, lessonWindow2) {'
  )

// eslint-disable-next-line no-new-func
const classifyLocationSegment = new Function(`
  ${inPersonSrc}
  ${virtualSrc}
  ${classifySrc}
  return classifyLocationSegment
`)()

// eslint-disable-next-line no-new-func
const buildNotes = new Function(`
  ${buildNotesSrc}
  return buildNotes
`)()

describe('classifyLocationSegment() (real shipped source, executed)', () => {
  it('classifies in-person-only selections as austin_in_person', () => {
    expect(classifyLocationSegment(['Private Pilot Training'])).toBe('austin_in_person')
    expect(classifyLocationSegment(['Instrument Rating', 'Commercial Pilot'])).toBe('austin_in_person')
    expect(classifyLocationSegment(['IPC / BFR / Currency'])).toBe('austin_in_person')
  })

  it('classifies virtual-only selections as virtual', () => {
    expect(classifyLocationSegment(['Private Instruction'])).toBe('virtual')
    expect(classifyLocationSegment(['Checkride Prep System', 'Mock Oral Exam'])).toBe('virtual')
  })

  it('classifies a mix of both kinds as both', () => {
    expect(classifyLocationSegment(['Private Pilot Training', 'Checkride Prep System'])).toBe('both')
    expect(classifyLocationSegment(['IPC / BFR / Currency', 'Private Instruction', 'Commercial Pilot'])).toBe('both')
  })

  it('returns null for no services, or services matching neither known set', () => {
    expect(classifyLocationSegment([])).toBeNull()
    // A retired label (e.g. the old "Apex Advantage Ground" checkbox, or
    // any future value not yet added to either set) must never throw --
    // it simply doesn't count toward either side.
    expect(classifyLocationSegment(['Apex Advantage Ground'])).toBeNull()
    expect(classifyLocationSegment(['Some Future Service'])).toBeNull()
  })

  it('an unrecognized label alongside a recognized one still classifies correctly', () => {
    expect(classifyLocationSegment(['Apex Advantage Ground', 'Private Pilot Training'])).toBe('austin_in_person')
    expect(classifyLocationSegment(['Apex Advantage Ground', 'Mock Oral Exam'])).toBe('virtual')
  })
})

describe('buildNotes() (real shipped source, executed)', () => {
  it('matches the original home.html shape when none of the newer fields are sent', () => {
    expect(buildNotes('Website Waitlist (home.html)', '78666', ['Private Pilot Training'], '', '', '', '', ''))
      .toBe('Website Waitlist (home.html). Zip: 78666. Interested in: Private Pilot Training')
  })

  it('omits zip/services entirely when empty, same as before', () => {
    expect(buildNotes('Website Waitlist (home.html)', '', [], '', '', '', '', ''))
      .toBe('Website Waitlist (home.html)')
  })

  it('appends the Hutto/Taylor landing-page fields only when present', () => {
    expect(buildNotes(
      'Hutto/Taylor Flight Training Landing Page (flight-training-hutto-taylor.html)',
      '78634',
      ['Private Pilot Training'],
      'Never flown before',
      'March 2027 (planning target)',
      "Yes, that works for me",
      'Tuesday mornings',
      'Saturday afternoons',
    )).toBe(
      'Hutto/Taylor Flight Training Landing Page (flight-training-hutto-taylor.html). ' +
      'Zip: 78634. Interested in: Private Pilot Training. Training goal: Never flown before. ' +
      'Target start: March 2027 (planning target). Proposed rates work for them: Yes, that works for me. ' +
      'Preferred lesson windows: Tuesday mornings / Saturday afternoons'
    )
  })

  it('joins only whichever of the two lesson windows is actually present', () => {
    expect(buildNotes('src', '', [], '', '', '', 'Tuesday mornings', ''))
      .toBe('src. Preferred lesson windows: Tuesday mornings')
    expect(buildNotes('src', '', [], '', '', '', '', 'Saturday afternoons'))
      .toBe('src. Preferred lesson windows: Saturday afternoons')
  })
})
