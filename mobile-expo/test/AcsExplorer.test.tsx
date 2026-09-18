// The ACS tab replaces the old "coming soon" placeholder with a real
// per-category evidence/coverage breakdown, built entirely on the
// already-deployed mobile-readiness contract (category_breakdown --
// see shared/mobile-dto's own comment marking it as designed for
// exactly this future screen). These tests exercise its bootstrap
// gating (mirroring Practice's error-vs-locked ordering exactly),
// the honest empty state for a learner with no evidence yet, and that
// it renders the same four-value evidence vocabulary the web Readiness
// Detail view uses, never inventing a score for a null one.
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import AcsScreen from '../app/(app)/acs'

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseReadinessBreakdown = jest.fn()
jest.mock('../hooks/useReadinessBreakdown', () => ({
  useReadinessBreakdown: (...args: unknown[]) => mockUseReadinessBreakdown(...args),
}))

const mockUseAcsTaskBreakdown = jest.fn()
jest.mock('../hooks/useAcsTaskBreakdown', () => ({
  useAcsTaskBreakdown: (...args: unknown[]) => mockUseAcsTaskBreakdown(...args),
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

function readinessState(overrides: Record<string, unknown> = {}) {
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
    weak_task_count: 0,
    strong_task_count: 3,
    last_demonstrated_at: '2026-09-01T00:00:00Z',
    ai_dpe_reason_code: null,
    ...overrides,
  }
}

function taskBreakdownState(overrides: Record<string, unknown> = {}) {
  return { tasks: [], loading: false, error: null, refetch: jest.fn(), ...overrides }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    acs_task_id: 't1',
    area_code: 'I',
    area_title: 'Airport and Seaplane Base Operations',
    task_code: 'A',
    task_title: 'Preflight Weather Briefing',
    dpe_category: 'weather',
    applicable: true,
    content_available: true,
    evidence_summary: { attempt_count: 3, evidence_score: 0.8 },
    ...overrides,
  }
}

beforeEach(() => {
  mockUseBootstrapContext.mockReset()
  mockUseReadinessBreakdown.mockReset()
  mockUseAcsTaskBreakdown.mockReset()
  mockUseAcsTaskBreakdown.mockReturnValue(taskBreakdownState())
})

it('shows a loading state while bootstrap has not resolved, and never calls the readiness hook with enabled=true', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))
  mockUseReadinessBreakdown.mockReturnValue(readinessState())

  await render(<AcsScreen />)

  expect(screen.getByText('Loading ACS Explorer…')).toBeTruthy()
  expect(mockUseReadinessBreakdown).toHaveBeenCalledWith({ enabled: false })
})

// Sprint 1A Rev3 section 2's ordering rule (already proven for Practice/
// Library): a bootstrap failure must never be misrepresented as "not
// entitled."
it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
  const refresh = jest.fn()
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({ data: null, error: { userMessage: 'Check your connection and try again.' }, entitled: false, refresh })
  )
  mockUseReadinessBreakdown.mockReturnValue(readinessState())

  await render(<AcsScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  expect(screen.queryByText('Checkride Prep isn’t included on this account')).toBeNull()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('shows LockedState and never calls the readiness hook with enabled=true when the learner is not entitled', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ entitled: false }))
  mockUseReadinessBreakdown.mockReturnValue(readinessState())

  await render(<AcsScreen />)

  expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
  expect(mockUseReadinessBreakdown).toHaveBeenCalledWith({ enabled: false })
})

it('shows a loading state while the readiness fetch itself is loading', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(readinessState({ loading: true }))

  await render(<AcsScreen />)

  expect(screen.getByText('Loading ACS Explorer…')).toBeTruthy()
})

it('shows a retryable error and calls refresh on retry', async () => {
  const refresh = jest.fn()
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(readinessState({ error: { userMessage: 'Something went wrong on our end. Please try again in a moment.' }, refresh }))

  await render(<AcsScreen />)

  expect(screen.getByText('Something went wrong on our end. Please try again in a moment.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('shows an honest empty state for a learner with no snapshot yet, not a blank list', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(readinessState({ data: null }))

  await render(<AcsScreen />)

  expect(screen.getByText('No ACS evidence yet')).toBeTruthy()
  expect(screen.getByText('Complete a practice session to see your first ACS coverage breakdown.')).toBeTruthy()
})

it('shows the same empty state for a snapshot whose category_breakdown is empty (legacy pre-v3 shape), never a blank screen', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [], assessable_task_count: null, evidenced_task_count: null } })
  )

  await render(<AcsScreen />)

  expect(screen.getByText('No ACS evidence yet')).toBeTruthy()
})

it('renders a category with real evidence using the exact web evidence-sufficiency vocabulary', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )

  await render(<AcsScreen />)

  expect(screen.getByText('Weather')).toBeTruthy()
  expect(screen.getByText('STRONG EVIDENCE')).toBeTruthy()
  expect(screen.getByText('Score: 80%')).toBeTruthy()
  expect(screen.getByText('3 tasks demonstrated strong')).toBeTruthy()
  expect(screen.getByText('10 of 19 assessable ACS tasks have evidence')).toBeTruthy()
})

it('never fabricates a score for a category with no evidence -- shows the honest message instead', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({
      data: {
        category_breakdown: [
          category({ score: null, evidence_level: 'none', strong_task_count: 0, weak_task_count: 0, last_demonstrated_at: null }),
        ],
        assessable_task_count: 19,
        evidenced_task_count: 0,
      },
    })
  )

  await render(<AcsScreen />)

  expect(screen.getByText('INSUFFICIENT EVIDENCE')).toBeTruthy()
  expect(screen.getByText('Not enough evidence yet to show a score.')).toBeTruthy()
  expect(screen.queryByText(/Score: 0%/)).toBeNull()
})

it('surfaces a weak-task-count category distinctly from a strong one', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({
      data: {
        category_breakdown: [category({ label: 'Emergency Operations', category: 'emergency', evidence_level: 'developing', score: 45, weak_task_count: 2, strong_task_count: 0 })],
        assessable_task_count: 19,
        evidenced_task_count: 5,
      },
    })
  )

  await render(<AcsScreen />)

  expect(screen.getByText('DEVELOPING')).toBeTruthy()
  expect(screen.getByText('2 tasks need reinforcement')).toBeTruthy()
})

// V142: task-level drill-down. The task hook must stay disabled (never
// fire a request) until a learner actually expands a category -- opening
// the ACS tab and merely glancing at the rollup must never generate a
// mobile-readiness 'tasks' call.
it('never enables the task hook until a category is expanded', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )

  await render(<AcsScreen />)

  expect(mockUseAcsTaskBreakdown).toHaveBeenCalledWith({ enabled: false })
  expect(screen.queryByText('Preflight Weather Briefing')).toBeNull()
})

it('expands a category on tap, enables the task hook, and renders its matching tasks', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(
    taskBreakdownState({ tasks: [task(), task({ acs_task_id: 't2', dpe_category: 'airspace', task_title: 'Airspace Classification' })] })
  )

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(mockUseAcsTaskBreakdown).toHaveBeenLastCalledWith({ enabled: true })
  expect(screen.getByText('Preflight Weather Briefing')).toBeTruthy()
  expect(screen.getByText('3 attempts • Evidence: 80%')).toBeTruthy()
  expect(screen.queryByText('Airspace Classification')).toBeNull()
})

it('collapses an expanded category on a second tap, hiding its tasks', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(taskBreakdownState({ tasks: [task()] }))

  await render(<AcsScreen />)

  const toggle = screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ })
  await act(async () => {
    fireEvent.press(toggle)
  })
  expect(screen.getByText('Preflight Weather Briefing')).toBeTruthy()

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Collapse to see its individual tasks\./ }))
  })
  expect(screen.queryByText('Preflight Weather Briefing')).toBeNull()
})

it('shows a gap message for a task with no content mapped, never a fabricated evidence line', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(
    taskBreakdownState({ tasks: [task({ content_available: false, evidence_summary: null })] })
  )

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(screen.getByText('No Apex content mapped to this task yet.')).toBeTruthy()
  expect(screen.queryByText('No evidence yet.')).toBeNull()
})

it('shows "no evidence yet" for a task with content but no attempts, never a fabricated zero', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(taskBreakdownState({ tasks: [task({ evidence_summary: null })] }))

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(screen.getByText('No evidence yet.')).toBeTruthy()
})

it('shows a loading state for the task list while it is fetching', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(taskBreakdownState({ loading: true }))

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(screen.getByText('Loading tasks…')).toBeTruthy()
})

it('shows a retryable error for the task list, calling refetch on retry', async () => {
  const refetch = jest.fn()
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(
    taskBreakdownState({ error: { userMessage: 'We couldn’t load that ACS category’s tasks.' }, refetch })
  )

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(screen.getByText('We couldn’t load that ACS category’s tasks.')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refetch).toHaveBeenCalledTimes(1)
})

it('shows an empty message when a category has no scoped tasks', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockUseReadinessBreakdown.mockReturnValue(
    readinessState({ data: { category_breakdown: [category()], assessable_task_count: 19, evidenced_task_count: 10 } })
  )
  mockUseAcsTaskBreakdown.mockReturnValue(taskBreakdownState({ tasks: [] }))

  await render(<AcsScreen />)

  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: /Weather\. Expand to see its individual tasks\./ }))
  })

  expect(screen.getByText('No tasks found for this category.')).toBeTruthy()
})
