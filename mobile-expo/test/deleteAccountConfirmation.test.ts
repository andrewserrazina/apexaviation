import { emailConfirmationMatches } from '../lib/deleteAccountConfirmation'

describe('emailConfirmationMatches', () => {
  it('matches an exact, case-sensitive, no-whitespace pair', () => {
    expect(emailConfirmationMatches('jordan@example.com', 'jordan@example.com')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(emailConfirmationMatches('Jordan@Example.com', 'jordan@example.com')).toBe(true)
  })

  it('trims surrounding whitespace on the typed text', () => {
    expect(emailConfirmationMatches('  jordan@example.com  ', 'jordan@example.com')).toBe(true)
  })

  it('rejects a non-matching email', () => {
    expect(emailConfirmationMatches('someone-else@example.com', 'jordan@example.com')).toBe(false)
  })

  it('rejects an empty typed value', () => {
    expect(emailConfirmationMatches('', 'jordan@example.com')).toBe(false)
  })

  it('never matches when the member email is null, undefined, or empty -- even an empty typed value', () => {
    expect(emailConfirmationMatches('', null)).toBe(false)
    expect(emailConfirmationMatches('', undefined)).toBe(false)
    expect(emailConfirmationMatches('', '')).toBe(false)
  })
})
