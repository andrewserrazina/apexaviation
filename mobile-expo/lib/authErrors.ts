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
  status?: number
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

// signUp()'s documented error for an email that's already registered --
// the same "account already exists" fact the web portal's own
// create-free-account Edge Function already tells a visitor directly
// (site/portal-login.html: "An account with this email already exists.
// Try signing in instead."), so surfacing it here too is matching an
// established product convention, not a new enumeration risk this
// codebase didn't already accept. Distinct from the OTHER way Supabase
// signals this (an empty `identities` array on a successful, error-less
// response) -- checked separately in AuthContext.signUp, since that case
// has no error object for this function to inspect at all.
const EXISTING_ACCOUNT_CODES = new Set(['user_already_exists'])
const EXISTING_ACCOUNT_MESSAGE = /already registered/i

export function isExistingAccountError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as AuthApiErrorLike
  if (err.code && EXISTING_ACCOUNT_CODES.has(err.code)) return true
  return typeof err.message === 'string' && EXISTING_ACCOUNT_MESSAGE.test(err.message)
}

// GoTrue's rate limit response (HTTP 429, e.g. "For security purposes,
// you can only request this after 42 seconds.") for resend()/
// resetPasswordForEmail() -- surfaced as a distinct, friendly "please
// wait" message rather than either a raw passthrough or the generic
// network-failure copy, since neither is accurate here.
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as AuthApiErrorLike
  return err.status === 429
}
