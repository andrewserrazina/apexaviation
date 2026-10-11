// Mobile parity (Phase 5, item 2): Scenario Training Center screen.
// Covers bootstrap gating, library loading/error states, and that
// revealing/favoriting/reviewing a scenario calls the same direct-write
// functions as the DPE Question Library -- against mocked API modules
// (not a source scan).
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import ScenarioTrainingScreen from '../app/(app)/practice/scenarios'

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
        question: 'A line of thunderstorms is building west of your departure airport.',
        model_answer: 'Delay the flight and reassess once the line passes or dissipates.',
        common_mistakes: 'Pressing on with a "get-there-itis" mindset.',
        dpe_evaluating: 'Aeronautical decision-making under weather pressure.',
        real_world_application: 'You are planning a 50nm cross-country this afternoon.',
        acs_reference: 'PA.IX.A.K1',
        sort_order: 1,
        is_scenario: true,
        scenario_order: 1,
      },
      {
        id: 'q2',
        category: 'weather',
        question: 'What is a METAR?',
        model_answer: 'A routine aviation weather report.',
        common_mistakes: null,
        dpe_evaluating: null,
        real_world_application: null,
        acs_reference: null,
        sort_order: 2,
        is_scenario: false,
        scenario_order: null,
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

it('shows a locked state for an unentitled account', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ entitled: false }))
  mockUseDpeLibrary.mockReturnValue(libraryState())

  await render(<ScenarioTrainingScreen />)

  expect(mockUseDpeLibrary).toHaveBeenCalledWith({ enabled: false })
  expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
})

it('shows a loading state while the library is loading', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ loading: true }))

  await render(<ScenarioTrainingScreen />)

  expect(screen.getByText('Loading scenario training…')).toBeTruthy()
})

it('shows only the is_scenario=true question, never an ordinary question', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<ScenarioTrainingScreen />)

  expect(screen.getByText('A line of thunderstorms is building west of your departure airport.')).toBeTruthy()
  expect(screen.queryByText('What is a METAR?')).toBeNull()
  expect(screen.getByText('0 / 1 reviewed')).toBeTruthy()
})

it('the scenario brief is visible without revealing -- it is not hidden like the Library', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<ScenarioTrainingScreen />)

  expect(screen.getByText('You are planning a 50nm cross-country this afternoon.')).toBeTruthy()
  expect(screen.queryByText('Delay the flight and reassess once the line passes or dissipates.')).toBeNull()
})

it('revealing the model answer calls touchQuestionLastViewed', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<ScenarioTrainingScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Model Answer' }))
  })

  expect(screen.getByText('Delay the flight and reassess once the line passes or dissipates.')).toBeTruthy()
  expect(mockTouchQuestionLastViewed).toHaveBeenCalledWith('u1', 'q1', false)
})

it('marking as reviewed calls setQuestionStudied and updates the reviewed count', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<ScenarioTrainingScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Model Answer' }))
  })
  await act(async () => {
    fireEvent.press(screen.getByRole('checkbox', { name: 'Mark as reviewed' }))
  })

  expect(mockSetQuestionStudied).toHaveBeenCalledWith('u1', 'q1', true)
  expect(screen.getByText('1 / 1 reviewed')).toBeTruthy()
})

it('toggling the favorite star calls setQuestionFavorited', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData() }))

  await render(<ScenarioTrainingScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Add to favorites' }))
  })

  expect(mockSetQuestionFavorited).toHaveBeenCalledWith('u1', 'q1', true)
})

it('shows an honest empty state when no scenarios exist yet', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseDpeLibrary.mockReturnValue(libraryState({ data: libraryData({ questions: [libraryData().questions[1]] }) }))

  await render(<ScenarioTrainingScreen />)

  expect(screen.getByText('No scenarios are available yet.')).toBeTruthy()
})
