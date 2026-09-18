// ACS Explorer's task-level drill-down hook. mobile-readiness's 'tasks'
// action is a passive read (get_member_acs_task_breakdown() has no
// separate refresh) -- this hook must call fetchAcsTaskBreakdown, skip
// the network call entirely while `enabled` is false (a learner who
// hasn't expanded any category yet, or isn't entitled, must never
// generate a request), and never fabricate data on a failed fetch.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useAcsTaskBreakdown } from '../hooks/useAcsTaskBreakdown'
import { ApiError } from '../lib/api/errors'

const mockFetchAcsTaskBreakdown = jest.fn()
jest.mock('../lib/api/readiness', () => ({
  fetchAcsTaskBreakdown: (...args: unknown[]) => mockFetchAcsTaskBreakdown(...args),
}))

const TASKS = [
  {
    acs_task_id: 't1',
    area_code: 'I',
    area_title: 'Preflight Preparation',
    task_code: 'A',
    task_title: 'Pilot Qualifications',
    dpe_category: 'weather',
    applicable: true,
    content_available: true,
    evidence_summary: { attempt_count: 3, evidence_score: 0.8 },
  },
]

beforeEach(() => {
  mockFetchAcsTaskBreakdown.mockReset()
})

it('does not call fetchAcsTaskBreakdown while disabled', async () => {
  const { result } = await renderHook(() => useAcsTaskBreakdown({ enabled: false }))

  expect(mockFetchAcsTaskBreakdown).not.toHaveBeenCalled()
  expect(result.current.tasks).toEqual([])
  expect(result.current.loading).toBe(false)
})

it('fetches the task breakdown when enabled', async () => {
  mockFetchAcsTaskBreakdown.mockResolvedValue({ tasks: TASKS })

  const { result } = await renderHook(() => useAcsTaskBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(mockFetchAcsTaskBreakdown).toHaveBeenCalledTimes(1)
  expect(result.current.tasks).toEqual(TASKS)
  expect(result.current.error).toBeNull()
})

it('exposes a user-safe ApiError on failure, never a raw thrown error', async () => {
  mockFetchAcsTaskBreakdown.mockRejectedValue(new Error('raw postgres error'))

  const { result } = await renderHook(() => useAcsTaskBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.tasks).toEqual([])
  expect(result.current.error).toBeInstanceOf(ApiError)
  expect(result.current.error?.userMessage).not.toContain('raw postgres error')
})

it('passes through an existing ApiError from the client unchanged', async () => {
  const apiError = new ApiError({ kind: 'forbidden', userMessage: 'Checkride Prep is not unlocked on this account', status: 403 })
  mockFetchAcsTaskBreakdown.mockRejectedValue(apiError)

  const { result } = await renderHook(() => useAcsTaskBreakdown({ enabled: true }))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBe(apiError)
})

it('refetch() re-fetches via the same call', async () => {
  mockFetchAcsTaskBreakdown.mockResolvedValue({ tasks: TASKS })
  const { result } = await renderHook(() => useAcsTaskBreakdown({ enabled: true }))
  await waitFor(() => expect(result.current.loading).toBe(false))

  mockFetchAcsTaskBreakdown.mockClear()
  await act(async () => {
    await result.current.refetch()
  })

  expect(mockFetchAcsTaskBreakdown).toHaveBeenCalledTimes(1)
})
