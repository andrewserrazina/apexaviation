// Phase 5 (Training Report mobile): the pure, client-side composer that
// turns two already-fetched wire payloads into everything the report
// screen renders. Deliberately NOT a port of computeTrainingPlan() (a
// separate, nontrivial ranking engine reused elsewhere on web) -- see
// buildRecommendedAction() below for the documented simplification this
// takes instead. Section-bucketing logic (buildBuckets()) IS a faithful
// port of web's trainingReportPerformanceLabel()/
// bucketTrainingReportCategories() (site/portal-stable.js), with one
// adaptation: web checks an exact per-category due-review COUNT > 0,
// mobile's aggregate only exposes which categories have ANY due item
// (review_queue_due_categories) -- functionally identical, since web's
// own check only ever tested for a nonzero count in the first place.
//
// mobile-readiness's 'latest' action already filters to the current
// algorithm version server-side (returning `snapshot: null` otherwise --
// see mobile-readiness/index.ts's own CURRENT_READINESS_ALGORITHM_VERSION
// comment), so this composer never needs its own version gate or legacy
// fallback the way web's renderTrainingReport() orchestrator does.
import type { MobileReadinessSummary, MobileTrainingReportAggregates, ReadinessCategoryBreakdown } from '../../shared/mobile-dto'
import { groundSchoolModuleDef } from '../constants/groundSchool'

const EVIDENCE_LABEL: Record<MobileReadinessSummary['evidence_level'], string> = {
  low: 'Limited evidence yet',
  moderate: 'Building evidence',
  high: 'Strong evidence',
}

export const EVIDENCE_SUFFICIENCY_LABEL: Record<ReadinessCategoryBreakdown['evidence_level'], string> = {
  none: 'Insufficient Evidence',
  limited: 'Limited Evidence',
  developing: 'Developing',
  strong: 'Strong Evidence',
}

export interface TrainingReportRecommendedAction {
  categoryLabel: string
  whyText: string
  ctaLabel: string
  cta: 'ai_dpe' | 'review_queue'
}

export interface TrainingReportGroundSchoolSummary {
  activeModuleCount: number
  totalModuleCount: number
  confidentCount: number
  needsReviewCount: number
  mostRecentModuleLabel: string | null
  mostRecentModuleAt: string | null
}

export interface TrainingReportReviewQueueSummary {
  dueCount: number
  dueCategoryLabels: string[]
}

export interface TrainingReportAiOralPractice {
  mostRecentEndedAt: string
  weakCategoryLabels: string[]
}

export interface TrainingReportAddressRow {
  text: string
  action: { type: 'review_queue' } | { type: 'ai_dpe' } | { type: 'ground_school'; moduleId: string }
}

export interface TrainingReportView {
  overallScore: number | null
  evidenceLabel: string
  recommendedAction: TrainingReportRecommendedAction | null
  strongest: ReadinessCategoryBreakdown[]
  reinforcement: ReadinessCategoryBreakdown[]
  insufficient: ReadinessCategoryBreakdown[]
  evidenceSummary: { evidencedTaskCount: number; assessableTaskCount: number; reviewsCompletedCount: number }
  groundSchool: TrainingReportGroundSchoolSummary
  reviewQueue: TrainingReportReviewQueueSummary
  aiOralPractice: TrainingReportAiOralPractice | null
  areasToAddress: TrainingReportAddressRow[]
}

const AI_DPE_RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function performanceLabel(cat: ReadinessCategoryBreakdown, dueCategories: Set<string>): 'strong' | 'developing' | 'needs_reinforcement' | null {
  if (cat.score === null) return null
  if (cat.score < 60 || cat.weak_task_count > 0 || dueCategories.has(cat.category)) return 'needs_reinforcement'
  if (cat.score >= 80) return 'strong'
  return 'developing'
}

const EVIDENCE_RANK: Record<ReadinessCategoryBreakdown['evidence_level'], number> = { none: 0, limited: 1, developing: 2, strong: 3 }

// Faithful port of web's bucketTrainingReportCategories() -- a category
// lands in at most one bucket, and "solid but unremarkable" (sufficient
// evidence, no negative signal, not top-2-3) intentionally lands in
// none of them, so every section stays short by design rather than
// force-listing every category.
function buildBuckets(categories: ReadinessCategoryBreakdown[], dueCategories: Set<string>) {
  const strongest: ReadinessCategoryBreakdown[] = []
  const reinforcement: ReadinessCategoryBreakdown[] = []
  const insufficient: ReadinessCategoryBreakdown[] = []

  categories.forEach((cat) => {
    const perf = performanceLabel(cat, dueCategories)
    if (perf === 'needs_reinforcement') {
      reinforcement.push(cat)
    } else if (perf === 'strong' && (cat.evidence_level === 'developing' || cat.evidence_level === 'strong')) {
      strongest.push(cat)
    } else if (cat.evidence_level === 'none' || cat.evidence_level === 'limited') {
      insufficient.push(cat)
    }
  })

  strongest.sort((a, b) => {
    const rankDiff = EVIDENCE_RANK[b.evidence_level] - EVIDENCE_RANK[a.evidence_level]
    return rankDiff !== 0 ? rankDiff : (b.score ?? 0) - (a.score ?? 0)
  })
  reinforcement.sort((a, b) => (a.score === null ? -1 : a.score) - (b.score === null ? -1 : b.score))

  return { strongest: strongest.slice(0, 3), reinforcement, insufficient }
}

// Scope decision (see the roadmap plan): does NOT port computeTrainingPlan().
// Instead derives a single CTA from the weakest category_breakdown entry
// already on the wire -- the lowest score (nulls sort first, treated as
// worst) -- routed into whichever of Phase 1 (AI DPE) or Phase 2 (Review
// Queue) actually has due content for that category. A documented
// simplification versus web's exact recommendation engine.
function buildRecommendedAction(categories: ReadinessCategoryBreakdown[], dueCategories: Set<string>): TrainingReportRecommendedAction | null {
  if (!categories.length) return null
  const weakest = [...categories].sort((a, b) => (a.score ?? -1) - (b.score ?? -1))[0]
  const hasDueReview = dueCategories.has(weakest.category)
  return {
    categoryLabel: weakest.label,
    whyText: hasDueReview
      ? `${weakest.label} has review items waiting -- clearing those reinforces this area fastest.`
      : `${weakest.label} is your lowest-evidence area right now -- an AI oral practice session is the quickest way to build more.`,
    ctaLabel: hasDueReview ? 'Open Review Queue' : 'Start AI Oral Practice',
    cta: hasDueReview ? 'review_queue' : 'ai_dpe',
  }
}

function buildGroundSchoolSummary(aggregates: MobileTrainingReportAggregates): TrainingReportGroundSchoolSummary {
  let confidentCount = 0
  let needsReviewCount = 0
  let mostRecentModuleId: string | null = null
  let mostRecentModuleAt: string | null = null
  let activeModuleCount = 0

  aggregates.ground_school.forEach((m) => {
    if (m.has_activity) activeModuleCount++
    confidentCount += m.confidence_counts.confident
    needsReviewCount += m.confidence_counts.needs_review + m.confidence_counts.not_yet
    if (m.last_activity_at && (!mostRecentModuleAt || new Date(m.last_activity_at) > new Date(mostRecentModuleAt))) {
      mostRecentModuleAt = m.last_activity_at
      mostRecentModuleId = m.module_id
    }
  })

  const moduleDef = mostRecentModuleId ? groundSchoolModuleDef(mostRecentModuleId) : null

  return {
    activeModuleCount,
    totalModuleCount: aggregates.ground_school.length,
    confidentCount,
    needsReviewCount,
    mostRecentModuleLabel: moduleDef?.moduleLabel ?? null,
    mostRecentModuleAt,
  }
}

function buildAreasToAddress(
  reinforcement: ReadinessCategoryBreakdown[],
  reviewQueue: TrainingReportReviewQueueSummary,
  aggregates: MobileTrainingReportAggregates
): TrainingReportAddressRow[] {
  const rows: TrainingReportAddressRow[] = []

  if (reviewQueue.dueCount > 0) {
    rows.push({
      text: `${reviewQueue.dueCount} Review Queue item${reviewQueue.dueCount === 1 ? '' : 's'} due`,
      action: { type: 'review_queue' },
    })
  }

  reinforcement.forEach((cat) => {
    rows.push({ text: `${cat.label} needs reinforcement`, action: { type: 'ai_dpe' } })
  })

  const incompleteModule = aggregates.ground_school.find((m) => !m.has_activity)
  if (incompleteModule) {
    const moduleDef = groundSchoolModuleDef(incompleteModule.module_id)
    if (moduleDef) {
      rows.push({ text: `Continue ${moduleDef.moduleLabel}`, action: { type: 'ground_school', moduleId: incompleteModule.module_id } })
    }
  }

  return rows
}

export function buildTrainingReportView(
  readiness: MobileReadinessSummary | null,
  aggregates: MobileTrainingReportAggregates | null
): TrainingReportView | null {
  if (!readiness || !aggregates) return null

  const categories = readiness.category_breakdown ?? []
  const dueCategories = new Set(aggregates.review_queue_due_categories)
  const { strongest, reinforcement, insufficient } = buildBuckets(categories, dueCategories)

  let totalAssessable = 0
  let totalEvidenced = 0
  categories.forEach((c) => {
    totalAssessable += c.assessable_task_count ?? 0
    totalEvidenced += c.evidenced_task_count ?? 0
  })

  const reviewQueue: TrainingReportReviewQueueSummary = {
    dueCount: aggregates.review_queue_due_count,
    dueCategoryLabels: categories.filter((c) => dueCategories.has(c.category)).map((c) => c.label),
  }

  const aiDpe = aggregates.ai_dpe_recent_session
  const aiDpeRecent =
    aiDpe && aiDpe.status === 'completed' && aiDpe.endedAt && Date.now() - new Date(aiDpe.endedAt).getTime() <= AI_DPE_RECENCY_WINDOW_MS
      ? aiDpe
      : null
  const aiOralPractice: TrainingReportAiOralPractice | null = aiDpeRecent
    ? {
        mostRecentEndedAt: aiDpeRecent.endedAt as string,
        weakCategoryLabels: categories.filter((c) => c.ai_dpe_reason_code === 'recent_ai_dpe_weak').map((c) => c.label),
      }
    : null

  return {
    overallScore: readiness.overall_score,
    evidenceLabel: EVIDENCE_LABEL[readiness.evidence_level],
    recommendedAction: buildRecommendedAction(categories, dueCategories),
    strongest,
    reinforcement,
    insufficient,
    evidenceSummary: {
      evidencedTaskCount: totalEvidenced,
      assessableTaskCount: totalAssessable,
      reviewsCompletedCount: aggregates.review_queue_completed_count,
    },
    groundSchool: buildGroundSchoolSummary(aggregates),
    reviewQueue,
    aiOralPractice,
    areasToAddress: buildAreasToAddress(reinforcement, reviewQueue, aggregates),
  }
}
