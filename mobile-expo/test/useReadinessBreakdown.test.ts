// ACS Explorer's data hook. mobile-readiness's 'latest' action is a
// passive read that never recomputes -- this hook must call fetchLatestReadiness
// (never refreshReadiness), skip the network call entirely while
// `enabled` is false (an unentitled learner opening the ACS tab must
// never generate a mobile-readiness request), and never fabricate data
// on a failed fetch.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useReadinessBreakdown } from '../hooks/useReadinessBreakdown'
import { ApiError } from '../lib/api/errors'

const mockFetchLatestReadiness = jest.fn()
jest.mock('../lib/api/readiness', () => ({
  fetchLatestReadiness: (...args: unknown[]) => mockFetchLatestReadiness(...args),
}))

const SNAPSHOT = {
  overall_score: 62,
  coverage_score: 50,
  knowledge_score: 60,
  risk_management_score: 70,
  confidence_score: 55,
  evidence_level: 'moderate' as const,
  weak_tasks: [],
  reason_codes: [],
  category_breakdown: [
    {
      category: 'weather',
      label: 'Weather',
      score: 80,
      evidence_level: 'strong' as const,
      attempt_volume: 12,
      task_breadth_pct: 100,
      weak_task_count: 0,
      strong_task_count: 3,
      last_demonstrated_at: '2026-09-01T00:00:00Z',
      ai_dpe_reason_code: null,
    },
  ],
  algorithm_version: 'v3',
  computed_at: '2026-09-01T00:00:00Z',
  assessable_task_count: 19,
  evidenced_task_count: 10,
  strong_task_count: 3,
  weak_task_count: 0,
}

beforeEach(() => {
  mockFetchLatestReadiness.mockReset()
})

it('does not call fetchLatestReadiness while disabled', async () => {
  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: false }))

  expect(mockFetchLatestReadiness).not.toHaveBeenCalled()
  expect(result.current.data).toBeNull()
  expect(result.current.loading).toBe(false)
})

it('fetches the latest snapshot (never a recompute) when enabled', async () => {
  mockFetchLatestReadiness.mockResolvedValue({ snapshot: SNAPSHOT, refreshed: false })

  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(mockFetchLatestReadiness).toHaveBeenCalledTimes(1)
  expect(result.current.data).toEqual(SNAPSHOT)
  expect(result.current.error).toBeNull()
})

it('surfaces a null snapshot honestly rather than treating it as an error', async () => {
  mockFetchLatestReadiness.mockResolvedValue({ snapshot: null, refreshed: false })

  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).toBeNull()
  expect(result.current.error).toBeNull()
})

it('exposes a user-safe ApiError on failure, never a raw thrown error', async () => {
  mockFetchLatestReadiness.mockRejectedValue(new Error('raw postgres error'))

  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).toBeNull()
  expect(result.current.error).toBeInstanceOf(ApiError)
  expect(result.current.error?.userMessage).not.toContain('raw postgres error')
})

it('passes through an existing ApiError from the client unchanged', async () => {
  const apiError = new ApiError({ kind: 'forbidden', userMessage: 'Checkride Prep is not unlocked on this account', status: 403 })
  mockFetchLatestReadiness.mockRejectedValue(apiError)

  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBe(apiError)
})

it('refresh() re-fetches via the same passive latest call, sets refreshing not loading', async () => {
  mockFetchLatestReadiness.mockResolvedValue({ snapshot: SNAPSHOT, refreshed: false })
  const { result } = await renderHook(() => useReadinessBreakdown({ enabled: true }))
  await waitFor(() => expect(result.current.loading).toBe(false))

  mockFetchLatestReadiness.mockClear()
  await act(async () => {
    await result.current.refresh()
  })

  expect(mockFetchLatestReadiness).toHaveBeenCalledTimes(1)
  expect(result.current.refreshing).toBe(false)
})
