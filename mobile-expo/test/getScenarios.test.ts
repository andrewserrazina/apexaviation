// Mobile parity (Phase 5, item 2): getScenarios() ports web's
// SCENARIO_IDS/SCENARIOS construction (site/portal-stable.js) -- the
// is_scenario=true subset of the question bank, ordered by
// scenario_order. Real executions of the pure function.
import { getScenarios } from '../lib/dpeLibraryFilter'
import type { MobileDpeQuestion } from '../../shared/mobile-dto'

function question(overrides: Partial<MobileDpeQuestion> = {}): MobileDpeQuestion {
  return {
    id: 'q1',
    category: 'weather',
    question: 'What is a METAR?',
    model_answer: 'A routine aviation weather report.',
    common_mistakes: null,
    dpe_evaluating: null,
    real_world_application: null,
    acs_reference: null,
    sort_order: 1,
    is_scenario: false,
    scenario_order: null,
    ...overrides,
  }
}

describe('getScenarios', () => {
  it('excludes ordinary (non-scenario) questions', () => {
    const questions = [question({ id: 'q1', is_scenario: false }), question({ id: 'q2', is_scenario: true, scenario_order: 1 })]
    expect(getScenarios(questions).map((s) => s.id)).toEqual(['q2'])
  })

  it('orders scenarios by scenario_order, not by their position in the bank or sort_order', () => {
    const questions = [
      question({ id: 's-b', is_scenario: true, scenario_order: 2, sort_order: 1 }),
      question({ id: 's-a', is_scenario: true, scenario_order: 1, sort_order: 99 }),
      question({ id: 's-c', is_scenario: true, scenario_order: 3, sort_order: 2 }),
    ]
    expect(getScenarios(questions).map((s) => s.id)).toEqual(['s-a', 's-b', 's-c'])
  })

  it('returns an empty array when no question is flagged as a scenario', () => {
    expect(getScenarios([question({ is_scenario: false })])).toEqual([])
  })

  it('does not mutate the input array', () => {
    const questions = [question({ id: 's-b', is_scenario: true, scenario_order: 2 }), question({ id: 's-a', is_scenario: true, scenario_order: 1 })]
    const originalOrder = questions.map((q) => q.id)
    getScenarios(questions)
    expect(questions.map((q) => q.id)).toEqual(originalOrder)
  })
})
