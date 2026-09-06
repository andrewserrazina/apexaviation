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
import { assertShape, isDrillStatus, isNonEmptyString, isPlainObject, isValidQuestion } from './validate'

// Sprint 1A Rev3 section 1: fetch and start have GENUINELY DIFFERENT
// session_id invariants -- conflating them (Rev2's mistake) rejected
// legitimate production data as malformed.
//
// The deployed mobile-daily-drill (both actions) returns
// `session_id: drill.practice_attempt_id ?? null`. For the DEFAULT
// (fetch-or-create) action, a null session_id is the NORMAL, expected
// shape for any drill that hasn't had `start` called on it yet --
// production presently contains real pending Daily Drill rows with a
// null practice_attempt_id. It's also legitimate for legacy in_progress
// data predating the v118 bridge, and for the deliberate
// completed-but-never-linked edge case (start_daily_drill_practice_
// session() never produces this today, but mobile-daily-drill's shape
// allows it). So `fetchDailyDrill` only ever checks the TYPE of
// session_id when present -- never that it's non-null for any status.
interface CommonDrillShape {
  drill: Record<string, unknown>
  session_id: unknown
  questions: unknown[]
}

function assertCommonDrillShape(data: unknown, context: string): CommonDrillShape {
  assertShape(isPlainObject(data) && isPlainObject(data.drill) && Array.isArray(data.questions), context, data)
  const shape = data as CommonDrillShape
  assertShape(isNonEmptyString(shape.drill.id) && isDrillStatus(shape.drill.status), context, data)
  assertShape(shape.questions.every(isValidQuestion), context, data)
  return shape
}

function validateFetchDailyDrillResponse(data: unknown, context: string): MobileDailyDrillResponse {
  const { session_id } = assertCommonDrillShape(data, context)
  // Present-or-absent, not required -- see the comment above.
  assertShape(session_id === null || isNonEmptyString(session_id), context, data)
  return data as unknown as MobileDailyDrillResponse
}

// start_daily_drill_practice_session() (v118) either (a) creates a new
// attempt and flips a pending drill to in_progress with a non-null
// session_id, (b) resumes an already-linked in_progress/completed drill
// (session_id non-null), or (c) returns a completed-but-never-linked
// drill as-is (session_id null, deliberate "nothing to start" response).
// The one invariant genuinely specific to `start`: an in_progress result
// must always carry a non-null session_id -- there is no code path in
// the deployed RPC that produces in_progress with a null session_id, so
// that combination is a real contract violation, not a legitimate edge
// case.
function validateStartDailyDrillResponse(data: unknown, context: string): MobileDailyDrillResponse {
  const { drill, session_id } = assertCommonDrillShape(data, context)
  if (drill.status === 'in_progress') {
    assertShape(isNonEmptyString(session_id), context, data)
  } else {
    assertShape(session_id === null || isNonEmptyString(session_id), context, data)
  }
  return data as unknown as MobileDailyDrillResponse
}

export async function fetchDailyDrill(): Promise<MobileDailyDrillResponse> {
  const data = await invokeMobileFunction<MobileDailyDrillResponse>('mobile-daily-drill')
  return validateFetchDailyDrillResponse(data, 'fetchDailyDrill')
}

export async function startDailyDrill(drillId: string): Promise<MobileDailyDrillResponse> {
  const data = await invokeMobileFunction<MobileDailyDrillResponse, { action: 'start'; drill_id: string }>('mobile-daily-drill', {
    action: 'start',
    drill_id: drillId,
  })
  return validateStartDailyDrillResponse(data, 'startDailyDrill')
}
