// Sprint 1C Rev2 (independent review): pure, dependency-free validation
// for update_preferences' request body, extracted out of index.ts
// specifically so it can be unit-tested directly under plain Node (no
// Deno runtime available in this sandbox) -- see
// test/mobile_push_token_validatePreferencesUpdate.test.mjs. This file
// has zero imports on purpose; do not add any.
//
// Mirrors notification_preferences' (v116) own column names/shapes
// exactly -- no new field, no renamed field, no invented default.
// Distinguishes "field omitted from the request body" (skip it -- an
// existing row's value is left untouched, a new row picks up the
// table's own column default) from "field explicitly supplied but
// invalid, including explicit null" (must be rejected with a clean 400,
// NEVER silently dropped or coerced). Any key on the body that isn't one
// of these five allowed fields is simply never read, so it can never be
// persisted.

const BOOLEAN_FIELDS = ['daily_drill_enabled', 'checkride_countdown_enabled', 'weak_area_enabled', 'streak_enabled'] as const

// Matches the table's own default format ('07:00:00') and the plain
// 'HH:MM' shape a client might reasonably send -- both are valid
// Postgres `time` literals. Requires two-digit hour/minute (no "7:00")
// and a valid 24-hour range, so a malformed value can never reach
// Postgres as a raw string for it to reject less predictably.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export type PreferencesUpdateField = (typeof BOOLEAN_FIELDS)[number] | 'daily_drill_time'

export type PreferencesUpdateValidation =
  | { ok: true; update: Partial<Record<PreferencesUpdateField, boolean | string>> }
  | { ok: false; error: string }

export function validatePreferencesUpdate(body: unknown): PreferencesUpdateValidation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request body' }
  }
  const b = body as Record<string, unknown>
  const update: Partial<Record<PreferencesUpdateField, boolean | string>> = {}

  for (const field of BOOLEAN_FIELDS) {
    if (b[field] === undefined) continue
    if (typeof b[field] !== 'boolean') {
      return { ok: false, error: `${field} must be a boolean` }
    }
    update[field] = b[field] as boolean
  }

  if (b.daily_drill_time !== undefined) {
    const value = b.daily_drill_time
    if (typeof value !== 'string' || !TIME_RE.test(value)) {
      return { ok: false, error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)' }
    }
    update.daily_drill_time = value
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'No preference fields provided' }
  }

  return { ok: true, update }
}
