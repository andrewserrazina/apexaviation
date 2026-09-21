import { useCallback, useEffect, useRef, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { dpeVerdictLabel } from '../../../components/oral/DebriefView'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useDpeHistory } from '../../../hooks/useDpeHistory'
import { startDpeSession } from '../../../lib/api/dpe'
import { ApiError, logDevError } from '../../../lib/api/errors'
import { loadActiveOralSession, saveActiveOralSession, type ActiveOralSession } from '../../../lib/activeOralSessionStorage'
import { colors, spacing } from '../../../constants/theme'

// Phase 1 (AI DPE mobile): the Oral hub -- entitlement-gated (same
// checkride_prep gate Practice uses), shows a "Continue Oral Practice"
// card when a local active-session pointer exists, a "Start Oral
// Practice" CTA otherwise/always, and recent session history with each
// session's readiness verdict. Mirrors app/(app)/practice/index.tsx's
// gating/active-session-pointer/focus-refresh shape.
export default function OralTabScreen() {
  const bootstrap = useBootstrapContext()
  const history = useDpeHistory({ enabled: bootstrap.ready && bootstrap.entitled })

  const [activeSession, setActiveSession] = useState<ActiveOralSession | null>(null)
  const [activeSessionLoaded, setActiveSessionLoaded] = useState(false)
  const activeLookupInFlight = useRef(false)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const startInFlight = useRef(false)

  const loadActive = useCallback(async () => {
    if (!bootstrap.ready || !bootstrap.entitled) {
      activeLookupInFlight.current = false
      setActiveSession(null)
      setActiveSessionLoaded(false)
      return
    }
    const uid = bootstrap.data?.user.id
    if (!uid) {
      activeLookupInFlight.current = false
      setActiveSession(null)
      setActiveSessionLoaded(true)
      return
    }
    activeLookupInFlight.current = true
    setActiveSessionLoaded(false)
    try {
      const stored = await loadActiveOralSession(uid)
      setActiveSession(stored)
    } finally {
      activeLookupInFlight.current = false
      setActiveSessionLoaded(true)
    }
  }, [bootstrap.ready, bootstrap.entitled, bootstrap.data?.user.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadActive()
  }, [loadActive])

  const hasFocusedOnce = useRef(false)
  const refreshRef = useRef({ historyRefresh: history.refresh, loadActive })
  useEffect(() => {
    refreshRef.current = { historyRefresh: history.refresh, loadActive }
  }, [history.refresh, loadActive])
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true
        return
      }
      refreshRef.current.historyRefresh()
      refreshRef.current.loadActive()
    }, [])
  )

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Oral Practice…" />
      </Screen>
    )
  }

  if (bootstrap.error || !bootstrap.data) {
    return (
      <Screen scroll={false}>
        <ErrorState message={bootstrap.error?.userMessage ?? 'We couldn’t load your account.'} onRetry={bootstrap.refresh} />
      </Screen>
    )
  }

  if (!bootstrap.entitled) {
    return (
      <Screen scroll={false}>
        <LockedState />
      </Screen>
    )
  }

  const disableStart = starting || !activeSessionLoaded || (activeSessionLoaded && !!activeSession)

  async function handleStart() {
    if (startInFlight.current || activeLookupInFlight.current || disableStart) return
    startInFlight.current = true
    setStarting(true)
    setStartError(null)
    try {
      const result = await startDpeSession()
      const record: ActiveOralSession = { sessionId: result.sessionId, userId: bootstrap.data!.user.id, startedAt: new Date().toISOString() }
      setActiveSession(record)
      setActiveSessionLoaded(true)
      try {
        await saveActiveOralSession(record)
      } catch {
        // Best-effort, matching activePracticeStorage's convention.
      }
      router.push({ pathname: '/(app)/oral/session/[sessionId]', params: { sessionId: result.sessionId } })
    } catch (err) {
      logDevError('Oral.handleStart', err)
      const apiErr = err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t start an oral practice session.' })
      setStartError(apiErr.userMessage)
    } finally {
      setStarting(false)
      startInFlight.current = false
    }
  }

  return (
    <Screen>
      <SectionHeader title="Oral Exam Prep" subtitle="Practice a simulated Private Pilot oral exam with an AI-assisted DPE" />

      {activeSessionLoaded && activeSession ? (
        <Card>
          <SectionHeader title="Continue Oral Practice" />
          <Button
            label="Continue →"
            onPress={() => router.push({ pathname: '/(app)/oral/session/[sessionId]', params: { sessionId: activeSession.sessionId } })}
          />
        </Card>
      ) : (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            Start a New Oral Practice Session
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            A text-based mock oral exam with an AI-assisted DPE persona. Answer questions the way you would out loud.
          </AppText>
          <Button label="Start Oral Practice" onPress={handleStart} loading={starting} disabled={disableStart} />
          {startError ? (
            <AppText variant="caption" color={colors.danger}>
              {startError}
            </AppText>
          ) : null}
        </Card>
      )}

      <View style={styles.section}>
        <SectionHeader title="Recent Sessions" />
        {history.loading ? (
          <LoadingState label="Loading history…" />
        ) : history.error ? (
          <ErrorState message={history.error.userMessage} onRetry={history.refresh} />
        ) : !history.data || history.data.sessions.length === 0 ? (
          <Card>
            <AppText variant="body" color={colors.mutedText}>
              Complete an oral practice session to see your history here.
            </AppText>
          </Card>
        ) : (
          history.data.sessions.map((session) => (
            <Card key={session.id}>
              <AppText variant="body" weight="semibold">
                {new Date(session.startedAt).toLocaleDateString()}
              </AppText>
              <AppText variant="caption" color={colors.mutedText}>
                {session.questionsAsked} questions asked
              </AppText>
              {session.debrief ? (
                <AppText variant="caption" weight="semibold" color={colors.navy}>
                  {dpeVerdictLabel(session.debrief.overallReadiness)}
                </AppText>
              ) : (
                <AppText variant="caption" color={colors.mutedText}>
                  {session.status === 'in_progress' ? 'In progress' : 'No debrief available'}
                </AppText>
              )}
            </Card>
          ))
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
})
