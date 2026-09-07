// Sprint 1C Phase 3: the pack detail screen must never call the content
// action for a pack it doesn't believe is owned, must fail closed on any
// content error (a stale/incorrect owned=true included), and must
// present a plain "not available" locked state with no purchase CTA.
import { render, screen, fireEvent } from '@testing-library/react-native'
import PackDetailScreen from '../app/(app)/library/[packId]'

const mockUseLocalSearchParams = jest.fn()
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

const mockUseLibraryContent = jest.fn()
jest.mock('../hooks/useLibraryContent', () => ({
  useLibraryContent: (...args: unknown[]) => mockUseLibraryContent(...args),
}))

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
  mockUseLibraryContent.mockReset()
})

it('never enables the content fetch for a pack the catalog reported as locked', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'false' })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />);

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
})

it('shows a plain locked message for a locked pack, with no purchase CTA or website link', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'false' })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('This Study Pack isn’t currently available on this account.')).toBeTruthy()
  expect(screen.queryByText(/buy/i)).toBeNull()
  expect(screen.queryByText(/checkout/i)).toBeNull()
  expect(screen.queryByText(/purchase/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /buy/i })).toBeNull()
})

it('treats a missing/malformed owned param as locked -- never assumes ownership', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: undefined })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: false })
  expect(screen.getByText('This Study Pack isn’t currently available on this account.')).toBeTruthy()
})

it('enables the content fetch with the exact pack id for an owned pack', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'true' })
  mockUseLibraryContent.mockReturnValue({ content: studyPackContentFixture(), version: '1.0.0', loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(mockUseLibraryContent).toHaveBeenCalledWith({ packId: 'airspace_mastery', enabled: true })
  expect(screen.getByText('Apex Advantage Airspace Mastery')).toBeTruthy()
})

it('shows a loading state while content is loading', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'true' })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: true, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('Loading Study Pack…')).toBeTruthy()
})

// A stale locally-cached owned=true whose server-side content call comes
// back 403 (or any other error/malformed shape -- see
// lib/api/library.ts's runtime validation) must fail closed to a normal
// retryable error, never render cached or partial content.
it('fails closed to a retryable error on a content error, even though owned=true locally', async () => {
  const refetch = jest.fn()
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'true' })
  mockUseLibraryContent.mockReturnValue({
    content: null,
    version: null,
    loading: false,
    error: { userMessage: 'This Study Pack is not unlocked on this account' },
    refetch,
  })

  await render(<PackDetailScreen />)

  expect(screen.getByText('This Study Pack is not unlocked on this account')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refetch).toHaveBeenCalledTimes(1)
})

it('shows a generic retryable error rather than crashing if content resolves to null with no error', async () => {
  mockUseLocalSearchParams.mockReturnValue({ packId: 'airspace_mastery', name: 'Apex Advantage Airspace Mastery', owned: 'true' })
  mockUseLibraryContent.mockReturnValue({ content: null, version: null, loading: false, error: null, refetch: jest.fn() })

  await render(<PackDetailScreen />)

  expect(screen.getByText('We couldn’t load this Study Pack.')).toBeTruthy()
})
