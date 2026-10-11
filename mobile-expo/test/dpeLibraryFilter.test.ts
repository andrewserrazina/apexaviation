// Mobile parity (Phase 5, item 1): DPE Question Library search/filter
// logic, ported from web's renderDpeLibrary() filtering. Real executions
// of the pure function, not a source scan.
import { filterDpeLibrary } from '../lib/dpeLibraryFilter'
import type { MobileDpeCategory, MobileDpeQuestion, MobileDpeQuestionProgress } from '../../shared/mobile-dto'

function category(overrides: Partial<MobileDpeCategory> = {}): MobileDpeCategory {
  return { id: 'weather', label: 'Weather', section_label: null, sort_order: 1, ...overrides }
}

function question(overrides: Partial<MobileDpeQuestion> = {}): MobileDpeQuestion {
  return {
    id: 'q1',
    category: 'weather',
    question: 'What is a METAR?',
    model_answer: 'A routine aviation weather report.',
    common_mistakes: null,
    dpe_evaluating: null,
    real_world_application: null,
    acs_reference: 'PA.I.C.K1',
    is_scenario: false,
    scenario_order: null,
    sort_order: 1,
    ...overrides,
  }
}

describe('filterDpeLibrary', () => {
  const categories = [category(), category({ id: 'airspace', label: 'Airspace', sort_order: 2 })]
  const questions = [
    question(),
    question({ id: 'q2', category: 'weather', question: 'What is a TAF?', acs_reference: 'PA.I.C.K2' }),
    question({ id: 'q3', category: 'airspace', question: 'What is Class B airspace?', acs_reference: 'PA.I.B.K1' }),
  ]

  it('groups by category in category sort_order, dropping categories with no matching questions', () => {
    const groups = filterDpeLibrary(categories, questions, {}, 'all', '')
    expect(groups.map((g) => g.category.id)).toEqual(['weather', 'airspace'])
    expect(groups[0].questions.map((q) => q.id)).toEqual(['q1', 'q2'])
    expect(groups[1].questions.map((q) => q.id)).toEqual(['q3'])
  })

  it('filters to a single category id', () => {
    const groups = filterDpeLibrary(categories, questions, {}, 'airspace', '')
    expect(groups.map((g) => g.category.id)).toEqual(['airspace'])
  })

  it('filters to favorites only', () => {
    const progress: Record<string, MobileDpeQuestionProgress> = {
      q2: { favorited: true, completed: false, last_viewed_at: null },
    }
    const groups = filterDpeLibrary(categories, questions, progress, 'favorites', '')
    expect(groups).toHaveLength(1)
    expect(groups[0].questions.map((q) => q.id)).toEqual(['q2'])
  })

  it('searches across the question text, acs reference, and answer fields, case-insensitively', () => {
    const bySearch = filterDpeLibrary(categories, questions, {}, 'all', 'taf')
    expect(bySearch.flatMap((g) => g.questions.map((q) => q.id))).toEqual(['q2'])

    const byAcs = filterDpeLibrary(categories, questions, {}, 'all', 'pa.i.c.k1')
    expect(byAcs.flatMap((g) => g.questions.map((q) => q.id))).toEqual(['q1'])
  })

  it('combines a category filter with a search term', () => {
    const groups = filterDpeLibrary(categories, questions, {}, 'weather', 'class b')
    expect(groups).toHaveLength(0)
  })

  it('returns no groups when nothing matches', () => {
    expect(filterDpeLibrary(categories, questions, {}, 'all', 'nonexistent term')).toEqual([])
  })
})
