import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGuidedNotes, upsertGuidedNote } from '../lib/api/groundSchoolDirect'
import { ApiError, logDevError } from '../lib/api/errors'

export interface GuidedNoteEntry {
  responseText: string
  updatedAt: string
}

const AUTOSAVE_DELAY_MS = 1500

// Batch-loads every guided_notes row for one module, then exposes a
// debounced (autosave, mirroring site/portal-stable.js's own 1.5s
// wireGuidedNoteTextCards timer) and an immediate save path -- callers
// use `saveNow` for one-click ratings/checkboxes (no debounce, same as
// web's rating click handler) and `saveDebounced` for free-text fields
// (paired with a manual Save button that also calls `saveNow` directly).
export function useGuidedNotes(profileId: string | null, courseId: string, moduleId: string, enabled: boolean) {
  const [existingByPrompt, setExistingByPrompt] = useState<Record<string, GuidedNoteEntry>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [savingPrompts, setSavingPrompts] = useState<Record<string, boolean>>({})
  const [saveErrors, setSaveErrors] = useState<Record<string, ApiError | null>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const load = useCallback(async () => {
    if (!enabled || !profileId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await fetchGuidedNotes(profileId, courseId, moduleId)
      const map: Record<string, GuidedNoteEntry> = {}
      rows.forEach((r) => {
        map[r.prompt_id] = { responseText: r.response_text, updatedAt: r.updated_at }
      })
      setExistingByPrompt(map)
    } catch (err) {
      logDevError('useGuidedNotes.load', err)
      setLoadError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your saved notes.' }))
    } finally {
      setLoading(false)
    }
  }, [profileId, courseId, moduleId, enabled])

  useEffect(() => {
    load()
  }, [load])

  const saveNow = useCallback(
    async (sectionId: string, promptId: string, responseText: string) => {
      if (!profileId) return
      setSavingPrompts((s) => ({ ...s, [promptId]: true }))
      setSaveErrors((s) => ({ ...s, [promptId]: null }))
      try {
        await upsertGuidedNote(profileId, courseId, moduleId, sectionId, promptId, responseText)
        setExistingByPrompt((m) => ({ ...m, [promptId]: { responseText, updatedAt: new Date().toISOString() } }))
      } catch (err) {
        logDevError('useGuidedNotes.saveNow', err)
        setSaveErrors((s) => ({
          ...s,
          [promptId]: err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'Could not save — try again.' }),
        }))
      } finally {
        setSavingPrompts((s) => ({ ...s, [promptId]: false }))
      }
    },
    [profileId, courseId, moduleId]
  )

  const saveDebounced = useCallback(
    (sectionId: string, promptId: string, responseText: string) => {
      if (timers.current[promptId]) clearTimeout(timers.current[promptId])
      timers.current[promptId] = setTimeout(() => {
        saveNow(sectionId, promptId, responseText)
      }, AUTOSAVE_DELAY_MS)
    },
    [saveNow]
  )

  // Cancel any pending autosave timers on unmount -- a screen navigated
  // away from must never fire a save against a component that's gone.
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(clearTimeout)
    }
  }, [])

  return { existingByPrompt, loading, loadError, retryLoad: load, saveNow, saveDebounced, savingPrompts, saveErrors }
}
