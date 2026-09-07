import { useCallback, useEffect, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { TodaysDrillCard } from '../../../components/TodaysDrillCard'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useDailyDrill } from '../../../hooks/useDailyDrill'
import { startAdHocPractice } from '../../../lib/api/practice'
import { ApiError, logDevError } from '../../../lib/api/errors'
import {
  loadActivePracticeSession,
  saveActivePracticeSession,
  type ActivePracticeSession,
  type AdHocPracticeKind,
} from '../../../lib/activePracticeStorage'
import { loadDrillProgress } from '../../../lib/drillProgressStorage'
import { colors, spacing } from '../../../constants/theme'
import type { MobileAcsTaskRef } from '../../../../shared/mobile-dto'

type WeakArea = MobileAcsTaskRef & { evidence_score: number }

interface StartErrorState {
  kind: AdHocPracticeKind
  acsTaskId?: string
  message: string
}

function buildAdHocTitle(kind: AdHocPracticeKind, area?: WeakArea): string {
  if (kind === 'quick') return 'Quick Practice'
  if (kind === 'standard') return 'Standard Practice'
  return `Weak Area Practice • ${area?.area_code}.${area?.task_code}`
}

export default function PracticeTabScreen() {
  const bootstrap = useBootstrapContext()
  const { data: drillData, loading: drillLoading, error: drillError, refetch: drillRefetch } = useDailyDrill({
    enabled: bootstrap.ready && bootstrap.entitled,
  })

  const [activeSession, setActiveSession] = useState<ActivePracticeSession | null>(null)
  const [activeProgress, setActiveProgress] = useState<{ rated: number; total: number } | null>(null)
  const [activeSessionLoaded, setActiveSessionLoaded] = useState(false)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<StartErrorState | null>(null)
  const startInFlight = useRef(false)
  // Rev3 focus-race fix: the hub stays MOUNTED underneath the nested Stack
  // while the learner is on the ad-hoc session route -- it isn't
  // remounted on Back, so a fresh AsyncStorage lookup runs on every focus
  // return (below), not just on first mount. `activeSessionLoaded`
  // (render state) already gates the disabled buttons, but React state
  // updates aren't visible until the NEXT render -- a same-frame gap
  // still existed between "the lookup started" and "the render that
  // reflects activeSessionLoaded=false actually committed." This ref is
  // the synchronous guard handleStart checks directly, closing that gap
  // regardless of render timing.
  const activeLookupInFlight = useRef(false)

  // The entitlement/readiness gate lives INSIDE this callback (matching
  // useDailyDrill's own `load` shape) rather than in the effect body
  // below, which stays a bare, unconditional call -- calling setState
  // from inside a conditional directly in an effect body is the exact
  // "derived state" shape React's own lint rule flags as a cascading-
  // render risk.
  const loadActive = useCallback(async () => {
    if (!bootstrap.ready || !bootstrap.entitled) {
      activeLookupInFlight.current = false
      setActiveSession(null)
      setActiveProgress(null)
      setActiveSessionLoaded(false)
      return
    }
    const uid = bootstrap.data?.user.id
    if (!uid) {
      activeLookupInFlight.current = false
      setActiveSession(null)
      setActiveProgress(null)
      setActiveSessionLoaded(true)
      return
    }
    // Rev3 focus-race fix: mark the lookup in flight -- both the ref
    // (synchronous, checked directly by handleStart) and the render state
    // (activeSessionLoaded=false, which the disabled-button computation
    // reads) -- BEFORE awaiting AsyncStorage. Every call into this branch
    // re-enters "unknown" state first, whether it's the initial mount or
    // a focus-return re-check on a hub that never remounted.
    activeLookupInFlight.current = true
    setActiveSessionLoaded(false)
    try {
      const stored = await loadActivePracticeSession(uid)
      setActiveSession(stored)
      if (stored) {
        const progress = await loadDrillProgress(stored.sessionId)
        setActiveProgress({ rated: progress ? Object.keys(progress.ratings).length : 0, total: stored.sessionSize })
      } else {
        setActiveProgress(null)
      }
    } finally {
      activeLookupInFlight.current = false
      setActiveSessionLoaded(true)
    }
  }, [bootstrap.ready, bootstrap.entitled, bootstrap.data?.user.id])

  useEffect(() => {
    // Same established shape as useDailyDrill.ts/useHomeDrill.ts's own
    // `useEffect(() => { load() }, [load])` -- this codebase's react-
    // hooks lint config's newer set-state-in-effect rule flags every one
    // of those pre-existing hooks identically; this is not a problem
    // newly introduced by Sprint 1B.1, and fixing that repo-wide lint
    // debt is out of this narrow feature's scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadActive()
  }, [loadActive])

  // Section 14: refresh bootstrap, today's drill, and the local
  // active-session pointer whenever Practice regains focus (e.g. the
  // learner taps "Back to Practice" after completing an ad-hoc session),
  // so Continue Practice disappears, updated weak areas can appear, and
  // Today's Drill stays current -- without a manual pull-to-refresh.
  // Skips the very first focus (everything already loaded on mount),
  // matching Home's own Rev2 section 8 pattern exactly. Never starts
  // Daily Drill or any ad-hoc practice automatically.
  const hasFocusedOnce = useRef(false)
  const refreshRef = useRef({ bootstrap: bootstrap.refresh, drillRefetch, loadActive })
  useEffect(() => {
    refreshRef.current = { bootstrap: bootstrap.refresh, drillRefetch, loadActive }
  }, [bootstrap.refresh, drillRefetch, loadActive])
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true
        return
      }
      refreshRef.current.bootstrap()
      refreshRef.current.drillRefetch()
      refreshRef.current.loadActive()
    }, [])
  )

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Practice…" />
      </Screen>
    )
  }

  // Rev3 section 2: a bootstrap failure (network/server error, or a
  // resolved-but-dataless state) must never be misrepresented as "not
  // entitled" -- `bootstrap.entitled` defaults to false whenever
  // `bootstrap.data` is null, which is exactly the shape a failed
  // bootstrap call has. This check must come BEFORE the entitlement
  // check below, matching Home's own ordering, so a learner who is
  // actually entitled but hit a transient bootstrap failure sees a
  // retryable error, never the permanent-sounding locked-access copy.
  if (bootstrap.error || !bootstrap.data) {
    return (
      <Screen scroll={false}>
        <ErrorState message={bootstrap.error?.userMessage ?? 'We couldn’t load your account.'} onRetry={bootstrap.refresh} />
      </Screen>
    )
  }

  // Sprint 1A Rev2 section 3: an unentitled learner sees an intentional
  // locked state here too, never a retryable "premium API failed" error,
  // and never generates a mobile-daily-drill or mobile-practice request.
  if (!bootstrap.entitled) {
    return (
      <Screen scroll={false}>
        <LockedState />
      </Screen>
    )
  }

  const weakAreas: WeakArea[] = (bootstrap.data.home.weak_areas ?? []).slice(0, 3)
  const hasActiveAdHoc = activeSessionLoaded && !!activeSession
  // Rev2 blocker 1: the per-user active-session pointer lookup
  // (loadActive(), above) is itself async -- while it's still pending,
  // `hasActiveAdHoc` is false not because no session exists, but because
  // we simply don't know yet. Enabling Start during that window let a
  // learner who already has an unfinished session create a second,
  // orphaned one before the lookup resolved. New ad-hoc Starts now stay
  // disabled until the lookup has actually completed, whatever it finds;
  // Today's Drill is unaffected -- it has its own, independent resume
  // mechanism and was never gated on this pointer.
  const disableNewAdHoc = starting || !activeSessionLoaded || hasActiveAdHoc

  async function handleStart(kind: AdHocPracticeKind, sessionSize: number, area?: WeakArea) {
    // Rev3 focus-race fix: activeLookupInFlight.current is the same
    // synchronous ref loadActive() sets BEFORE its first await -- checking
    // it here (not just the render-state-derived disableNewAdHoc) closes
    // the same-frame gap between a focus-triggered lookup starting and
    // the re-render that reflects it actually committing.
    if (startInFlight.current || activeLookupInFlight.current || disableNewAdHoc) return
    startInFlight.current = true
    setStarting(true)
    setStartError(null)
    const title = buildAdHocTitle(kind, area)
    try {
      const result = await startAdHocPractice(area ? { acs_task_id: area.acs_task_id, session_size: sessionSize } : { session_size: sessionSize })
      const record: ActivePracticeSession = {
        sessionId: result.session_id,
        userId: bootstrap.data!.user.id,
        kind,
        title,
        startedAt: result.started_at,
        sessionSize: result.questions.length,
        ...(area ? { acsTaskId: area.acs_task_id, areaCode: area.area_code, taskCode: area.task_code } : {}),
      }
      // Rev3 fix B: publish the new session into the hub's own in-memory
      // state BEFORE navigating -- the hub stays mounted underneath the
      // nested Stack while the learner is on the session route, so if
      // they immediately hit Back before AsyncStorage persistence (or the
      // navigation transition itself) finishes, the hub already knows a
      // session exists rather than briefly showing a no-active-session
      // state. This is in addition to, not instead of, the persisted
      // pointer -- if the process dies before persistence completes, the
      // documented best-effort local-storage limitation still applies;
      // this fix only protects the running app's own in-memory state.
      setActiveSession(record)
      setActiveProgress({ rated: 0, total: record.sessionSize })
      setActiveSessionLoaded(true)
      try {
        await saveActivePracticeSession(record)
      } catch {
        // Section 7: best-effort. The server session is still valid and
        // navigation continues regardless of whether this local write
        // succeeded.
      }
      router.push({ pathname: '/(app)/practice/session/[sessionId]', params: { sessionId: result.session_id, title } })
    } catch (err) {
      logDevError('Practice.handleStart', err)
      const apiErr = err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t start that practice session.' })
      // Section 1E: a targeted (weak-area) Start that 404s for lack of
      // eligible content shows a friendly inline message and creates
      // nothing -- no crash, no navigation, no local active-session
      // record (never reached, since the throw above skips the save).
      setStartError({ kind, acsTaskId: area?.acs_task_id, message: apiErr.userMessage })
    } finally {
      setStarting(false)
      startInFlight.current = false
    }
  }

  return (
    <Screen>
      <SectionHeader title="Practice" subtitle="Today's curated drill, plus on-demand oral-exam practice" />

      {drillLoading ? (
        <LoadingState label="Loading today’s drill…" />
      ) : drillError || !drillData ? (
        <ErrorState message={drillError?.userMessage ?? 'We couldn’t load today’s drill.'} onRetry={drillRefetch} />
      ) : (
        <TodaysDrillCard
          status={drillData.drill.status}
          estimatedMinutes={drillData.drill.estimated_minutes}
          targetAcsTasks={drillData.drill.target_acs_tasks}
          onPress={() => router.push({ pathname: '/(app)/practice/[drillId]', params: { drillId: drillData.drill.id } })}
        />
      )}

      {hasActiveAdHoc && activeSession ? (
        <Card>
          <SectionHeader title="Continue Practice" />
          <AppText variant="body" weight="semibold">
            {activeSession.title}
          </AppText>
          {activeProgress ? (
            <AppText variant="caption" color={colors.mutedText}>
              {activeProgress.rated} of {activeProgress.total} rated
            </AppText>
          ) : null}
          <Button
            label="Continue →"
            onPress={() =>
              router.push({
                pathname: '/(app)/practice/session/[sessionId]',
                params: { sessionId: activeSession.sessionId, title: activeSession.title },
              })
            }
          />
        </Card>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="On-Demand Practice" />

        <Card>
          <AppText variant="subtitle" weight="semibold">
            Quick Practice
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            5 questions • ~5 minutes
          </AppText>
          <Button
            label="Start Quick Practice"
            onPress={() => handleStart('quick', 5)}
            loading={starting}
            disabled={disableNewAdHoc}
            accessibilityHint="Start a 5-question ad-hoc practice session"
          />
          {startError && startError.kind === 'quick' ? (
            <AppText variant="caption" color={colors.danger}>
              {startError.message}
            </AppText>
          ) : null}
        </Card>

        <Card>
          <AppText variant="subtitle" weight="semibold">
            Standard Practice
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            10 questions • ~10 minutes
          </AppText>
          <Button
            label="Start Standard Practice"
            onPress={() => handleStart('standard', 10)}
            loading={starting}
            disabled={disableNewAdHoc}
            accessibilityHint="Start a 10-question ad-hoc practice session"
          />
          {startError && startError.kind === 'standard' ? (
            <AppText variant="caption" color={colors.danger}>
              {startError.message}
            </AppText>
          ) : null}
        </Card>

        {!activeSessionLoaded ? (
          <AppText variant="caption" color={colors.mutedText}>
            Checking for an existing practice session…
          </AppText>
        ) : hasActiveAdHoc ? (
          <AppText variant="caption" color={colors.mutedText}>
            Finish your current practice session before starting another.
          </AppText>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Practice Your Weak Areas" subtitle="Server-computed from your recent practice" />

        {weakAreas.length === 0 ? (
          <Card>
            <AppText variant="body" color={colors.mutedText}>
              Complete more practice and Apex will identify areas worth targeting.
            </AppText>
          </Card>
        ) : (
          weakAreas.map((area) => (
            <Card key={area.acs_task_id}>
              <AppText variant="subtitle" weight="semibold">
                {area.area_code}.{area.task_code}
              </AppText>
              <AppText variant="caption" color={colors.mutedText}>
                Evidence: {Math.round(area.evidence_score * 100)}%
              </AppText>
              <Button
                label={`Practice ${area.area_code}.${area.task_code}`}
                onPress={() => handleStart('weak_area', 5, area)}
                loading={starting}
                disabled={disableNewAdHoc}
                accessibilityHint={`Start a targeted practice session for ACS task ${area.area_code}.${area.task_code}`}
              />
              {startError && startError.kind === 'weak_area' && startError.acsTaskId === area.acs_task_id ? (
                <AppText variant="caption" color={colors.danger}>
                  {startError.message}
                </AppText>
              ) : null}
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
