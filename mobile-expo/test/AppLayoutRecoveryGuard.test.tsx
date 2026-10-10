// Security review finding (Priority 1): "whether account recovery
// sessions can accidentally grant access to protected screens." A
// recovery session (established by exchanging a password-reset deep
// link's code -- see useAuthDeepLinks.ts) is a REAL Supabase session,
// which would look identical to a normal sign-in to a guard that only
// checks `session`. This exercises app/(app)/_layout.tsx's guard
// in isolation (not the full Tabs tree -- Redirect/Tabs/BootstrapProvider/
// NotificationsProvider are mocked to keep this a focused test of the
// three early-return branches' own logic and precedence).
jest.mock('expo-router', () => {
  const { Text } = require('react-native')
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Tabs: Object.assign(({ children }: { children: React.ReactNode }) => <>{children}</>, { Screen: () => null }),
  }
})

jest.mock('../contexts/BootstrapContext', () => ({
  BootstrapProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('../contexts/NotificationsContext', () => ({
  NotificationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('../components/AppHeader', () => ({
  AppHeader: () => null,
}))

const mockUseAuth = jest.fn()
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

import { render, screen } from '@testing-library/react-native'
import AppLayout from '../app/(app)/_layout'

function authState(overrides: Record<string, unknown> = {}) {
  return {
    session: null,
    loading: false,
    isPasswordRecovery: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockUseAuth.mockReset().mockReturnValue(authState())
})

it('redirects to reset-password when isPasswordRecovery is true, even though a real session exists', async () => {
  mockUseAuth.mockReturnValue(authState({ session: { user: { id: 'u1' } }, isPasswordRecovery: true }))

  await render(<AppLayout />)

  expect(screen.getByTestId('redirect')).toHaveTextContent('/(auth)/reset-password')
})

it('redirects to sign-in when there is no session at all', async () => {
  await render(<AppLayout />)
  expect(screen.getByTestId('redirect')).toHaveTextContent('/(auth)/sign-in')
})

it('isPasswordRecovery takes precedence over having no session (recovery redirect wins)', async () => {
  mockUseAuth.mockReturnValue(authState({ session: null, isPasswordRecovery: true }))

  await render(<AppLayout />)

  expect(screen.getByTestId('redirect')).toHaveTextContent('/(auth)/reset-password')
})

it('renders the real app (no redirect) once signed in with no recovery session pending', async () => {
  mockUseAuth.mockReturnValue(authState({ session: { user: { id: 'u1' } }, isPasswordRecovery: false }))

  await render(<AppLayout />)

  expect(screen.queryByTestId('redirect')).toBeNull()
})

it('shows a loading state before isPasswordRecovery is even checked, never flashing protected content', async () => {
  mockUseAuth.mockReturnValue(authState({ loading: true, session: { user: { id: 'u1' } } }))

  await render(<AppLayout />)

  expect(screen.queryByTestId('redirect')).toBeNull()
  expect(screen.getByText('Loading Apex Advantage…')).toBeTruthy()
})
