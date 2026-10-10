import { render, screen, fireEvent } from '@testing-library/react-native'
import ForgotPasswordScreen from '../app/(auth)/forgot-password'

const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({}),
}))

const mockRequestPasswordReset = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ requestPasswordReset: mockRequestPasswordReset }),
}))

beforeEach(() => {
  mockReplace.mockReset()
  mockRequestPasswordReset.mockReset()
})

it('renders the request form', async () => {
  await render(<ForgotPasswordScreen />)
  expect(screen.getByLabelText('Email address')).toBeTruthy()
  expect(screen.getByTestId('forgot-password-submit')).toBeTruthy()
})

it('pressing Send Reset Link with no email typed never calls requestPasswordReset', async () => {
  await render(<ForgotPasswordScreen />)
  fireEvent.press(screen.getByTestId('forgot-password-submit'))
  expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
})

it('"Back to Sign In" navigates back without calling requestPasswordReset', async () => {
  await render(<ForgotPasswordScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Back to Sign In' }))
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in')
  expect(mockRequestPasswordReset).not.toHaveBeenCalled()
})
