import { isStaleRefreshTokenError } from '../lib/authErrors'

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
