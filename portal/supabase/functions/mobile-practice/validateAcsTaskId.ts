// Rev2 (independent review, Blocker 3): pure, dependency-free validation
// for the optional `acs_task_id` request field on mobile-practice's
// `start` action, extracted out of index.ts specifically so it can be
// unit-tested directly under plain Node (no Deno runtime available in
// this sandbox) -- see test/v119_validateAcsTaskId.test.mjs. This file
// has zero imports on purpose; do not add any.
//
// Distinguishes "field omitted from the request body" (valid -- general
// practice) from "field explicitly supplied but invalid" (must be
// rejected with a clean 400, NEVER silently treated as general
// practice). JSON.parse never produces `undefined` values, so
// `raw === undefined` reliably means the key was omitted.

const ACS_TASK_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AcsTaskIdValidation = { ok: true; acsTaskId: string | null } | { ok: false }

export function validateAcsTaskId(raw: unknown): AcsTaskIdValidation {
  if (raw === undefined) return { ok: true, acsTaskId: null }
  if (typeof raw !== 'string') return { ok: false }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false }
  if (!ACS_TASK_ID_UUID_RE.test(trimmed)) return { ok: false }
  return { ok: true, acsTaskId: trimmed }
}
