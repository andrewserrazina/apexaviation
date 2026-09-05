// Typed client for mobile-daily-drill -- the ONLY Daily Drill
// session-creation path (v118). Fetching (default action) gets or
// generates today's drill; `start` atomically creates-or-resumes the ONE
// linked mobile-practice session for that drill's own question_ids.
//
// Do NOT call mobile-practice's `start` action for a Daily Drill -- that
// creates an independent ad-hoc session with its own randomly-selected
// questions, not the drill's curated set. See practice.ts for that
// separate, intentionally-independent ad-hoc practice path.
import type { MobileDailyDrillResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'

export function fetchDailyDrill(): Promise<MobileDailyDrillResponse> {
  return invokeMobileFunction<MobileDailyDrillResponse>('mobile-daily-drill')
}

export function startDailyDrill(drillId: string): Promise<MobileDailyDrillResponse> {
  return invokeMobileFunction<MobileDailyDrillResponse, { action: 'start'; drill_id: string }>('mobile-daily-drill', {
    action: 'start',
    drill_id: drillId,
  })
}
