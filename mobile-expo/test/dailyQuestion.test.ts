// Mobile parity (Phase 5, item 4): fetchDailyQuestion() against a
// mocked supabase.rpc -- exercises the REAL client code (shape
// validation included), not a re-implementation of it. Mirrors
// test/apiClient.test.ts's own supabase-mocking convention.
const mockRpc = jest.fn()
jest.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}))

import { fetchDailyQuestion } from '../lib/api/dailyQuestion'
import { ApiError } from '../lib/api/errors'

function row(overrides: Record<string, unknown> = {}) {
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

describe('fetchDailyQuestion', () => {
  beforeEach(() => mockRpc.mockReset())

  it('calls get_daily_question with the private_pilot exam type by default', async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null })
    await fetchDailyQuestion()
    expect(mockRpc).toHaveBeenCalledWith('get_daily_question', { p_exam_type: 'private_pilot' })
  })

  it('returns the mapped question on success', async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null })
    const result = await fetchDailyQuestion()
    expect(result).toEqual({
      id: 'q1',
      question: 'What is a METAR?',
      model_answer: 'A routine aviation weather report.',
      dpe_evaluating: 'Whether you know how to interpret current conditions.',
      real_world_application: 'Used for preflight weather briefings.',
      category: 'weather',
      category_label: 'Weather',
    })
  })

  it('passes through null dpe_evaluating/real_world_application rather than requiring them', async () => {
    mockRpc.mockResolvedValue({ data: [row({ dpe_evaluating: null, real_world_application: null })], error: null })
    const result = await fetchDailyQuestion()
    expect(result?.dpe_evaluating).toBeNull()
    expect(result?.real_world_application).toBeNull()
  })

  it('returns null (not an error) when the bank is empty for this exam type', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchDailyQuestion()).resolves.toBeNull()
  })

  it('throws a safe ApiError on an RPC error, never a raw Postgres message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'relation "dpe_questions" does not exist' } })
    await expect(fetchDailyQuestion()).rejects.toBeInstanceOf(ApiError)
    await expect(fetchDailyQuestion()).rejects.toMatchObject({ userMessage: expect.not.stringMatching(/relation|postgres/i) })
  })

  it('throws a safe ApiError on a malformed row rather than returning garbage', async () => {
    mockRpc.mockResolvedValue({ data: [row({ model_answer: 42 })], error: null })
    await expect(fetchDailyQuestion()).rejects.toBeInstanceOf(ApiError)
  })
})
