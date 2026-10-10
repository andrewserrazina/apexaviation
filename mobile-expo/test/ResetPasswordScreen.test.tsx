import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import ResetPasswordScreen from '../app/(auth)/reset-password'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}))

const mockUpdatePassword = jest.fn()
const mockClearPasswordRecovery = jest.fn()
const mockUseAuth = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

function authState(overrides: Record<string, unknown> = {}) {
  return {
    isPasswordRecovery: true,
    updatePassword: mockUpdatePassword,
    clearPasswordRecovery: mockClearPasswordRecovery,
    ...overrides,
  }
}

beforeEach(() => {
  mockReplace.mockReset()
  mockUpdatePassword.mockReset()
  mockClearPasswordRecovery.mockReset().mockResolvedValue(undefined)
  mockUseAuth.mockReset().mockReturnValue(authState())
})

it('renders the new-password form when a valid recovery session is active', async () => {
  await render(<ResetPasswordScreen />)
  expect(screen.getByLabelText('New password')).toBeTruthy()
  expect(screen.getByLabelText('Confirm new password')).toBeTruthy()
  expect(screen.getByTestId('reset-password-submit')).toBeTruthy()
})

it('shows a dead-end message instead of the form when there is no active recovery session', async () => {
  mockUseAuth.mockReturnValue(authState({ isPasswordRecovery: false }))
  await render(<ResetPasswordScreen />)
  expect(screen.getByText('Link no longer valid.')).toBeTruthy()
  expect(screen.queryByTestId('reset-password-submit')).toBeNull()
})

it('pressing Set Password with nothing typed never calls updatePassword', async () => {
  await render(<ResetPasswordScreen />)
  fireEvent.press(screen.getByTestId('reset-password-submit'))
  expect(mockUpdatePassword).not.toHaveBeenCalled()
  expect(await screen.findByText('Password must be at least 6 characters.')).toBeTruthy()
})

it('Cancel clears the recovery session and returns to sign-in', async () => {
  await render(<ResetPasswordScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(mockClearPasswordRecovery).toHaveBeenCalledTimes(1))
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in')
})
