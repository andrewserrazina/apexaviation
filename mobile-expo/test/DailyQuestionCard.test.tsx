// Mobile parity (Phase 5, item 4): DailyQuestionCard render-level
// coverage, against mocked API modules (not a source scan).
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { DailyQuestionCard } from '../components/DailyQuestionCard'
import { ApiError } from '../lib/api/errors'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}))

const mockSetQuestionFavorited = jest.fn()
const mockSetQuestionStudied = jest.fn()
const mockTouchQuestionLastViewed = jest.fn()
jest.mock('../lib/api/dpeLibraryDirect', () => ({
  setQuestionFavorited: (...args: unknown[]) => mockSetQuestionFavorited(...args),
  setQuestionStudied: (...args: unknown[]) => mockSetQuestionStudied(...args),
  touchQuestionLastViewed: (...args: unknown[]) => mockTouchQuestionLastViewed(...args),
}))

const mockEnsureStudyActivityToday = jest.fn()
jest.mock('../lib/api/studyActivityDirect', () => ({
  ensureStudyActivityToday: (...args: unknown[]) => mockEnsureStudyActivityToday(...args),
}))

// StateViews.tsx's ErrorState path is used directly by this component,
// and StateViews.tsx also imports CheckridePrepPaywall (for its own
// LockedState export) -- which otherwise pulls in the real
// BootstrapContext -> ... -> AsyncStorage chain, same AsyncStorage-
// avoidance reasoning as every other mock in this suite.
jest.mock('../hooks/useCheckridePrepPurchase', () => ({
  useCheckridePrepPurchase: () => ({
    state: 'idle',
    product: null,
    errorMessage: null,
    purchase: jest.fn(),
    restore: jest.fn(),
  }),
}))
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => ({ data: null, refresh: jest.fn() }),
}))

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    question: 'What is a METAR?',
    model_answer: 'A routine aviation weather report.',
    dpe_evaluating: 'Whether you know how to interpret current conditions.',
    real_world_application: 'Used for preflight weather briefings.',
    category: 'weather',
    category_label: 'Weather',
    ...overrides,
  }
}

beforeEach(() => {
  mockPush.mockReset()
  mockSetQuestionFavorited.mockReset().mockResolvedValue(undefined)
  mockSetQuestionStudied.mockReset().mockResolvedValue(undefined)
  mockTouchQuestionLastViewed.mockReset().mockResolvedValue(undefined)
  mockEnsureStudyActivityToday.mockReset().mockResolvedValue(undefined)
})

it('shows a loading state', async () => {
  await render(<DailyQuestionCard profileId="u1" question={null} loading error={null} onRetry={jest.fn()} entitled={false} />)
  expect(screen.getByText('Loading today’s question…')).toBeTruthy()
})

it('shows a retryable error state', async () => {
  const onRetry = jest.fn()
  await render(
    <DailyQuestionCard
      profileId="u1"
      question={null}
      loading={false}
      error={new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' })}
      onRetry={onRetry}
      entitled={false}
    />
  )
  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('renders nothing when there is no question, no loading, and no error', async () => {
  await render(<DailyQuestionCard profileId="u1" question={null} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)
  expect(screen.queryByText('Question of the Day')).toBeNull()
})

it('shows the question collapsed, with the answer hidden until revealed', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)

  expect(screen.getByText('What is a METAR?')).toBeTruthy()
  expect(screen.queryByText('A routine aviation weather report.')).toBeNull()
})

it('revealing the answer touches last-viewed and ensures a study-activity row for today', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Answer' }))
  })

  expect(screen.getByText('A routine aviation weather report.')).toBeTruthy()
  expect(mockTouchQuestionLastViewed).toHaveBeenCalledWith('u1', 'q1', false)
  expect(mockEnsureStudyActivityToday).toHaveBeenCalledWith('u1')
})

it('toggling the favorite star calls setQuestionFavorited', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Add to favorites' }))
  })

  expect(mockSetQuestionFavorited).toHaveBeenCalledWith('u1', 'q1', true)
})

it('marking as studied calls setQuestionStudied, only after reveal', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Answer' }))
  })
  await act(async () => {
    fireEvent.press(screen.getByRole('checkbox', { name: 'Mark as studied' }))
  })

  expect(mockSetQuestionStudied).toHaveBeenCalledWith('u1', 'q1', true)
})

it('never shows "Another Round" for a free (unentitled) account', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled={false} />)
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Answer' }))
  })
  expect(screen.queryByText('Another Round →')).toBeNull()
})

it('"Another Round" for an entitled account navigates to Practice', async () => {
  await render(<DailyQuestionCard profileId="u1" question={question()} loading={false} error={null} onRetry={jest.fn()} entitled />)
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Reveal Answer' }))
  })
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Another Round →' }))
  })
  expect(mockPush).toHaveBeenCalledWith('/(app)/practice')
})
