// Pure search/filter logic for the DPE Question Library, extracted so it
// can be tested directly (see test/dpeLibraryFilter.test.ts) rather than
// through simulated TextInput typing -- this project's jest-expo/
// @testing-library/react-native setup does not commit state updates from
// fireEvent.changeText (see test/SignUpScreen.test.tsx's own comment).
// Mirrors web's renderDpeLibrary() filtering exactly (site/portal-
// stable.js): search over question + all four answer fields, 'all' vs.
// 'favorites' vs. a specific category id, grouped by category in
// category sort_order.
import type { MobileDpeCategory, MobileDpeQuestion, MobileDpeQuestionProgress } from '../../shared/mobile-dto'

export type DpeLibraryFilterTab = 'all' | 'favorites' | string

export interface DpeLibraryGroup {
  category: MobileDpeCategory
  questions: MobileDpeQuestion[]
}

function isFavorited(progress: Record<string, MobileDpeQuestionProgress>, questionId: string): boolean {
  return progress[questionId]?.favorited ?? false
}

function matchesSearch(question: MobileDpeQuestion, term: string): boolean {
  if (!term) return true
  const haystack = [
    question.question,
    question.model_answer,
    question.common_mistakes,
    question.dpe_evaluating,
    question.real_world_application,
    question.acs_reference,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
  return haystack.includes(term.toLowerCase())
}

// Mobile parity (Phase 5, item 2): Scenario Training is literally the
// is_scenario=true subset of this same question bank, ordered by
// scenario_order -- see web's SCENARIO_IDS/SCENARIOS construction in
// site/portal-stable.js. Not a second content system to keep in sync.
export function getScenarios(questions: MobileDpeQuestion[]): MobileDpeQuestion[] {
  return questions
    .filter((q) => q.is_scenario)
    .slice()
    .sort((a, b) => (a.scenario_order ?? 0) - (b.scenario_order ?? 0))
}

export function filterDpeLibrary(
  categories: MobileDpeCategory[],
  questions: MobileDpeQuestion[],
  progress: Record<string, MobileDpeQuestionProgress>,
  activeTab: DpeLibraryFilterTab,
  searchTerm: string
): DpeLibraryGroup[] {
  const term = searchTerm.trim()
  const byCategory = new Map<string, MobileDpeQuestion[]>()

  for (const question of questions) {
    if (activeTab === 'favorites' && !isFavorited(progress, question.id)) continue
    if (activeTab !== 'all' && activeTab !== 'favorites' && question.category !== activeTab) continue
    if (!matchesSearch(question, term)) continue
    const bucket = byCategory.get(question.category) ?? []
    bucket.push(question)
    byCategory.set(question.category, bucket)
  }

  return categories
    .filter((category) => byCategory.has(category.id))
    .map((category) => ({ category, questions: byCategory.get(category.id) ?? [] }))
}
