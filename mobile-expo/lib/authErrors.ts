// Apex Advantage mobile client -- stale persisted-session recovery.
//
// Ported from portal/src/lib/authErrors.js (Sprint 0 Phase 9B), matching
// its semantics EXACTLY -- this native app must recognize and recover
// from a dead refresh token the same way the web portal already does,
// per this Sprint's explicit "match the already reviewed Phase 9B
// semantics" requirement. Do not add new stale-token codes here without
// adding them to the web copy too, and vice versa -- these two files
// should never drift.
//
// Recognized via the public, documented AuthApiError shape (`.name` /
// `.code`) every @supabase/supabase-js auth call already returns.

export interface AuthApiErrorLike {
  name?: string
  code?: string
  message?: string
}

// Supabase Auth's documented error codes for a refresh token that can
// never succeed again: the token doesn't exist (already consumed by a
// prior refresh, revoked, or simply never existed) or has already been
// used once under refresh token rotation. Both mean the same thing to a
// client: stop retrying, sign this device out locally, and let the
// learner sign in again.
const STALE_REFRESH_TOKEN_CODES = new Set(['refresh_token_not_found', 'refresh_token_already_used'])

// Fallback for a response that reaches the client without a `code` (an
// older GoTrue version, or a proxy/gateway that drops non-standard JSON
// fields) but still carries the stable message text GoTrue has always
// returned for this exact condition.
const STALE_REFRESH_TOKEN_MESSAGE = /refresh token not found/i

export function isStaleRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as AuthApiErrorLike
  if (err.name !== 'AuthApiError') return false
  if (err.code && STALE_REFRESH_TOKEN_CODES.has(err.code)) return true
  return typeof err.message === 'string' && STALE_REFRESH_TOKEN_MESSAGE.test(err.message)
}
