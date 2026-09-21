// Phase 2 (Review Queue mobile): the Load -> Reveal -> Reinforced/Needs
// Another Pass controller for one Review Queue session. Mirrors
// useDpeSession.test.tsx's/useAdHocPracticeSession.test.tsx's mocking
// shape.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useReviewSession } from '../hooks/useReviewSession'

const mockFetchReviewQueue = jest.fn()
const mockRevealReviewItem = jest.fn()
const mockSubmitReviewOutcome = jest.fn()
jest.mock('../lib/api/reviewQueue', () => ({
  fetchReviewQueue: (...args: unknown[]) => mockFetchReviewQueue(...args),
  revealReviewItem: (...args: unknown[]) => mockRevealReviewItem(...args),
  submitReviewOutcome: (...args: unknown[]) => mockSubmitReviewOutcome(...args),
}))

let mockUuidCounter = 0
jest.mock('../lib/reviewIdempotencyKey', () => ({
  generateReviewIdempotencyKey: () => `key-${mockUuidCounter++}`,
}))

function queueFixture(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: 'item-1',
        source_type: 'dpe_question',
        source_id: 'q1',
        module_id: null,
        acs_category: 'airspace',
        reason: 'incorrect',
        priority: 3,
        review_count: 1,
        next_review_at: '2026-01-01T00:00:00Z',
        question: 'What class of airspace surrounds a Class B primary airport?',
      },
    ],
    ...overrides,
  }
}

describe('useReviewSession', () => {
  beforeEach(() => {
    mockUuidCounter = 0
    mockFetchReviewQueue.mockReset()
    mockRevealReviewItem.mockReset()
    mockSubmitReviewOutcome.mockReset()
  })

  it('never calls fetchReviewQueue while enabled is false', async () => {
    const { result } = await renderHook(() => useReviewSession({ enabled: false }))

    expect(mockFetchReviewQueue).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(true)
  })

  it('loads and builds a session from the due dpe_question items', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.total).toBe(1)
    expect(result.current.item?.reviewItemId).toBe('item-1')
  })

  it('a due list with zero eligible items builds an empty (total: 0) session, never an error', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture({ items: [] }))

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.total).toBe(0)
    expect(result.current.loadError).toBeNull()
  })

  it('surfaces a load error and retryLoad re-fetches', async () => {
    mockFetchReviewQueue.mockRejectedValueOnce(new Error('network blip'))
    mockFetchReviewQueue.mockResolvedValueOnce(queueFixture())

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loadError).not.toBeNull())

    await act(async () => {
      await result.current.retryLoad()
    })
    expect(result.current.loadError).toBeNull()
    expect(result.current.total).toBe(1)
  })

  it('reveal fetches content and sets revealed', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())
    mockRevealReviewItem.mockResolvedValue({
      review_item_id: 'item-1',
      model_answer: 'Class B.',
      common_mistakes: null,
      dpe_evaluating: null,
      real_world_application: null,
    })

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.reveal()
    })

    expect(mockRevealReviewItem).toHaveBeenCalledWith('item-1')
    expect(result.current.revealed).toBe(true)
    expect(result.current.revealContent?.model_answer).toBe('Class B.')
  })

  it('submitOutcome sends the item’s own minted idempotency key, then advances the session', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())
    mockSubmitReviewOutcome.mockResolvedValue({ review_item_id: 'item-1', outcome: 'reinforced', next_review_at: '2026-01-02T00:00:00Z', was_replay: false })

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.submitOutcome('reinforced')
    })

    expect(mockSubmitReviewOutcome).toHaveBeenCalledWith('item-1', 'reinforced', 'key-0')
    expect(result.current.reinforcedCount).toBe(1)
    expect(result.current.complete).toBe(true)
  })

  it('a failed submitOutcome surfaces submitError and does NOT advance the session', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())
    mockSubmitReviewOutcome.mockRejectedValue(new Error('network blip'))

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.submitOutcome('reinforced')
    })

    expect(result.current.submitError).not.toBeNull()
    expect(result.current.index).toBe(0)
    expect(result.current.reinforcedCount).toBe(0)
  })

  it('retrying a failed submission reuses the exact same idempotency key, never a freshly minted one', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())
    mockSubmitReviewOutcome.mockRejectedValueOnce(new Error('network blip'))
    mockSubmitReviewOutcome.mockResolvedValueOnce({ review_item_id: 'item-1', outcome: 'reinforced', next_review_at: '2026-01-02T00:00:00Z', was_replay: false })

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.submitOutcome('reinforced')
    })
    await act(async () => {
      await result.current.submitOutcome('reinforced')
    })

    expect(mockSubmitReviewOutcome).toHaveBeenNthCalledWith(1, 'item-1', 'reinforced', 'key-0')
    expect(mockSubmitReviewOutcome).toHaveBeenNthCalledWith(2, 'item-1', 'reinforced', 'key-0')
    expect(result.current.complete).toBe(true)
  })

  it('debounces concurrent submitOutcome calls into exactly one network request', async () => {
    mockFetchReviewQueue.mockResolvedValue(queueFixture())
    let resolveSubmit: (value: unknown) => void = () => {}
    mockSubmitReviewOutcome.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve
      })
    )

    const { result } = await renderHook(() => useReviewSession({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      result.current.submitOutcome('reinforced')
      result.current.submitOutcome('reinforced')
      await Promise.resolve()
    })

    expect(mockSubmitReviewOutcome).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmit({ review_item_id: 'item-1', outcome: 'reinforced', next_review_at: '2026-01-02T00:00:00Z', was_replay: false })
      await Promise.resolve()
    })
  })
})
