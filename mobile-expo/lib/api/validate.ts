// Narrow runtime invariant checks for the mobile-* API responses Sprint
// 1A actually renders. TypeScript types don't validate runtime JSON --
// this is deliberately NOT a schema-validation library, just the minimum
// shape assertions the UI depends on, so a malformed 200 response can
// never crash a render or leave the client in a non-completable state
// (Sprint 1A Rev2 section 9). A failure here becomes the same normalized,
// user-safe ApiError every other failure mode produces -- the raw
// payload is only ever dev-logged.
import { ApiError, logDevError } from './errors'

const MALFORMED_RESPONSE_MESSAGE = 'Something went wrong loading that. Please try again.'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function assertShape(condition: boolean, context: string, raw: unknown): void {
  if (!condition) {
    logDevError(`${context}: malformed response shape`, raw)
    throw new ApiError({ kind: 'server', userMessage: MALFORMED_RESPONSE_MESSAGE, raw })
  }
}
