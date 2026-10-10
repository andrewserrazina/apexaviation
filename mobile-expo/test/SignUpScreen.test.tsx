// This jest-expo/@testing-library/react-native setup does not commit
// state updates from a controlled TextInput's fireEvent.changeText (see
// test/DeleteAccountScreen.test.tsx's own comment on this environment
// limitation) -- the actual validation logic is covered directly and
// reliably in test/registrationValidation.test.ts. This file only
// covers what's reliably testable without simulating typing: initial
// render, that pressing Create Account with nothing typed never calls
// signUp, and navigation.
import { render, screen, fireEvent } from '@testing-library/react-native'
import SignUpScreen from '../app/(auth)/sign-up'

const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({}),
}))

const mockSignUp = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ signUp: mockSignUp }),
}))

beforeEach(() => {
  mockPush.mockReset()
  mockReplace.mockReset()
  mockSignUp.mockReset()
})

it('renders the Create Account form', async () => {
  await render(<SignUpScreen />)

  expect(screen.getByLabelText('Email address')).toBeTruthy()
  expect(screen.getByLabelText('Password')).toBeTruthy()
  expect(screen.getByLabelText('Confirm password')).toBeTruthy()
  expect(screen.getByTestId('sign-up-submit')).toBeTruthy()
})

it('pressing Create Account with nothing typed never calls signUp (terms unaccepted, fields empty)', async () => {
  await render(<SignUpScreen />)
  fireEvent.press(screen.getByTestId('sign-up-submit'))
  expect(mockSignUp).not.toHaveBeenCalled()
  expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
})

it('the Terms of Service / Privacy Policy checkbox starts unchecked', async () => {
  await render(<SignUpScreen />)
  const checkbox = screen.getByLabelText('I agree to the Terms of Service and Privacy Policy')
  expect(checkbox.props.accessibilityState.checked).toBe(false)
})

it('"Back to Sign In" navigates back without ever calling signUp', async () => {
  await render(<SignUpScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Back to Sign In' }))
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(auth)/sign-in', params: undefined })
  expect(mockSignUp).not.toHaveBeenCalled()
})
