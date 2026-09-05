// Apex Advantage Sprint 0 Phase 9B -- stale persisted-session recovery.
//
// Production Supabase Auth logs showed real refresh_token_not_found
// failures (a stale/invalid refresh token left over from a prior
// session -- long browser inactivity, a revoked/rotated token, etc.),
// each followed by the same browser successfully re-authenticating with
// a password. AuthContext's previous getSession() call ignored the
// `error` field entirely, so a stale token was never explicitly cleaned
// up client-side.
//
// This distinguishes a genuinely dead, unrecoverable refresh token from a
// generic/transient failure (a network hiccup, a momentary Auth outage)
// so callers only clear local session state for the former -- clearing it
// for the latter would destructively sign a user out just because the
// network was briefly unavailable, even though their stored session may
// still be perfectly valid.
//
// Recognized via the public, documented AuthApiError shape (`.name` /
// `.code`) that every @supabase/supabase-js auth call already returns --
// not via `isAuthApiError`/`AuthApiError` from `@supabase/auth-js`, which
// is a transitive dependency of @supabase/supabase-js and is not
// re-exported by the top-level package this app actually depends on.

// Supabase Auth's documented error codes for a refresh token that can
// never succeed again: the token doesn't exist (already consumed by a
// prior refresh, revoked, or simply never existed -- e.g. cleared server-
// side) or has already been used once under refresh token rotation.
// Both mean the same thing to a client: stop retrying, sign this device
// out locally, and let the user log in again.
const STALE_REFRESH_TOKEN_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
])

// Fallback for a response that reaches the client without a `code` (an
// older GoTrue version, or a proxy/gateway in front of Auth that drops
// non-standard JSON fields) but still carries the stable message text
// GoTrue has always returned for this exact condition.
const STALE_REFRESH_TOKEN_MESSAGE = /refresh token not found/i

export function isStaleRefreshTokenError(error) {
  if (!error || error.name !== 'AuthApiError') return false
  if (STALE_REFRESH_TOKEN_CODES.has(error.code)) return true
  return typeof error.message === 'string' && STALE_REFRESH_TOKEN_MESSAGE.test(error.message)
}
