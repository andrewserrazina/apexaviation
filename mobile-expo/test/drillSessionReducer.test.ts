import type { MobilePracticeQuestion } from '../../shared/mobile-dto'
import {
  allQuestionsRated,
  buildCompleteResponses,
  createDrillSessionState,
  currentQuestion,
  currentRating,
  drillSessionReducer,
  isCurrentRevealed,
  isLastQuestion,
} from '../lib/drillSessionReducer'

const QUESTIONS: MobilePracticeQuestion[] = [
  { id: 'q1', question: 'Question 1', category: 'weather' },
  { id: 'q2', question: 'Question 2', category: 'weather' },
  { id: 'q3', question: 'Question 3', category: null },
]

function initialized() {
  return drillSessionReducer(createDrillSessionState([]), {
    type: 'initialize',
    questions: QUESTIONS,
    ratings: {},
    revealed: {},
  })
}

describe('drillSessionReducer', () => {
  // Q: server-provided question order is preserved.
  it('preserves the server-provided question order after initialize', () => {
    const state = initialized()
    expect(state.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(currentQuestion(state)?.id).toBe('q1')
  })

  // R: model answer / rating controls are hidden before reveal (the
  // reducer's isCurrentRevealed flag is what screens gate rendering on).
  it('starts with the current question unrevealed', () => {
    const state = initialized()
    expect(isCurrentRevealed(state)).toBe(false)
  })

  // S: a rating is ignored (never recorded) before the question has been
  // revealed -- the learner must see the model answer first.
  it('ignores a rate action for a question that has not been revealed', () => {
    let state = initialized()
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'correct' })
    expect(currentRating(state)).toBeNull()
  })

  it('reveals a question and then accepts a rating for it', () => {
    let state = initialized()
    state = drillSessionReducer(state, { type: 'reveal', questionId: 'q1' })
    expect(isCurrentRevealed(state)).toBe(true)
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'correct' })
    expect(currentRating(state)).toBe('correct')
  })

  // U / V / W: exact wire values for each rating button.
  it.each([
    ['correct', 'correct'],
    ['partial', 'partial'],
    ['incorrect', 'incorrect'],
  ] as const)('records the exact wire value %s for a rating', (input, expected) => {
    let state = initialized()
    state = drillSessionReducer(state, { type: 'reveal', questionId: 'q1' })
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: input })
    expect(state.ratings.q1).toBe(expected)
  })

  // X: one rating per question -- rating the same question twice REPLACES
  // the prior selection, never appends a second entry.
  it('replaces a prior rating for the same question rather than duplicating it', () => {
    let state = initialized()
    state = drillSessionReducer(state, { type: 'reveal', questionId: 'q1' })
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'incorrect' })
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'correct' })
    expect(state.ratings.q1).toBe('correct')
    expect(Object.keys(state.ratings)).toHaveLength(1)
  })

  it('reports isLastQuestion only once the index reaches the final question', () => {
    let state = initialized()
    expect(isLastQuestion(state)).toBe(false)
    state = drillSessionReducer(state, { type: 'goToNext' })
    state = drillSessionReducer(state, { type: 'goToNext' })
    expect(isLastQuestion(state)).toBe(true)
    // goToNext never walks past the last question.
    state = drillSessionReducer(state, { type: 'goToNext' })
    expect(state.index).toBe(2)
  })

  it('allQuestionsRated is false until every question has a rating, then true', () => {
    let state = initialized()
    expect(allQuestionsRated(state)).toBe(false)

    for (const q of QUESTIONS) {
      state = drillSessionReducer(state, { type: 'reveal', questionId: q.id })
      state = drillSessionReducer(state, { type: 'rate', questionId: q.id, rating: 'correct' })
    }
    expect(allQuestionsRated(state)).toBe(true)
  })

  it('allQuestionsRated is false for an empty question list', () => {
    expect(allQuestionsRated(createDrillSessionState([]))).toBe(false)
  })

  // Y: complete payload includes every question exactly once, in order,
  // with no duplicates possible.
  it('buildCompleteResponses emits one entry per question_id in server order', () => {
    let state = initialized()
    for (const q of QUESTIONS) {
      state = drillSessionReducer(state, { type: 'reveal', questionId: q.id })
      state = drillSessionReducer(state, { type: 'rate', questionId: q.id, rating: 'partial' })
    }
    // Re-rate q1 to prove the final build reflects the latest selection,
    // still with exactly one entry for q1.
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'correct' })

    const responses = buildCompleteResponses(state)
    expect(responses).toEqual([
      { question_id: 'q1', self_rating: 'correct' },
      { question_id: 'q2', self_rating: 'partial' },
      { question_id: 'q3', self_rating: 'partial' },
    ])
  })

  it('buildCompleteResponses omits any question that has not been rated yet', () => {
    let state = initialized()
    state = drillSessionReducer(state, { type: 'reveal', questionId: 'q1' })
    state = drillSessionReducer(state, { type: 'rate', questionId: 'q1', rating: 'correct' })
    expect(buildCompleteResponses(state)).toEqual([{ question_id: 'q1', self_rating: 'correct' }])
  })

  it('initialize restores locally-persisted ratings/reveals atomically alongside a fresh question list', () => {
    const state = drillSessionReducer(createDrillSessionState([]), {
      type: 'initialize',
      questions: QUESTIONS,
      ratings: { q1: 'correct' },
      revealed: { q1: true },
    })
    expect(state.questions).toHaveLength(3)
    expect(state.ratings.q1).toBe('correct')
    expect(isCurrentRevealed(state)).toBe(true)
  })
})
