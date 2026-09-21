import { useCallback, useEffect, useState } from 'react'
import type { MobileModuleCompanionContent, MobileModuleQuizQuestion } from '../../shared/mobile-dto'
import { fetchGroundSchoolContent } from '../lib/api/groundSchool'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseGroundSchoolContentOptions {
  moduleId: string
  // Must stay false until the catalog has confirmed this module is
  // unlocked -- mirrors useLibraryContent's own gate. The server
  // independently re-checks entitlement on every content request
  // regardless (mobile-ground-school's own requireModuleAccess-equivalent
  // check), so a stale/incorrect locally-cached unlocked=true still fails
  // closed via the 403 branch below rather than ever rendering privileged
  // content.
  enabled: boolean
}

interface UseGroundSchoolContentResult {
  content: MobileModuleCompanionContent | null
  quiz: MobileModuleQuizQuestion[]
  contentVersion: string | null
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

export function useGroundSchoolContent({ moduleId, enabled }: UseGroundSchoolContentOptions): UseGroundSchoolContentResult {
  const [content, setContent] = useState<MobileModuleCompanionContent | null>(null)
  const [quiz, setQuiz] = useState<MobileModuleQuizQuestion[]>([])
  const [contentVersion, setContentVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !moduleId) {
      setContent(null)
      setQuiz([])
      setContentVersion(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchGroundSchoolContent(moduleId)
      setContent(result.content)
      setQuiz(result.quiz)
      setContentVersion(result.content_version)
    } catch (err) {
      logDevError('useGroundSchoolContent', err)
      setContent(null)
      setQuiz([])
      setContentVersion(null)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load this module.' }))
    } finally {
      setLoading(false)
    }
  }, [moduleId, enabled])

  useEffect(() => {
    load()
  }, [load])

  return { content, quiz, contentVersion, loading, error, refetch: load }
}
