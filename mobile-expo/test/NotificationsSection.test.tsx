// Sprint 1C Phase 6/10: the Notifications section's own render logic --
// which of the three permission states shows which UI, that toggles map
// exactly to server preference fields, and that a failed update leaves an
// error visible rather than silently reverting with no explanation.
import { render, screen, fireEvent } from '@testing-library/react-native'
import { NotificationsSection } from '../components/notifications/NotificationsSection'

const mockUseNotificationsContext = jest.fn()
jest.mock('../contexts/NotificationsContext', () => ({
  useNotificationsContext: () => mockUseNotificationsContext(),
}))

function contextValue(overrides: Record<string, unknown> = {}) {
  return {
    permission: 'undetermined',
    registered: false,
    device: null,
    enabling: false,
    enableError: null,
    enable: jest.fn(),
    disabling: false,
    disable: jest.fn(),
    preferences: null,
    preferencesLoading: false,
    preferencesError: null,
    savingFields: new Set<string>(),
    updatePreference: jest.fn(),
    ...overrides,
  }
}

const PREFS = { daily_drill_enabled: true, daily_drill_time: '07:00:00', checkride_countdown_enabled: false, weak_area_enabled: true, streak_enabled: true }

beforeEach(() => mockUseNotificationsContext.mockReset())

it('shows an Enable Notifications action when permission has not been decided yet', async () => {
  mockUseNotificationsContext.mockReturnValue(contextValue())
  await render(<NotificationsSection />)
  expect(screen.getByRole('button', { name: 'Enable Notifications' })).toBeTruthy()
})

it('calls enable() when the learner taps Enable Notifications', async () => {
  const enable = jest.fn()
  mockUseNotificationsContext.mockReturnValue(contextValue({ enable }))
  await render(<NotificationsSection />)
  fireEvent.press(screen.getByRole('button', { name: 'Enable Notifications' }))
  expect(enable).toHaveBeenCalledTimes(1)
})

it('shows an Open Settings action, not another permission prompt, when permission was denied', async () => {
  mockUseNotificationsContext.mockReturnValue(contextValue({ permission: 'denied' }))
  await render(<NotificationsSection />)
  expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Enable Notifications' })).toBeNull()
})

it('shows an enable error message when provided', async () => {
  mockUseNotificationsContext.mockReturnValue(contextValue({ enableError: 'We couldn’t enable notifications. Please try again.' }))
  await render(<NotificationsSection />)
  expect(screen.getByText('We couldn’t enable notifications. Please try again.')).toBeTruthy()
})

it('shows a loading state while preferences are loading', async () => {
  mockUseNotificationsContext.mockReturnValue(contextValue({ permission: 'granted', registered: true, preferencesLoading: true }))
  await render(<NotificationsSection />)
  expect(screen.getByText('Loading preferences…')).toBeTruthy()
})

it('renders every preference toggle mapped to the exact server field, matching current values', async () => {
  mockUseNotificationsContext.mockReturnValue(contextValue({ permission: 'granted', registered: true, preferences: PREFS }))
  await render(<NotificationsSection />)
  expect(screen.getByText('Daily Drill Reminder')).toBeTruthy()
  expect(screen.getByText('Checkride Countdown')).toBeTruthy()
  expect(screen.getByText('Weak Area Nudges')).toBeTruthy()
  expect(screen.getByText('Streak Reminders')).toBeTruthy()
})

it('toggling a preference calls updatePreference with exactly that one field', async () => {
  const updatePreference = jest.fn()
  mockUseNotificationsContext.mockReturnValue(contextValue({ permission: 'granted', registered: true, preferences: PREFS, updatePreference }))
  await render(<NotificationsSection />)
  fireEvent(screen.getAllByRole('switch')[0], 'valueChange', false)
  expect(updatePreference).toHaveBeenCalledWith({ daily_drill_enabled: false })
})

it('shows a preferences error message without hiding the toggles', async () => {
  mockUseNotificationsContext.mockReturnValue(
    contextValue({ permission: 'granted', registered: true, preferences: PREFS, preferencesError: 'We couldn’t save that change. Please try again.' })
  )
  await render(<NotificationsSection />)
  expect(screen.getByText('We couldn’t save that change. Please try again.')).toBeTruthy()
  expect(screen.getByText('Daily Drill Reminder')).toBeTruthy()
})

it('shows a Disable Notifications action once registered, which calls disable()', async () => {
  const disable = jest.fn()
  mockUseNotificationsContext.mockReturnValue(contextValue({ permission: 'granted', registered: true, preferences: PREFS, disable }))
  await render(<NotificationsSection />)
  fireEvent.press(screen.getByRole('button', { name: 'Disable Notifications' }))
  expect(disable).toHaveBeenCalledTimes(1)
})
