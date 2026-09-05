import { describe, it, expect } from 'vitest'
import { isStaleRefreshTokenError } from './authErrors'

function authApiError(code, message = 'Invalid Refresh Token') {
  return { name: 'AuthApiError', status: 400, code, message }
}

describe('isStaleRefreshTokenError', () => {
  it('recognizes the documented refresh_token_not_found code', () => {
    expect(isStaleRefreshTokenError(authApiError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'))).toBe(true)
  })

  it('recognizes the documented refresh_token_already_used code', () => {
    expect(isStaleRefreshTokenError(authApiError('refresh_token_already_used'))).toBe(true)
  })

  it('falls back to the stable message text when no code is present', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(true)
  })

  it('does not match an AuthApiError with an unrelated code', () => {
    expect(isStaleRefreshTokenError(authApiError('invalid_credentials', 'Invalid login credentials'))).toBe(false)
  })

  it('does not match a network/retryable fetch error even with a similar-sounding message', () => {
    expect(isStaleRefreshTokenError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBe(false)
  })

  it('does not match a generic non-auth error', () => {
    expect(isStaleRefreshTokenError(new Error('boom'))).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isStaleRefreshTokenError(null)).toBe(false)
    expect(isStaleRefreshTokenError(undefined)).toBe(false)
  })
})
