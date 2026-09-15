// Sprint 1C Phase 11: the ONE place a notification payload's `data` is
// turned into a navigation target. No caller of navigateToNotificationTarget
// ever receives or forwards an arbitrary router path from a payload --
// resolveNotificationTarget only ever returns one of the fixed literal
// pathnames below, keyed by an allowlisted `type`, with any identifier it
// carries (pack_id) validated against a strict shape first. An unknown
// type, a missing/malformed required field, or a non-object payload all
// resolve to `null`, and every caller of this module treats `null` as
// "do nothing" -- never a crash, never a fallback guess at intent.
//
// Targets deliberately mirror ONLY routes that actually exist today
// (app/(app)/practice/index.tsx, app/(app)/library/index.tsx,
// app/(app)/library/[packId].tsx) -- see those files, not this comment,
// as the source of truth if routes change.
import { router } from 'expo-router'

export type NotificationTarget =
  | { type: 'daily_drill' }
  | { type: 'practice' }
  | { type: 'library_pack'; packId: string }

// Deliberately conservative -- matches the real pack id shape
// (study_packs.id, e.g. "airspace_mastery") and nothing else. Rejects
// anything containing "/", "..", whitespace, or other characters that
// could otherwise be mistaken for a path segment.
const PACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function resolveNotificationTarget(data: unknown): NotificationTarget | null {
  if (!isPlainObject(data)) return null

  switch (data.type) {
    case 'daily_drill':
      return { type: 'daily_drill' }
    case 'practice':
      return { type: 'practice' }
    case 'library_pack': {
      const packId = data.pack_id
      if (typeof packId === 'string' && PACK_ID_PATTERN.test(packId)) {
        return { type: 'library_pack', packId }
      }
      return null
    }
    default:
      return null
  }
}

// Never called with a target resolveNotificationTarget didn't produce --
// every pathname here is a fixed string literal, never interpolated from
// payload data. library_pack carries ONLY the validated pack id -- Rev2
// removed `owned` from this contract entirely (it was never trustworthy
// coming from a push payload, and [packId].tsx no longer accepts it from
// route params at all: it resolves the pack's real owned/locked state
// itself from the authenticated mobile-library catalog, and the server's
// `content` action remains the final entitlement check regardless).
export function navigateToNotificationTarget(target: NotificationTarget): void {
  switch (target.type) {
    case 'daily_drill':
    case 'practice':
      router.push('/(app)/practice')
      break
    case 'library_pack':
      router.push({ pathname: '/(app)/library/[packId]', params: { packId: target.packId } })
      break
  }
}
