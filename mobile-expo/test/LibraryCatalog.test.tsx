// Sprint 1C Phase 2: the Library catalog replaces the old "coming soon"
// placeholder with a real, server-backed pack list. These tests exercise
// its loading/empty/error states, the Owned-vs-Locked presentation (the
// one thing that must never be inferred client-side -- see
// useLibraryCatalog.ts), the explicit no-purchase-steering rule already
// established for Practice's own locked state, and that opening a pack
// carries the catalog's own `owned` flag through untouched.
import { render, screen, fireEvent } from '@testing-library/react-native'
import LibraryTabScreen from '../app/(app)/library/index'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseLibraryCatalog = jest.fn()
jest.mock('../hooks/useLibraryCatalog', () => ({
  useLibraryCatalog: (...args: unknown[]) => mockUseLibraryCatalog(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return { ready: true, loading: false, ...overrides }
}

function ownedPack(overrides: Record<string, unknown> = {}) {
  return {
    id: 'airspace_mastery',
    name: 'Apex Advantage Airspace Mastery',
    subtitle: 'Master the airspace system',
    price_cents: 4900,
    currency: 'usd',
    certificate_type: 'private_pilot',
    estimated_minutes_min: 120,
    estimated_minutes_max: 180,
    sort_order: 1,
    owned: true,
    ...overrides,
  }
}

beforeEach(() => {
  mockPush.mockReset()
  mockUseBootstrapContext.mockReset()
  mockUseLibraryCatalog.mockReset()
})

it('shows a loading state while bootstrap has not resolved, and never renders packs from a stale hook result', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [ownedPack()] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('Loading Library…')).toBeTruthy()
  expect(screen.queryByText('Apex Advantage Airspace Mastery')).toBeNull()
})

it('shows a loading state while the catalog itself is loading', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({ data: null, loading: true, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('Loading Library…')).toBeTruthy()
})

it('shows an empty state for a zero-pack catalog', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('Nothing here yet')).toBeTruthy()
})

it('shows a retryable error and calls refresh on retry', async () => {
  const refresh = jest.fn()
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({
    data: null,
    loading: false,
    refreshing: false,
    error: { userMessage: 'Check your connection and try again.' },
    refresh,
  })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('renders an owned pack as Owned with an Open action', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [ownedPack()] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('Apex Advantage Airspace Mastery')).toBeTruthy()
  expect(screen.getByText('OWNED')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
})

it('renders a locked pack as Locked, with no purchase CTA or checkout/website language anywhere', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({
    data: { packs: [ownedPack({ owned: false })] },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
  })

  await render(<LibraryTabScreen />)

  expect(screen.getByText('LOCKED')).toBeTruthy()
  expect(screen.getByText('Not currently available on this account.')).toBeTruthy()
  expect(screen.queryByText(/buy/i)).toBeNull()
  expect(screen.queryByText(/checkout/i)).toBeNull()
  expect(screen.queryByText(/purchase/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /buy/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /checkout/i })).toBeNull()
  expect(screen.getByRole('button', { name: 'View Details' })).toBeTruthy()
})

it('opening an owned pack pushes the exact pack id and owned=true', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [ownedPack()] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Open' }))

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(app)/library/[packId]',
    params: { packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'true' },
  })
})

it('opening a locked pack pushes owned=false -- never a client-side guess of ownership', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseLibraryCatalog.mockReturnValue({
    data: { packs: [ownedPack({ owned: false })] },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
  })

  await render(<LibraryTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'View Details' }))

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(app)/library/[packId]',
    params: { packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'false' },
  })
})

it('does not call useLibraryCatalog with enabled=true while bootstrap has not resolved', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))
  mockUseLibraryCatalog.mockReturnValue({ data: null, loading: false, refreshing: false, error: null, refresh: jest.fn() })

  await render(<LibraryTabScreen />)

  expect(mockUseLibraryCatalog).toHaveBeenCalledWith({ enabled: false })
})
