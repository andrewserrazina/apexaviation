// Phase 3 (Ground School mobile): batch-load + debounced/immediate
// guided_notes upsert. Mirrors useDpeSession.test.tsx's mocking shape.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useGuidedNotes } from '../hooks/useGuidedNotes'

const mockFetchGuidedNotes = jest.fn()
const mockUpsertGuidedNote = jest.fn()
jest.mock('../lib/api/groundSchoolDirect', () => ({
  fetchGuidedNotes: (...args: unknown[]) => mockFetchGuidedNotes(...args),
  upsertGuidedNote: (...args: unknown[]) => mockUpsertGuidedNote(...args),
}))

describe('useGuidedNotes', () => {
  beforeEach(() => {
    mockFetchGuidedNotes.mockReset()
    mockUpsertGuidedNote.mockReset()
    mockUpsertGuidedNote.mockResolvedValue(undefined)
  })

  it('never calls fetchGuidedNotes while enabled is false', async () => {
    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', false))

    expect(mockFetchGuidedNotes).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('loads existing rows keyed by prompt_id', async () => {
    mockFetchGuidedNotes.mockResolvedValue([
      { module_id: 'PPL-M01', section_id: 'objectives', prompt_id: 'obj-1', response_text: 'checked', updated_at: '2026-01-01T00:00:00Z' },
    ])

    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetchGuidedNotes).toHaveBeenCalledWith('u1', 'PPL', 'PPL-M01')
    expect(result.current.existingByPrompt['obj-1'].responseText).toBe('checked')
  })

  it('surfaces a load error and retryLoad re-fetches', async () => {
    mockFetchGuidedNotes.mockRejectedValueOnce(new Error('network blip'))
    mockFetchGuidedNotes.mockResolvedValueOnce([])

    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', true))
    await waitFor(() => expect(result.current.loadError).not.toBeNull())

    await act(async () => {
      await result.current.retryLoad()
    })
    expect(result.current.loadError).toBeNull()
  })

  it('saveNow writes immediately and updates local state on success', async () => {
    mockFetchGuidedNotes.mockResolvedValue([])
    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.saveNow('objectives', 'obj-1', 'checked')
    })

    expect(mockUpsertGuidedNote).toHaveBeenCalledWith('u1', 'PPL', 'PPL-M01', 'objectives', 'obj-1', 'checked')
    expect(result.current.existingByPrompt['obj-1'].responseText).toBe('checked')
    expect(result.current.savingPrompts['obj-1']).toBe(false)
  })

  it('saveNow surfaces a per-prompt error on failure without crashing other prompts', async () => {
    mockFetchGuidedNotes.mockResolvedValue([])
    mockUpsertGuidedNote.mockRejectedValue(new Error('network blip'))
    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.saveNow('objectives', 'obj-1', 'checked')
    })

    expect(result.current.saveErrors['obj-1']).not.toBeNull()
  })

  it('saveDebounced waits before writing, and a second call within the window resets the timer', async () => {
    jest.useFakeTimers()
    mockFetchGuidedNotes.mockResolvedValue([])
    const { result } = await renderHook(() => useGuidedNotes('u1', 'PPL', 'PPL-M01', true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.saveDebounced('guided-notes', 'gn-1', 'First draft')
    })
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(mockUpsertGuidedNote).not.toHaveBeenCalled()

    act(() => {
      result.current.saveDebounced('guided-notes', 'gn-1', 'Final draft')
    })
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(mockUpsertGuidedNote).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(600)
    })
    expect(mockUpsertGuidedNote).toHaveBeenCalledTimes(1)
    expect(mockUpsertGuidedNote).toHaveBeenCalledWith('u1', 'PPL', 'PPL-M01', 'guided-notes', 'gn-1', 'Final draft')

    jest.useRealTimers()
  })
})
