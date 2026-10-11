import { useCallback, useEffect, useState } from 'react'
import type { MobileDailyQuestion } from '../../shared/mobile-dto'
import { fetchDailyQuestion } from '../lib/api/dailyQuestion'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseDailyQuestionOptions {
  // Deliberately gated on bootstrap readiness only, NEVER on
  // bootstrap.entitled -- get_daily_question() is a free preview with no
  // checkride_prep_unlocked check, matching web's own QOTD (GATED_
  // SECTIONS exemption). A free account must see this.
  enabled: boolean
}

interface UseDailyQuestionResult {
  question: MobileDailyQuestion | null
  loading: boolean
  error: ApiError | null
  retry: () => void
}

export function useDailyQuestion({ enabled }: UseDailyQuestionOptions): UseDailyQuestionResult {
  const [question, setQuestion] = useState<MobileDailyQuestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetchDailyQuestion()
      setQuestion(result)
    } catch (err) {
      logDevError('useDailyQuestion', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load today’s question.' }))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  return { question, loading, error, retry: load }
}
