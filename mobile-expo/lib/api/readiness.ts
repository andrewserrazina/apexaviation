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

export function fetchLatestReadiness(): Promise<MobileReadinessResponse> {
  return invokeMobileFunction<MobileReadinessResponse, { action: 'latest' }>('mobile-readiness', { action: 'latest' })
}

export function refreshReadiness(): Promise<MobileReadinessResponse> {
  return invokeMobileFunction<MobileReadinessResponse, { action: 'refresh' }>('mobile-readiness', { action: 'refresh' })
}
