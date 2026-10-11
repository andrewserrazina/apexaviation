// Mobile parity (Phase 5, item 1): DPE Question Library screen. Covers
// bootstrap gating (same ordering as Practice/ACS: loading -> error ->
// locked -> content), library loading/error states, and that expanding a
// question calls touchQuestionLastViewed while favoriting/studying call
// their own direct-write functions -- all through the real component,
// against mocked API modules (not a source scan).
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import DpeLibraryScreen from '../app/(app)/practice/library'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}))

jest.mock('../hooks/useCheckridePrepPurchase', () => ({
  useCheckridePrepPurchase: () => ({
    state: 'idle',
    product: null,
    errorMessage: null,
    purchase: jest.fn(),
    restore: jest.fn(),
  }),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseDpeLibrary = jest.fn()
jest.mock('../hooks/useDpeLibrary', () => ({
  useDpeLibrary: (...args: unknown[]) => mockUseDpeLibrary(...args),
}))

const mockSetQuestionFavorited = jest.fn()
const mockSetQuestionStudied = jest.fn()
const mockTouchQuestionLastViewed = jest.fn()
jest.mock('../lib/api/dpeLibraryDirect', () => ({
  setQuestionFavorited: (...args: unknown[]) => mockSetQuestionFavorited(...args),
  setQuestionStudied: (...args: unknown[]) => mockSetQuestionStudied(...args),
  touchQuestionLastViewed: (...args: unknown[]) => mockTouchQuestionLastViewed(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return {
    data: { user: { id: 'u1' } },
    loading: false,
    error: null,
    refresh: jest.fn(),
    ready: true,
    entitled: true,
    ...overrides,
  }
}

function libraryState(overrides: Record<string, unknown> = {}) {
  return { data: null, loading: false, refreshing: false, error: null, refresh: jest.fn(), ...overrides }
}

function libraryData(overrides: Record<string, unknown> = {}) {
  return {
    categories: [{ id: 'weather', label: 'Weather', section_label: null, sort_order: 1 }],
    questions: [
      {
        id: 'q1',
        category: 'weather',
        question: 'What is a METAR?',
        model_answer: 'A routine aviation weather report.',
        common_mistakes: null,
        dpe_evaluating: null,
        real_world_application: null,
        acs_reference: 'PA.I.C.K1',
        sort_order: 1,
      },
    ],
    progress: {},
    ...overrides,
  }
}

beforeEach(() => {
  mockUseBootstrapContext.mockReset()
  mockUseDpeLibrary.mockReset()
  mockSetQuestionFavorited.mockReset().mockResolvedValue(undefined)
  mockSetQuestionStudied.mockReset().mockResolvedValue(undefined)
  mockTouchQuestionLastViewed.mockReset().mockResolvedValue(undefined)
})

it('shows a locked state for an unentitled account, without ever fetching the library', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ entitled: false }))
  mockUseDpeLibrary.mockReturnValue(libraryState())

  await render(<DpeLibraryScreen />)

  expect(mockUseDpeLibrary).toHaveBeenCalledWith({ enabled: false })
  expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
})

it('shows a loading state while the library is loading', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ loading: true }))

  await render(<DpeLibraryScreen />)

  expect(screen.getByText('Loading the question library…')).toBeTruthy()
})

it('shows a retryable error state when the library fails to load', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ error: { userMessage: 'Check your connection and try again.' } }))

  await render(<DpeLibraryScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
})

it('renders questions grouped by category with the search box and filter tabs', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<DpeLibraryScreen />)

  expect(screen.getByLabelText('Search the question library')).toBeTruthy()
  expect(screen.getByText('All')).toBeTruthy()
  expect(screen.getByText('Favorites (0)')).toBeTruthy()
  expect(screen.getByText('Weather')).toBeTruthy()
  expect(screen.getByText('What is a METAR?')).toBeTruthy()
  // Collapsed by default -- the answer content isn't shown yet.
  expect(screen.queryByText('A routine aviation weather report.')).toBeNull()
})

it('expanding a question reveals its answer and records a last-viewed touch', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<DpeLibraryScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'What is a METAR?' }))
  })

  expect(screen.getByText('A routine aviation weather report.')).toBeTruthy()
  expect(mockTouchQuestionLastViewed).toHaveBeenCalledWith('u1', 'q1', false)
})

it('toggling the favorite star calls setQuestionFavorited and updates the Favorites count', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<DpeLibraryScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Add to favorites' }))
  })

  expect(mockSetQuestionFavorited).toHaveBeenCalledWith('u1', 'q1', true)
  expect(screen.getByText('Favorites (1)')).toBeTruthy()
})

it('marking a question as studied calls setQuestionStudied', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<DpeLibraryScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'What is a METAR?' }))
  })
  await act(async () => {
    fireEvent.press(screen.getByRole('checkbox', { name: 'Mark as studied' }))
  })

  expect(mockSetQuestionStudied).toHaveBeenCalledWith('u1', 'q1', true)
})

it('selecting the Favorites tab filters down to favorited questions only', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(
    libraryState({
      data: libraryData({
        questions: [
          libraryData().questions[0],
          { ...libraryData().questions[0], id: 'q2', question: 'What is a TAF?' },
        ],
        progress: { q2: { favorited: true, completed: false, last_viewed_at: null } },
      }),
    })
  )

  await render(<DpeLibraryScreen />)

  await act(async () => {
    fireEvent.press(screen.getByText('Favorites (1)'))
  })

  expect(screen.getByText('What is a TAF?')).toBeTruthy()
  expect(screen.queryByText('What is a METAR?')).toBeNull()
})
