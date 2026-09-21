// Phase 3 (Ground School mobile): the scored self-assessment quiz
// controller -- client-side scoring against the already-delivered
// correct_choice/model_answer payload, mirroring
// site/portal-stable.js's wireModuleQuizSection() exactly.
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useModuleQuiz } from '../hooks/useModuleQuiz'
import type { MobileModuleQuizQuestion } from '../../shared/mobile-dto'

const mockSubmitModuleQuizAttempt = jest.fn()
const mockRecordGroundSchoolEvidence = jest.fn()
jest.mock('../lib/api/groundSchoolDirect', () => ({
  submitModuleQuizAttempt: (...args: unknown[]) => mockSubmitModuleQuizAttempt(...args),
  recordGroundSchoolEvidence: (...args: unknown[]) => mockRecordGroundSchoolEvidence(...args),
}))

const mockRefreshReadiness = jest.fn()
jest.mock('../lib/api/readiness', () => ({
  refreshReadiness: (...args: unknown[]) => mockRefreshReadiness(...args),
}))

const QUIZ: MobileModuleQuizQuestion[] = [
  { id: 'q1', question_type: 'multiple_choice', prompt: 'Q1?', choices: [{ key: 'A', label: 'Right' }, { key: 'B', label: 'Wrong' }], correct_choice: 'A', model_answer: 'A is right.' },
  { id: 'q2', question_type: 'multiple_choice', prompt: 'Q2?', choices: [{ key: 'A', label: 'Right' }, { key: 'B', label: 'Wrong' }], correct_choice: 'B', model_answer: 'B is right.' },
  { id: 'q3', question_type: 'short_answer', prompt: 'Explain something.', choices: null, correct_choice: null, model_answer: 'Model answer.' },
]

describe('useModuleQuiz', () => {
  beforeEach(() => {
    mockSubmitModuleQuizAttempt.mockReset()
    mockRecordGroundSchoolEvidence.mockReset()
    mockRecordGroundSchoolEvidence.mockResolvedValue(undefined)
    mockRefreshReadiness.mockReset()
    mockRefreshReadiness.mockResolvedValue({ snapshot: null, refreshed: true })
  })

  it('scores only multiple_choice questions, ignoring free text', async () => {
    mockSubmitModuleQuizAttempt.mockResolvedValue({ id: 'attempt-1' })
    const { result } = await renderHook(() => useModuleQuiz('u1', 'PPL', 'PPL-M03', QUIZ))

    await act(async () => {
      result.current.setAnswer('q1', 'A') // correct
      result.current.setAnswer('q2', 'A') // incorrect (correct is B)
      result.current.setAnswer('q3', 'Some free text')
    })

    await act(async () => {
      await result.current.submit()
    })

    expect(result.current.score).toBe(1)
    expect(result.current.total).toBe(2)
    expect(result.current.results).toEqual({ q1: true, q2: false })
    expect(mockSubmitModuleQuizAttempt).toHaveBeenCalledWith(
      'u1',
      'PPL',
      'PPL-M03',
      { q1: 'A', q2: 'A', q3: 'Some free text' },
      { q1: true, q2: false },
      1,
      2
    )
  })

  it('fires record_ground_school_evidence for every multiple_choice question, keyed by attemptId:questionId', async () => {
    mockSubmitModuleQuizAttempt.mockResolvedValue({ id: 'attempt-1' })
    const { result } = await renderHook(() => useModuleQuiz('u1', 'PPL', 'PPL-M03', QUIZ))

    await act(async () => {
      result.current.setAnswer('q1', 'A')
      result.current.setAnswer('q2', 'A') // incorrect -- correct_choice is 'B'
    })

    await act(async () => {
      await result.current.submit()
    })

    await waitFor(() => expect(mockRecordGroundSchoolEvidence).toHaveBeenCalledTimes(2))
    expect(mockRecordGroundSchoolEvidence).toHaveBeenCalledWith('u1', 'module_quiz_question', 'q1', 'attempt-1:q1', true, null)
    expect(mockRecordGroundSchoolEvidence).toHaveBeenCalledWith('u1', 'module_quiz_question', 'q2', 'attempt-1:q2', false, null)
  })

  it('refreshes readiness only after the evidence batch settles', async () => {
    mockSubmitModuleQuizAttempt.mockResolvedValue({ id: 'attempt-1' })
    const { result } = await renderHook(() => useModuleQuiz('u1', 'PPL', 'PPL-M03', QUIZ))

    await act(async () => {
      result.current.setAnswer('q1', 'A')
    })

    await act(async () => {
      await result.current.submit()
    })

    await waitFor(() => expect(mockRefreshReadiness).toHaveBeenCalledTimes(1))
  })

  it('marks submitted and never calls submit twice', async () => {
    mockSubmitModuleQuizAttempt.mockResolvedValue({ id: 'attempt-1' })
    const { result } = await renderHook(() => useModuleQuiz('u1', 'PPL', 'PPL-M03', QUIZ))

    await act(async () => {
      await result.current.submit()
    })
    expect(result.current.submitted).toBe(true)

    await act(async () => {
      await result.current.submit()
    })
    expect(mockSubmitModuleQuizAttempt).toHaveBeenCalledTimes(1)
  })

  it('surfaces a submit error and does not mark submitted on failure', async () => {
    mockSubmitModuleQuizAttempt.mockRejectedValue(new Error('network blip'))
    const { result } = await renderHook(() => useModuleQuiz('u1', 'PPL', 'PPL-M03', QUIZ))

    await act(async () => {
      await result.current.submit()
    })

    expect(result.current.submitted).toBe(false)
    expect(result.current.submitError).not.toBeNull()
  })
})
