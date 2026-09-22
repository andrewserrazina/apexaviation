// App Store submission requirement (Guideline 5.1.1(v)). This screen's
// own type-to-confirm matching logic is covered directly and reliably in
// test/deleteAccountConfirmation.test.ts (a pure-function unit test) --
// this jest-expo/@testing-library/react-native setup does not commit
// state updates from a controlled TextInput's fireEvent.changeText (see
// test/DpeSession.test.tsx's own comment on this same environment
// limitation), so this file only covers what's reliably testable without
// simulating typing: the confirm button's disabled-by-default state, and
// that Cancel navigates back without ever calling deleteAccount.
import { render, screen, fireEvent } from '@testing-library/react-native'
import DeleteAccountScreen from '../app/(app)/delete-account/index'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
}))

const mockUseAuth = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

const mockDeleteAccount = jest.fn()
jest.mock('../lib/api/account', () => ({
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}))

function authState(overrides: Record<string, unknown> = {}) {
  return {
    user: { email: 'jordan@example.com' },
    signOut: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => {
  mockPush.mockReset()
  mockReplace.mockReset()
  mockBack.mockReset()
  mockDeleteAccount.mockReset()
  mockUseAuth.mockReset().mockReturnValue(authState())
})

it('renders the member’s own email in the confirmation instructions and starts with the confirm button disabled', async () => {
  await render(<DeleteAccountScreen />)

  expect(screen.getByText('TYPE YOUR EMAIL (jordan@example.com) TO CONFIRM')).toBeTruthy()
  expect(screen.getByTestId('delete-account-confirm').props.accessibilityState.disabled).toBe(true)
})

it('never calls deleteAccount just from rendering', async () => {
  await render(<DeleteAccountScreen />)
  expect(mockDeleteAccount).not.toHaveBeenCalled()
})

it('pressing the disabled confirm button never calls deleteAccount', async () => {
  await render(<DeleteAccountScreen />)
  fireEvent.press(screen.getByTestId('delete-account-confirm'))
  expect(mockDeleteAccount).not.toHaveBeenCalled()
})

it('Cancel navigates back without calling deleteAccount', async () => {
  await render(<DeleteAccountScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
  expect(mockBack).toHaveBeenCalledTimes(1)
  expect(mockDeleteAccount).not.toHaveBeenCalled()
})
