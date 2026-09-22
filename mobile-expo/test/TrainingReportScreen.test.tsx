// Phase 5 (Training Report mobile): bootstrap gating (mirrors
// AcsExplorer.test.tsx's/ReviewQueueHub.test.tsx's own ordering exactly),
// the "complete some training first" empty state when the composer
// returns null, and that a populated report renders its fixed section
// order with empty sections omitted.
import { render, screen, fireEvent } from '@testing-library/react-native'
import TrainingReportScreen from '../app/(app)/training-report/index'

const mockRouterPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseReadinessBreakdown = jest.fn()
jest.mock('../hooks/useReadinessBreakdown', () => ({
  useReadinessBreakdown: (...args: unknown[]) => mockUseReadinessBreakdown(...args),
}))

const mockUseTrainingReportAggregates = jest.fn()
jest.mock('../hooks/useTrainingReportAggregates', () => ({
  useTrainingReportAggregates: (...args: unknown[]) => mockUseTrainingReportAggregates(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return { data: { user: { id: 'u1' } }, loading: false, error: null, refresh: jest.fn(), ready: true, entitled: true, ...overrides }
}

function hookState(overrides: Record<string, unknown> = {}) {
  return { data: null, loading: false, refreshing: false, error: null, refresh: jest.fn(), ...overrides }
}

function category(overrides: Record<string, unknown> = {}) {
  return {
    category: 'weather',
    label: 'Weather',
    score: 80,
    evidence_level: 'strong',
    attempt_volume: 12,
    task_breadth_pct: 100,
    assessable_task_count: 3,
    evidenced_task_count: 3,
    weak_task_count: 0,
    strong_task_count: 3,
    last_demonstrated_at: '2026-09-01T00:00:00Z',
    ai_dpe_reason_code: null,
    ...overrides,
  }
}

function readinessSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    overall_score: 75,
    coverage_score: 70,
    knowledge_score: 80,
    risk_management_score: 70,
    confidence_score: 60,
    evidence_level: 'moderate',
    weak_tasks: [],
    reason_codes: [],
    category_breakdown: [category()],
    algorithm_version: 'v3',
    computed_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function aggregatesData(overrides: Record<string, unknown> = {}) {
  return {
    ground_school: [],
    review_queue_due_count: 0,
    review_queue_due_categories: [],
    review_queue_completed_count: 0,
    ai_dpe_recent_session: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockRouterPush.mockReset()
  mockUseBootstrapContext.mockReset().mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReset().mockReturnValue(hookState({ data: readinessSnapshot() }))
  mockUseTrainingReportAggregates.mockReset().mockReturnValue(hookState({ data: aggregatesData() }))
})

it('shows a loading state while bootstrap has not resolved', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))

  await render(<TrainingReportScreen />)

  expect(screen.getByText('Loading your training report…')).toBeTruthy()
})

it('shows a locked state for an unentitled account', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ entitled: false }))

  await render(<TrainingReportScreen />)

  expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
})

it('shows a retryable error and refreshes both sources on retry', async () => {
  const refreshReadiness = jest.fn()
  const refreshAggregates = jest.fn()
  mockUseReadinessBreakdown.mockReturnValue(hookState({ error: { userMessage: 'Check your connection and try again.' }, refresh: refreshReadiness }))
  mockUseTrainingReportAggregates.mockReturnValue(hookState({ refresh: refreshAggregates }))

  await render(<TrainingReportScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refreshReadiness).toHaveBeenCalledTimes(1)
  expect(refreshAggregates).toHaveBeenCalledTimes(1)
})

it('shows an honest empty state when there is no readiness snapshot or aggregates yet', async () => {
  mockUseReadinessBreakdown.mockReturnValue(hookState({ data: null }))

  await render(<TrainingReportScreen />)

  expect(screen.getByText('Complete some training first -- your report builds itself from real evidence as you go.')).toBeTruthy()
})

it('renders the fixed section order with empty sections omitted, and routes an address row action', async () => {
  mockUseReadinessBreakdown.mockReturnValue(hookState({ data: readinessSnapshot({ category_breakdown: [category({ score: 40 })] }) }))
  mockUseTrainingReportAggregates.mockReturnValue(hookState({ data: aggregatesData({ review_queue_due_count: 2 }) }))

  await render(<TrainingReportScreen />)

  expect(screen.getByText('Knowledge & Oral Readiness')).toBeTruthy()
  expect(screen.getByText('Areas Needing Reinforcement')).toBeTruthy()
  expect(screen.getByText('Flight Proficiency Not Yet Tracked')).toBeTruthy()
  expect(screen.getByText('Evidence Summary')).toBeTruthy()
  // A weak, non-null-scored single category with zero attempts recorded
  // (assessable_task_count/evidenced_task_count both 3 in the fixture, so
  // this isn't the insufficient-evidence gate) never lands in Strongest.
  expect(screen.queryByText('Strongest Demonstrated Areas')).toBeNull()
  // No AI DPE session in this fixture.
  expect(screen.queryByText('AI Oral Practice')).toBeNull()

  expect(screen.getByText('2 Review Queue items due')).toBeTruthy()
  // buildAreasToAddress() always pushes the due-Review-Queue row first --
  // the first "Open" button on the screen is that row's action.
  fireEvent.press(screen.getAllByRole('button', { name: 'Open' })[0])
  expect(mockRouterPush).toHaveBeenCalledWith('/(app)/review')
})
