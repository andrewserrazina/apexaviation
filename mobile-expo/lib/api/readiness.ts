// Typed client for mobile-readiness. `latest` (default) never
// recomputes; `refresh` recomputes via compute_readiness_snapshot().
// Readiness is a TRAINING-READINESS INDICATOR, never a pass-probability
// estimate -- every consumer of MobileReadinessSummary must render
// evidence_level and reason_codes alongside overall_score, never
// overall_score alone, and must never phrase any of it as "chance of
// passing." See components/ReadinessCard.tsx for the one place this is
// actually rendered.
import type { MobileReadinessResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isPlainObject, isValidReadinessSummaryOrNull } from './validate'

function validateReadinessResponse(data: unknown, context: string): MobileReadinessResponse {
  assertShape(isPlainObject(data) && typeof data.refreshed === 'boolean', context, data)
  // Shares its shape check with mobile-bootstrap's progress.
  // readiness_summary via isValidReadinessSummaryOrNull -- both are
  // rendered by the same ReadinessCard component and must satisfy the
  // exact same invariants: null, or overall_score/evidence_level/
  // reason_codes usable (evidence_level one of low/moderate/high,
  // reason_codes an array of strings).
  assertShape(isValidReadinessSummaryOrNull((data as { snapshot: unknown }).snapshot), context, data)
  return data as MobileReadinessResponse
}

export async function fetchLatestReadiness(): Promise<MobileReadinessResponse> {
  const data = await invokeMobileFunction<MobileReadinessResponse, { action: 'latest' }>('mobile-readiness', { action: 'latest' })
  return validateReadinessResponse(data, 'fetchLatestReadiness')
}

export async function refreshReadiness(): Promise<MobileReadinessResponse> {
  const data = await invokeMobileFunction<MobileReadinessResponse, { action: 'refresh' }>('mobile-readiness', { action: 'refresh' })
  return validateReadinessResponse(data, 'refreshReadiness')
}
