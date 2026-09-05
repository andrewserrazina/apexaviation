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
import { assertShape, isPlainObject } from './validate'

// Sprint 1A Rev2 section 9: the UI's own invariants -- a `drill` object
// with a string id/status, and a `questions` array are always required.
// A normal pending/in_progress drill additionally always has a non-null
// top-level session_id; the one deliberate exception is a completed
// legacy-shaped drill, which may intentionally have neither (see the
// DTO's own MobileDailyDrill.session_id comment) -- honoring that
// nullable case rather than treating it as malformed.
function validateDailyDrillResponse(data: unknown, context: string): MobileDailyDrillResponse {
  assertShape(isPlainObject(data) && isPlainObject(data.drill) && Array.isArray(data.questions), context, data)
  const drill = data as { drill: Record<string, unknown>; session_id: unknown }
  assertShape(typeof drill.drill.id === 'string' && typeof drill.drill.status === 'string', context, data)
  if (drill.drill.status === 'pending' || drill.drill.status === 'in_progress') {
    assertShape(typeof drill.session_id === 'string' && drill.session_id.length > 0, context, data)
  }
  return data as MobileDailyDrillResponse
}

export async function fetchDailyDrill(): Promise<MobileDailyDrillResponse> {
  const data = await invokeMobileFunction<MobileDailyDrillResponse>('mobile-daily-drill')
  return validateDailyDrillResponse(data, 'fetchDailyDrill')
}

export async function startDailyDrill(drillId: string): Promise<MobileDailyDrillResponse> {
  const data = await invokeMobileFunction<MobileDailyDrillResponse, { action: 'start'; drill_id: string }>('mobile-daily-drill', {
    action: 'start',
    drill_id: drillId,
  })
  return validateDailyDrillResponse(data, 'startDailyDrill')
}
