// Sprint 1C Phase 3 (Rev2 hardened): this screen no longer trusts
// `owned`/`name` from route params as entitlement authority -- a
// notification (or a hand-crafted deep link) could otherwise pass
// owned:'false' for a pack the learner actually owns, or the reverse.
// The only trusted input is `packId`; ownership and name are resolved by
// asking the authenticated mobile-library catalog directly, the exact
// same server-provided data the Library tab itself renders. The
// content action's own entitlement re-check remains the final authority
// regardless of what the catalog says.
import { render, screen, fireEvent } from '@testing-library/react-native'
import PackDetailScreen from '../app/(app)/library/[packId]'

const mockUseLocalSearchParams = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseLibraryCatalog = jest.fn()
jest.mock('../hooks/useLibraryCatalog', () => ({
  useLibraryCatalog: (...args: unknown[]) => mockUseLibraryCatalog(...args),
}))

const mockUseLibraryContent = jest.fn()
jest.mock('../hooks/useLibraryContent', () => ({
  useLibraryContent: (...args: unknown[]) => mockUseLibraryContent(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return { ready: true, loading: false, ...overrides }
}

function packFixture(overrides: Record<string, unknown> = {}) {
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

function studyPackContentFixture() {
  return {
    product: { name: 'Apex Advantage Airspace Mastery' },
    lessons: [],
    scenarios: [],
    checkride_corner: [],
    mastery_check: { questions: [], passing_percent: 80, retakes_allowed: true },
    quick_reference: { sections: [] },
  }
}

beforeEach(() => {
  mockUseLocalSearchParams.mockReset()
  mockUseBootstrapContext.mockReset()
  mockUseLibraryCatalog.mockReset()
  mockUseLibraryContent.mockReset()
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery' })
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
})

it('shows a loading state while bootstrap has not resolved', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))
  mockUseLibraryCatalog.mockReturnValue({ data: null, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Loading Study Pack…')).toBeTruthy()
  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
})

it('shows a loading state while the catalog itself is loading', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: null, loading: true, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Loading Study Pack…')).toBeTruthy()
})

it('shows a retryable error and refreshes the catalog on retry', async () => {
  const refresh = jest.fn()
  mockUseLibraryCatalog.mockReturnValue({ data: null, loading: false, refreshing: false, error: { userMessage: 'Check your connection and try again.' }, refresh })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('shows an honest not-found state when the catalog has no pack with this id -- never guesses at ownership', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Study Pack not found')).toBeTruthy()
  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
})

it('never enables the content fetch for a pack the catalog reports as locked', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: false })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
})

it('shows a plain locked message using the catalog’s real pack name, with no purchase CTA or website link', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: false })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Apex Advantage Airspace Mastery')).toBeTruthy()
  expect(screen.getByText('This Study Pack isn’t currently available on this account.')).toBeTruthy()
  expect(screen.queryByText(/buy/i)).toBeNull()
  expect(screen.queryByText(/checkout/i)).toBeNull()
  expect(screen.queryByText(/purchase/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /buy/i })).toBeNull()
})

it('enables the content fetch with the exact pack id when the catalog reports the pack as owned', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: true })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: studyPackContentFixture(), version: '1.0.0', loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: true })
  expect(screen.getByText('Apex Advantage Airspace Mastery')).toBeTruthy()
})

// The actual security-relevant regression test: even if something
// upstream (a stale deep link, a manually-crafted URL) tried to smuggle
// an owned=true-style signal in, this screen has no route param path for
// that anymore -- only the catalog's own `owned` field, resolved
// server-side, ever gates the content fetch.
it('a locked pack cannot be forced into the owned/content-fetching branch by any route param', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', owned: 'true', name: 'Fake Name' } as unknown as { packId: string })
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: false })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
  expect(screen.getByText('This Study Pack isn’t currently available on this account.')).toBeTruthy()
})

it('shows a loading state while content is loading', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: true })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: true, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Loading Study Pack…')).toBeTruthy()
})

// A stale locally-cached "owned" state whose server-side content call
// comes back 403 (or any other error/malformed shape -- see
// lib/api/library.ts's runtime validation) must fail closed to a normal
// retryable error, never render cached or partial content -- and
// retrying reconciles by refreshing the catalog too, not just retrying
// the same content call blindly.
it('fails closed to a retryable error on a content error, even though the catalog said owned=true, and reconciles by refreshing the catalog', async () => {
  const refetchContent = jest.fn()
  const refreshCatalog = jest.fn()
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: true })] }, loading: false, refreshing: false, error: null, refresh: refreshCatalog })
  mockUseLibraryContent.mockReturnValue({
    content: null,
    version: null,
    loading: false,
    error: { userMessage: 'This Study Pack is not unlocked on this account' },
    refetch: refetchContent,
  })

  await render(<PackDetailScreen />)

  expect(screen.getByText('This Study Pack is not unlocked on this account')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refetchContent).toHaveBeenCalledTimes(1)
  expect(refreshCatalog).toHaveBeenCalledTimes(1)
})

it('shows a generic retryable error rather than crashing if content resolves to null with no error', async () => {
  mockUseLibraryCatalog.mockReturnValue({ data: { packs: [packFixture({ owned: true })] }, loading: false, refreshing: false, error: null, refresh: jest.fn() })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('We couldn’t load this Study Pack.')).toBeTruthy()
})
