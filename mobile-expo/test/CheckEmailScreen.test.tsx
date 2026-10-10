import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import CheckEmailScreen from '../app/(auth)/check-email'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ email: 'pilot@example.com' }),
}))

const mockResendVerificationEmail = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ resendVerificationEmail: mockResendVerificationEmail }),
}))

beforeEach(() => {
  mockReplace.mockReset()
  mockResendVerificationEmail.mockReset()
})

it('renders the emailed address in the instructions', async () => {
  await render(<CheckEmailScreen />)
  expect(screen.getByText(/We sent a verification link to pilot@example\.com/)).toBeTruthy()
})

it('tapping Resend calls resendVerificationEmail with the right address and starts the cooldown', async () => {
  mockResendVerificationEmail.mockResolvedValue({ ok: true })
  await render(<CheckEmailScreen />)

  fireEvent.press(screen.getByText('Resend verification email'))
  await waitFor(() => expect(mockResendVerificationEmail).toHaveBeenCalledWith('pilot@example.com'))
  expect(await screen.findByText('Verification email sent.')).toBeTruthy()
  expect(screen.queryByText('Resend verification email')).toBeNull() // now shows the cooldown label instead
})

it('surfaces a friendly message and does not start the cooldown on failure', async () => {
  mockResendVerificationEmail.mockResolvedValue({ ok: false, message: 'Please wait a bit before requesting another email.' })
  await render(<CheckEmailScreen />)

  fireEvent.press(screen.getByText('Resend verification email'))
  expect(await screen.findByText('Please wait a bit before requesting another email.')).toBeTruthy()
  // No cooldown started -- the button is still labeled for an immediate retry.
  expect(screen.getByText('Resend verification email')).toBeTruthy()
})

it('"Back to Sign In" navigates back without resending', async () => {
  await render(<CheckEmailScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Back to Sign In' }))
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in')
  expect(mockResendVerificationEmail).not.toHaveBeenCalled()
})
