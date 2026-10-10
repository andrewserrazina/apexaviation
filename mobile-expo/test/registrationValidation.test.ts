import { isValidEmail, isValidPassword, passwordsMatch, validateRegistrationForm } from '../lib/registrationValidation'

describe('isValidEmail', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('pilot@example.com')).toBe(true)
  })

  it('accepts an email with surrounding whitespace', () => {
    expect(isValidEmail('  pilot@example.com  ')).toBe(true)
  })

  it.each(['', 'not-an-email', 'missing-at.com', 'pilot@', '@example.com', 'pilot@example'])(
    'rejects %p',
    (bad) => {
      expect(isValidEmail(bad)).toBe(false)
    }
  )
})

describe('isValidPassword', () => {
  it('rejects a password under 6 characters', () => {
    expect(isValidPassword('abc12')).toBe(false)
  })

  it('accepts a password of exactly 6 characters', () => {
    expect(isValidPassword('abc123')).toBe(true)
  })

  it('accepts a longer password', () => {
    expect(isValidPassword('correct-horse-battery-staple')).toBe(true)
  })
})

describe('passwordsMatch', () => {
  it('matches identical, non-empty passwords', () => {
    expect(passwordsMatch('abc123', 'abc123')).toBe(true)
  })

  it('rejects two empty strings (never "matching" on nothing typed)', () => {
    expect(passwordsMatch('', '')).toBe(false)
  })

  it('rejects a mismatch', () => {
    expect(passwordsMatch('abc123', 'abc124')).toBe(false)
  })
})

describe('validateRegistrationForm', () => {
  const validForm = { email: 'pilot@example.com', password: 'abc123', confirmPassword: 'abc123', acceptedTerms: true }

  it('passes a fully valid form', () => {
    expect(validateRegistrationForm(validForm)).toBeNull()
  })

  it('flags an invalid email first', () => {
    expect(validateRegistrationForm({ ...validForm, email: 'not-an-email' })).toEqual({
      field: 'email',
      message: 'Enter a valid email address.',
    })
  })

  it('flags a weak/short password', () => {
    expect(validateRegistrationForm({ ...validForm, password: 'ab', confirmPassword: 'ab' })).toEqual({
      field: 'password',
      message: 'Password must be at least 6 characters.',
    })
  })

  it('flags mismatched passwords', () => {
    expect(validateRegistrationForm({ ...validForm, confirmPassword: 'different' })).toEqual({
      field: 'confirmPassword',
      message: 'Passwords do not match.',
    })
  })

  it('flags unaccepted terms last, once email/password/confirm are all otherwise valid', () => {
    expect(validateRegistrationForm({ ...validForm, acceptedTerms: false })).toEqual({
      field: 'terms',
      message: 'You must accept the Terms of Service and Privacy Policy to continue.',
    })
  })
})
