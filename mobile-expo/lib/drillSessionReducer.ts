// Pure, framework-free state machine for one Daily Drill question-answer
// pass. Kept separate from any React hook so it can be unit tested
// directly (see test/drillSessionReducer.test.ts) -- this is where
// Sprint 1A's "one rating per question ID" guarantees actually live:
//
//  - a question can't be rated before it's been revealed
//  - rating the same question twice REPLACES the local selection, never
//    appends a second entry (ratings is keyed by question_id, not a list)
//  - buildResponses() only ever emits one entry per question_id, in the
//    drill's own server-provided question order
//  - the drill can only be marked complete once every question in
//    `questions` has a rating
import type { MobilePracticeQuestion, SelfRating } from '../../shared/mobile-dto'

export interface DrillSessionState {
  questions: MobilePracticeQuestion[]
  index: number
  ratings: Record<string, SelfRating>
  revealed: Record<string, boolean>
}

export type DrillSessionAction =
  | { type: 'reveal'; questionId: string }
  | { type: 'rate'; questionId: string; rating: SelfRating }
  | { type: 'goToNext' }
  // Sets questions + any locally-restored ratings/reveals in one atomic
  // step, once Start/Resume resolves. Deliberately a single action rather
  // than "setQuestions" + "restore" as two dispatches -- two separate
  // dispatches would each re-render with an inconsistent intermediate
  // state (new questions paired with the OLD ratings/revealed, or vice
  // versa) before React settles, which is exactly the kind of transient
  // bug this reducer exists to make impossible.
  | { type: 'initialize'; questions: MobilePracticeQuestion[]; ratings: Record<string, SelfRating>; revealed: Record<string, boolean> }

export function createDrillSessionState(questions: MobilePracticeQuestion[]): DrillSessionState {
  return { questions, index: 0, ratings: {}, revealed: {} }
}

export function drillSessionReducer(state: DrillSessionState, action: DrillSessionAction): DrillSessionState {
  switch (action.type) {
    case 'reveal':
      if (state.revealed[action.questionId]) return state
      return { ...state, revealed: { ...state.revealed, [action.questionId]: true } }

    case 'rate': {
      // Rating replaces any prior selection for this exact question_id --
      // ratings is a map, so this can never produce a duplicate entry.
      // Ignored if the question was never revealed: the learner must see
      // the model answer/debrief before self-rating (Sprint 1A section 10).
      if (!state.revealed[action.questionId]) return state
      return { ...state, ratings: { ...state.ratings, [action.questionId]: action.rating } }
    }

    case 'goToNext':
      return { ...state, index: Math.min(state.index + 1, Math.max(state.questions.length - 1, 0)) }

    case 'initialize':
      return { questions: action.questions, index: 0, ratings: { ...action.ratings }, revealed: { ...action.revealed } }

    default:
      return state
  }
}

export function currentQuestion(state: DrillSessionState): MobilePracticeQuestion | null {
  return state.questions[state.index] ?? null
}

export function isCurrentRevealed(state: DrillSessionState): boolean {
  const q = currentQuestion(state)
  return q ? !!state.revealed[q.id] : false
}

export function currentRating(state: DrillSessionState): SelfRating | null {
  const q = currentQuestion(state)
  return q ? state.ratings[q.id] ?? null : null
}

export function isLastQuestion(state: DrillSessionState): boolean {
  return state.index >= state.questions.length - 1
}

// True only once every question in the drill has a rating -- the gate
// for enabling "Complete Drill."
export function allQuestionsRated(state: DrillSessionState): boolean {
  if (state.questions.length === 0) return false
  return state.questions.every((q) => state.ratings[q.id] !== undefined)
}

// Builds the exact payload mobile-practice's `complete` action expects:
// one entry per question_id, in the drill's own stored order, no
// duplicates possible because `ratings` is keyed by question_id.
export function buildCompleteResponses(state: DrillSessionState): Array<{ question_id: string; self_rating: SelfRating }> {
  return state.questions
    .filter((q) => state.ratings[q.id] !== undefined)
    .map((q) => ({ question_id: q.id, self_rating: state.ratings[q.id] }))
}
