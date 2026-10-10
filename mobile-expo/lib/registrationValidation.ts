// Pure predicates for Create Account / Forgot Password / Reset Password
// field validation, extracted so they're unit-testable without
// simulating TextInput typing -- see lib/deleteAccountConfirmation.ts's
// own comment for why this jest-expo/@testing-library/react-native setup
// can't reliably exercise this logic via fireEvent.changeText.
//
// The project's actually-configured Supabase Auth password policy
// (minimum length, character requirements) is server-side and this app
// has no way to read it -- isValidPassword() only enforces the same
// minlength=6 floor the web portal's own reset-password form already
// uses (site/portal-reset-password.html), so a learner gets instant
// feedback for the common case, but Supabase's own signUp()/updateUser()
// response is always the final authority and is surfaced to the learner
// whenever it rejects a password this check let through.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim())
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password.length > 0 && password === confirmPassword
}

export interface RegistrationFormState {
  email: string
  password: string
  confirmPassword: string
  acceptedTerms: boolean
}

export type RegistrationFieldError =
  | { field: 'email'; message: string }
  | { field: 'password'; message: string }
  | { field: 'confirmPassword'; message: string }
  | { field: 'terms'; message: string }

// Single source of truth for whether Create Account's submit button may
// be pressed at all -- checked both to disable the button (UI) and
// before ever calling AuthContext.signUp (defense in depth, matching
// DeleteAccountScreen's own disabled-button + guarded-handler pattern).
export function validateRegistrationForm(form: RegistrationFormState): RegistrationFieldError | null {
  if (!isValidEmail(form.email)) return { field: 'email', message: 'Enter a valid email address.' }
  if (!isValidPassword(form.password)) return { field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  if (!passwordsMatch(form.password, form.confirmPassword)) return { field: 'confirmPassword', message: 'Passwords do not match.' }
  if (!form.acceptedTerms) return { field: 'terms', message: 'You must accept the Terms of Service and Privacy Policy to continue.' }
  return null
}
