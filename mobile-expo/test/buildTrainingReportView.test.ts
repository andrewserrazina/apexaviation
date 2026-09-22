// Phase 5 (Training Report mobile): pure-function tests for the report
// composer. Covers section presence/absence (empty-hiding), the
// Strongest/Reinforcement/Insufficient bucketing port, the simplified
// recommended-action heuristic, and the 30-day AI DPE recency gate.
import { buildTrainingReportView } from '../lib/buildTrainingReportView'
import type { MobileReadinessSummary, MobileTrainingReportAggregates, ReadinessCategoryBreakdown } from '../../shared/mobile-dto'

function category(overrides: Partial<ReadinessCategoryBreakdown> = {}): ReadinessCategoryBreakdown {
  return {
    category: 'weather',
    label: 'Weather',
    score: 80,
    evidence_level: 'strong',
    attempt_volume: 12,
    task_breadth_pct: 100,
    assessable_task_count: 3,
    evidenced_task_count: 3,
    weak_task_count: 0,
    strong_task_count: 3,
    last_demonstrated_at: '2026-09-01T00:00:00Z',
    ai_dpe_reason_code: null,
    ...overrides,
  }
}

function readiness(overrides: Partial<MobileReadinessSummary> = {}): MobileReadinessSummary {
  return {
    overall_score: 75,
    coverage_score: 70,
    knowledge_score: 80,
    risk_management_score: 70,
    confidence_score: 60,
    evidence_level: 'moderate',
    weak_tasks: [],
    reason_codes: [],
    category_breakdown: [category()],
    algorithm_version: 'v3',
    computed_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function aggregates(overrides: Partial<MobileTrainingReportAggregates> = {}): MobileTrainingReportAggregates {
  return {
    ground_school: [],
    review_queue_due_count: 0,
    review_queue_due_categories: [],
    review_queue_completed_count: 0,
    ai_dpe_recent_session: null,
    ...overrides,
  }
}

function groundSchoolModule(overrides: Record<string, unknown> = {}) {
  return {
    module_id: 'PPL-M01',
    has_activity: false,
    last_activity_at: null,
    confidence_counts: { confident: 0, needs_review: 0, not_yet: 0 },
    ...overrides,
  }
}

describe('buildTrainingReportView', () => {
  it('returns null when either input is missing', () => {
    expect(buildTrainingReportView(null, aggregates())).toBeNull()
    expect(buildTrainingReportView(readiness(), null)).toBeNull()
    expect(buildTrainingReportView(null, null)).toBeNull()
  })

  it('surfaces overall score and evidence label from the snapshot', () => {
    const view = buildTrainingReportView(readiness({ overall_score: 62, evidence_level: 'high' }), aggregates())
    expect(view?.overallScore).toBe(62)
    expect(view?.evidenceLabel).toBe('Strong evidence')
  })

  describe('bucketing (strongest / reinforcement / insufficient)', () => {
    it('places a high-score, sufficient-evidence category in Strongest', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 88, evidence_level: 'strong' })] }),
        aggregates()
      )
      expect(view?.strongest).toHaveLength(1)
      expect(view?.reinforcement).toHaveLength(0)
      expect(view?.insufficient).toHaveLength(0)
    })

    it('a limited-evidence category with a high score and no negative signal lands in Insufficient, never Strongest', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 92, evidence_level: 'limited' })] }),
        aggregates()
      )
      expect(view?.strongest).toHaveLength(0)
      expect(view?.insufficient).toHaveLength(1)
    })

    it('a category with score < 60 lands in Reinforcement regardless of evidence level', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 45, evidence_level: 'strong' })] }),
        aggregates()
      )
      expect(view?.reinforcement).toHaveLength(1)
      expect(view?.strongest).toHaveLength(0)
    })

    it('a category with weak_task_count > 0 lands in Reinforcement even with a high score', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 85, weak_task_count: 1 })] }),
        aggregates()
      )
      expect(view?.reinforcement).toHaveLength(1)
    })

    it('a category with a due Review Queue item lands in Reinforcement even with a high score and zero weak tasks', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ category: 'airspace', score: 90, weak_task_count: 0 })] }),
        aggregates({ review_queue_due_categories: ['airspace'] })
      )
      expect(view?.reinforcement).toHaveLength(1)
    })

    it('a null-score category (no evidence at all) lands in Insufficient, never Reinforcement', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: null, evidence_level: 'none' })] }),
        aggregates()
      )
      expect(view?.insufficient).toHaveLength(1)
      expect(view?.reinforcement).toHaveLength(0)
    })

    it('a solid-but-unremarkable category (sufficient evidence, developing score, no negative signal) lands in none of the three buckets', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 70, evidence_level: 'developing' })] }),
        aggregates()
      )
      expect(view?.strongest).toHaveLength(0)
      expect(view?.reinforcement).toHaveLength(0)
      expect(view?.insufficient).toHaveLength(0)
    })

    it('caps Strongest at 3, sorted by evidence rank then score', () => {
      const cats = [
        category({ category: 'a', label: 'A', score: 81, evidence_level: 'developing' }),
        category({ category: 'b', label: 'B', score: 95, evidence_level: 'strong' }),
        category({ category: 'c', label: 'C', score: 82, evidence_level: 'strong' }),
        category({ category: 'd', label: 'D', score: 99, evidence_level: 'developing' }),
      ]
      const view = buildTrainingReportView(readiness({ category_breakdown: cats }), aggregates())
      expect(view?.strongest).toHaveLength(3)
      // Evidence rank first (strong beats developing), score desc within
      // the same rank: b/c both 'strong' (95 > 82), d/a both 'developing'
      // (99 > 81) -- d ranks ahead of a even though a is earlier in the
      // input array, and a is excluded entirely by the length-3 cap.
      expect(view?.strongest.map((c) => c.category)).toEqual(['b', 'c', 'd'])
    })
  })

  describe('recommended action', () => {
    it('is null when there are no categories', () => {
      const view = buildTrainingReportView(readiness({ category_breakdown: [] }), aggregates())
      expect(view?.recommendedAction).toBeNull()
    })

    it('routes to the Review Queue when the weakest category has a due item', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ category: 'weather', score: 40 }), category({ category: 'airspace', score: 90 })] }),
        aggregates({ review_queue_due_categories: ['weather'] })
      )
      expect(view?.recommendedAction?.cta).toBe('review_queue')
      expect(view?.recommendedAction?.categoryLabel).toBe('Weather')
    })

    it('routes to AI DPE when the weakest category has no due review item', () => {
      const view = buildTrainingReportView(readiness({ category_breakdown: [category({ category: 'weather', score: 40 })] }), aggregates())
      expect(view?.recommendedAction?.cta).toBe('ai_dpe')
    })

    it('treats a null score as the worst score (sorts first)', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ category: 'strong-one', score: 90 }), category({ category: 'no-evidence', score: null })] }),
        aggregates()
      )
      expect(view?.recommendedAction?.categoryLabel).toBe('Weather')
    })
  })

  describe('evidence summary', () => {
    it('sums assessable/evidenced task counts across every category', () => {
      const view = buildTrainingReportView(
        readiness({
          category_breakdown: [
            category({ category: 'a', assessable_task_count: 5, evidenced_task_count: 2 }),
            category({ category: 'b', assessable_task_count: 4, evidenced_task_count: 4 }),
          ],
        }),
        aggregates({ review_queue_completed_count: 7 })
      )
      expect(view?.evidenceSummary).toEqual({ evidencedTaskCount: 6, assessableTaskCount: 9, reviewsCompletedCount: 7 })
    })
  })

  describe('ground school summary', () => {
    it('counts active modules, sums confidence tallies, and finds the most recent module by activity timestamp', () => {
      const view = buildTrainingReportView(
        readiness(),
        aggregates({
          ground_school: [
            groundSchoolModule({ module_id: 'PPL-M01', has_activity: true, last_activity_at: '2026-08-01T00:00:00Z', confidence_counts: { confident: 2, needs_review: 1, not_yet: 0 } }),
            groundSchoolModule({ module_id: 'PPL-M02', has_activity: true, last_activity_at: '2026-09-01T00:00:00Z', confidence_counts: { confident: 1, needs_review: 0, not_yet: 1 } }),
            groundSchoolModule({ module_id: 'PPL-M03', has_activity: false }),
          ],
        })
      )
      expect(view?.groundSchool.activeModuleCount).toBe(2)
      expect(view?.groundSchool.totalModuleCount).toBe(3)
      expect(view?.groundSchool.confidentCount).toBe(3)
      expect(view?.groundSchool.needsReviewCount).toBe(2)
      expect(view?.groundSchool.mostRecentModuleLabel).toBe('Module 02 · Aerodynamics')
      expect(view?.groundSchool.mostRecentModuleAt).toBe('2026-09-01T00:00:00Z')
    })

    it('has a null most-recent-module label when nothing has activity', () => {
      const view = buildTrainingReportView(readiness(), aggregates({ ground_school: [groundSchoolModule()] }))
      expect(view?.groundSchool.mostRecentModuleLabel).toBeNull()
      expect(view?.groundSchool.mostRecentModuleAt).toBeNull()
    })
  })

  describe('AI Oral Practice recency gate', () => {
    const baseSession = { id: 's1', status: 'completed' as const, questionsAsked: 5, debrief: null, startedAt: '2026-09-01T00:00:00Z' }

    it('is null when there is no recent session', () => {
      const view = buildTrainingReportView(readiness(), aggregates({ ai_dpe_recent_session: null }))
      expect(view?.aiOralPractice).toBeNull()
    })

    it('is null when the most recent session is older than 30 days', () => {
      const view = buildTrainingReportView(
        readiness(),
        aggregates({ ai_dpe_recent_session: { ...baseSession, endedAt: '2026-01-01T00:00:00Z' } })
      )
      expect(view?.aiOralPractice).toBeNull()
    })

    it('is null when the session is in progress (no endedAt yet)', () => {
      const view = buildTrainingReportView(
        readiness(),
        aggregates({ ai_dpe_recent_session: { ...baseSession, status: 'in_progress', endedAt: null } })
      )
      expect(view?.aiOralPractice).toBeNull()
    })

    it('surfaces a session completed within 30 days, with weak-flagged category labels', () => {
      const recentIso = new Date(Date.now() - 5 * 86400000).toISOString()
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ category: 'weather', ai_dpe_reason_code: 'recent_ai_dpe_weak' })] }),
        aggregates({ ai_dpe_recent_session: { ...baseSession, endedAt: recentIso } })
      )
      expect(view?.aiOralPractice?.mostRecentEndedAt).toBe(recentIso)
      expect(view?.aiOralPractice?.weakCategoryLabels).toEqual(['Weather'])
    })
  })

  describe('areas to address', () => {
    it('lists due Review Queue count first, then reinforcement categories, then one incomplete module', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ category: 'weather', score: 40 })] }),
        aggregates({
          review_queue_due_count: 3,
          ground_school: [groundSchoolModule({ module_id: 'PPL-M01', has_activity: false })],
        })
      )
      expect(view?.areasToAddress.map((r) => r.action.type)).toEqual(['review_queue', 'ai_dpe', 'ground_school'])
      expect(view?.areasToAddress[0].text).toBe('3 Review Queue items due')
    })

    it('is empty when nothing needs attention', () => {
      const view = buildTrainingReportView(
        readiness({ category_breakdown: [category({ score: 85, evidence_level: 'developing' })] }),
        aggregates({ ground_school: [groundSchoolModule({ has_activity: true })] })
      )
      expect(view?.areasToAddress).toEqual([])
    })
  })
})
