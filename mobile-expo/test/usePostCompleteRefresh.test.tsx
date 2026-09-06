// Sprint 1A Rev3 section 4: mobile-readiness's `latest` action never
// recomputes -- only `refresh` does. A genuinely new Daily Drill
// completion must trigger a real recompute (refreshReadiness), while an
// idempotent replay (already_completed: true) must not generate an
// unnecessary duplicate snapshot (fetchLatestReadiness is sufficient).
import { renderHook, waitFor } from '@testing-library/react-native'
import { usePostCompleteRefresh } from '../hooks/usePostCompleteRefresh'

const mockFetchBootstrap = jest.fn()
const mockFetchLatestReadiness = jest.fn()
const mockRefreshReadiness = jest.fn()

jest.mock('../lib/api/bootstrap', () => ({
  fetchBootstrap: (...args: unknown[]) => mockFetchBootstrap(...args),
}))
jest.mock('../lib/api/readiness', () => ({
  fetchLatestReadiness: (...args: unknown[]) => mockFetchLatestReadiness(...args),
  refreshReadiness: (...args: unknown[]) => mockRefreshReadiness(...args),
}))

const BOOTSTRAP_PROGRESS = { xp: 500, current_rank: 'Solo Pilot', current_streak: 3, longest_streak: 8, readiness_summary: null }
const OLD_SNAPSHOT = { overall_score: 40, evidence_level: 'low' as const, reason_codes: [], coverage_score: 0, knowledge_score: 0, risk_management_score: 0, confidence_score: 0, weak_tasks: [], algorithm_version: 'v3', computed_at: '2026-01-01T00:00:00Z' }
const NEW_SNAPSHOT = { ...OLD_SNAPSHOT, overall_score: 70, evidence_level: 'moderate' as const, computed_at: '2026-01-02T00:00:00Z' }

describe('usePostCompleteRefresh', () => {
  beforeEach(() => {
    mockFetchBootstrap.mockReset().mockResolvedValue({ progress: BOOTSTRAP_PROGRESS })
    mockFetchLatestReadiness.mockReset().mockResolvedValue({ snapshot: OLD_SNAPSHOT, refreshed: false })
    mockRefreshReadiness.mockReset().mockResolvedValue({ snapshot: NEW_SNAPSHOT, refreshed: true })
  })

  it('a genuinely new completion (alreadyCompleted=false) recomputes readiness via refresh, not latest', async () => {
    const { result } = await renderHook(() => usePostCompleteRefresh(true, false))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockRefreshReadiness).toHaveBeenCalledTimes(1)
    expect(mockFetchLatestReadiness).not.toHaveBeenCalled()
    expect(result.current.readiness).toEqual(NEW_SNAPSHOT)
  })

  it('sequences refreshReadiness before fetchBootstrap for a new completion, so bootstrap can never observe stale readiness', async () => {
    const { result } = await renderHook(() => usePostCompleteRefresh(true, false))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const refreshOrder = mockRefreshReadiness.mock.invocationCallOrder[0]
    const bootstrapOrder = mockFetchBootstrap.mock.invocationCallOrder[0]
    expect(refreshOrder).toBeLessThan(bootstrapOrder)
  })

  it('an idempotent replay (alreadyCompleted=true) uses latest, never generating a duplicate recompute', async () => {
    const { result } = await renderHook(() => usePostCompleteRefresh(true, true))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockFetchLatestReadiness).toHaveBeenCalledTimes(1)
    expect(mockRefreshReadiness).not.toHaveBeenCalled()
    expect(result.current.readiness).toEqual(OLD_SNAPSHOT)
  })

  it('surfaces bootstrap progress alongside the recomputed readiness for a new completion', async () => {
    const { result } = await renderHook(() => usePostCompleteRefresh(true, false))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.progress).toEqual(BOOTSTRAP_PROGRESS)
  })
})
