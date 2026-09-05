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
import { assertShape, isPlainObject } from './validate'

function validateReadinessResponse(data: unknown, context: string): MobileReadinessResponse {
  assertShape(isPlainObject(data) && typeof data.refreshed === 'boolean', context, data)
  const snapshot = (data as { snapshot: unknown }).snapshot
  // ReadinessCard renders overall_score/evidence_level/reason_codes --
  // snapshot is either null (the intentional "no readiness yet" case) or
  // must carry all three in a usable shape.
  assertShape(
    snapshot === null ||
      (isPlainObject(snapshot) &&
        typeof snapshot.overall_score === 'number' &&
        typeof snapshot.evidence_level === 'string' &&
        Array.isArray(snapshot.reason_codes)),
    context,
    data
  )
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
