import { isStaleRefreshTokenError, isExistingAccountError, isRateLimitError, isPkceCodeVerifierMissingError } from '../lib/authErrors'

describe('isStaleRefreshTokenError', () => {
  // C: refresh_token_not_found is recognized as stale.
  it('recognizes refresh_token_not_found by code', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthApiError', code: 'refresh_token_not_found', message: 'Refresh Token Not Found' })).toBe(
      true
    )
  })

  // D: refresh_token_already_used is recognized as stale.
  it('recognizes refresh_token_already_used by code', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthApiError', code: 'refresh_token_already_used', message: 'Already Used' })).toBe(true)
  })

  it('falls back to message text when code is missing (older GoTrue / proxy)', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthApiError', message: 'Refresh Token Not Found' })).toBe(true)
  })

  // E: a transient/network error must never be treated as stale.
  it('does not treat a network error as stale', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthRetryableFetchError', message: 'Network request failed' })).toBe(false)
  })

  it('does not treat an unrelated AuthApiError as stale', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      false
    )
  })

  it('handles null/undefined/non-object input safely', () => {
    expect(isStaleRefreshTokenError(null)).toBe(false)
    expect(isStaleRefreshTokenError(undefined)).toBe(false)
    expect(isStaleRefreshTokenError('a string')).toBe(false)
  })
})

describe('isExistingAccountError', () => {
  it('recognizes user_already_exists by code', () => {
    expect(isExistingAccountError({ code: 'user_already_exists', message: 'User already registered' })).toBe(true)
  })

  it('falls back to message text when code is missing', () => {
    expect(isExistingAccountError({ message: 'User already registered' })).toBe(true)
  })

  it('does not treat an unrelated error as an existing-account error', () => {
    expect(isExistingAccountError({ code: 'weak_password', message: 'Password should be at least 6 characters.' })).toBe(false)
  })

  it('handles null/undefined/non-object input safely', () => {
    expect(isExistingAccountError(null)).toBe(false)
    expect(isExistingAccountError(undefined)).toBe(false)
    expect(isExistingAccountError('a string')).toBe(false)
  })
})

describe('isRateLimitError', () => {
  it('recognizes a 429 status', () => {
    expect(isRateLimitError({ status: 429, message: 'For security purposes, you can only request this after 42 seconds.' })).toBe(true)
  })

  it('does not treat a non-429 status as rate limiting', () => {
    expect(isRateLimitError({ status: 400, message: 'Bad request' })).toBe(false)
  })

  it('handles null/undefined/non-object input safely', () => {
    expect(isRateLimitError(null)).toBe(false)
    expect(isRateLimitError(undefined)).toBe(false)
    expect(isRateLimitError('a string')).toBe(false)
  })
})

// Verified against the installed @supabase/auth-js source
// (GoTrueClient.js / lib/errors.ts) -- see isPkceCodeVerifierMissingError's
// own comment in lib/authErrors.ts for the exact shape this is matching.
describe('isPkceCodeVerifierMissingError', () => {
  it('recognizes the real error by code', () => {
    expect(
      isPkceCodeVerifierMissingError({
        name: 'AuthPKCECodeVerifierMissingError',
        code: 'pkce_code_verifier_not_found',
        message: 'PKCE code verifier not found in storage.',
      })
    ).toBe(true)
  })

  it('recognizes it by name alone, when code is missing', () => {
    expect(isPkceCodeVerifierMissingError({ name: 'AuthPKCECodeVerifierMissingError', message: 'PKCE code verifier not found in storage.' })).toBe(
      true
    )
  })

  it('falls back to message text when both code and name are missing (older SDK)', () => {
    expect(isPkceCodeVerifierMissingError({ message: 'both auth code and code verifier should be non-empty' })).toBe(true)
  })

  it('does not treat an unrelated error (e.g. an already-used code) as a missing verifier', () => {
    expect(isPkceCodeVerifierMissingError({ name: 'AuthApiError', code: 'invalid_grant', message: 'invalid flow state' })).toBe(false)
  })

  it('handles null/undefined/non-object input safely', () => {
    expect(isPkceCodeVerifierMissingError(null)).toBe(false)
    expect(isPkceCodeVerifierMissingError(undefined)).toBe(false)
    expect(isPkceCodeVerifierMissingError('a string')).toBe(false)
  })
})
