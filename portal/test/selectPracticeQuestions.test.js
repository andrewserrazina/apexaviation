// Regression coverage for selectPracticeQuestions() -- the new
// Readiness-to-Practice Activation question-selection logic added to
// site/readiness-assessment.html's inline <script>. Extracted from the
// real shipped source (brace-matching + new Function), same convention
// already used in captureWaitlistLead.test.js for inline/non-importable
// script logic that can't be import()ed directly under Node/vitest.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_PATH = path.join(REPO_ROOT, 'site/readiness-assessment.html')
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

const shuffleArraySrc = extractBlock(source, 'function shuffleArray(', 'shuffleArray')
const selectPracticeQuestionsSrc = extractBlock(source, 'function selectPracticeQuestions(', 'selectPracticeQuestions')

// eslint-disable-next-line no-new-func
const selectPracticeQuestions = new Function(`
  ${shuffleArraySrc}
  ${selectPracticeQuestionsSrc}
  return selectPracticeQuestions
`)()

function makeQuestion(cat, label) {
  return { cat, q: label, options: ['a', 'b', 'c', 'd'], correct: 0, explain: 'why', review: 'topic' }
}

describe('selectPracticeQuestions() (real shipped source, executed)', () => {
  it('returns [] when there are no questions to choose from', () => {
    expect(selectPracticeQuestions([], { answerLog: [], weakest: [] }, 5)).toEqual([])
  })

  it('defaults maxCount to 5 when omitted', () => {
    const questions = Array.from({ length: 20 }, (_, i) => makeQuestion('weather', 'q' + i))
    const result = selectPracticeQuestions(questions, { answerLog: [], weakest: [] })
    expect(result).toHaveLength(5)
  })

  it('tier 1: prioritizes questions answered wrong when at least 3 were missed, padding up to maxCount', () => {
    const questions = Array.from({ length: 10 }, (_, i) => makeQuestion('cat' + i, 'q' + i))
    const answerLog = [
      { q: 0, correct: false },
      { q: 2, correct: false },
      { q: 4, correct: false },
      { q: 1, correct: true },
    ]
    const result = selectPracticeQuestions(questions, { answerLog, weakest: [] }, 5)
    expect(result).toHaveLength(5)
    // All 3 confirmed-wrong questions must be included -- they're the
    // whole point of tier 1 -- with the remaining 2 slots padded from
    // the rest of the bank.
    expect(result).toContain(questions[0])
    expect(result).toContain(questions[2])
    expect(result).toContain(questions[4])
    // No duplicates.
    expect(new Set(result).size).toBe(5)
  })

  it('tier 1 never returns more than the number of confirmed-wrong questions as a strict subset without padding when the pool alone is smaller than maxCount', () => {
    // Exactly 3 wrong answers and nothing else requested beyond that --
    // padding must come from the UNCHOSEN remainder, never a repeat.
    const questions = Array.from({ length: 4 }, (_, i) => makeQuestion('cat' + i, 'q' + i))
    const answerLog = [
      { q: 0, correct: false },
      { q: 1, correct: false },
      { q: 2, correct: false },
      { q: 3, correct: true },
    ]
    const result = selectPracticeQuestions(questions, { answerLog, weakest: [] }, 4)
    expect(result).toHaveLength(4)
    expect(new Set(result).size).toBe(4)
  })

  it('tier 2: falls back to the bottom-2 weakest categories when fewer than 3 answers were wrong', () => {
    const questions = [
      ...Array.from({ length: 4 }, (_, i) => makeQuestion('weather', 'weather' + i)),
      ...Array.from({ length: 4 }, (_, i) => makeQuestion('airspace', 'airspace' + i)),
      ...Array.from({ length: 4 }, (_, i) => makeQuestion('emergency', 'emergency' + i)),
    ]
    const answerLog = [{ q: 0, correct: false }] // only 1 wrong -- below the tier-1 threshold of 3
    const weakest = [{ cat: 'weather', score: 40 }, { cat: 'airspace', score: 55 }]
    const result = selectPracticeQuestions(questions, { answerLog, weakest }, 5)
    expect(result).toHaveLength(5)
    expect(new Set(result).size).toBe(5)
    // The emergency-category questions must not appear -- the weak-
    // category pool (8 questions) is already large enough to fill
    // maxCount without needing to broaden further.
    result.forEach((q) => expect(['weather', 'airspace']).toContain(q.cat))
  })

  it('tier 3: falls back to the full active bank when nothing is wrong and no weak categories exist', () => {
    const questions = Array.from({ length: 20 }, (_, i) => makeQuestion('cat' + (i % 9), 'q' + i))
    const answerLog = questions.map((_, i) => ({ q: i, correct: true }))
    const result = selectPracticeQuestions(questions, { answerLog, weakest: [] }, 5)
    expect(result).toHaveLength(5)
    expect(new Set(result).size).toBe(5)
  })

  it('tier 3 also applies when results.weakest contains only null/undefined entries', () => {
    const questions = Array.from({ length: 10 }, (_, i) => makeQuestion('cat' + i, 'q' + i))
    const result = selectPracticeQuestions(questions, { answerLog: [], weakest: [null, undefined] }, 5)
    expect(result).toHaveLength(5)
  })

  it('never returns a session longer than the number of questions available', () => {
    const questions = Array.from({ length: 3 }, (_, i) => makeQuestion('weather', 'q' + i))
    const result = selectPracticeQuestions(questions, { answerLog: [], weakest: [] }, 5)
    expect(result).toHaveLength(3)
    expect(new Set(result).size).toBe(3)
  })

  it('tolerates a missing/undefined results object entirely', () => {
    const questions = Array.from({ length: 10 }, (_, i) => makeQuestion('cat' + i, 'q' + i))
    const result = selectPracticeQuestions(questions, undefined, 5)
    expect(result).toHaveLength(5)
  })
})
