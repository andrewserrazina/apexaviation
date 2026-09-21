import { useCallback, useEffect, useRef } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useReviewQueue } from '../../../hooks/useReviewQueue'
import { colors } from '../../../constants/theme'

// Phase 2 (Review Queue mobile): entitlement-gated (same checkride_prep
// gate Practice/Oral use, since v1's only renderable source_type --
// dpe_question -- requires it on web too). Reached from the Practice
// tab's own card, mirroring web's dashboard widget rather than living on
// its own bottom tab (see app/(app)/_layout.tsx's comment). Shows a due
// count and a single Start Review action -- there is no per-session
// history here, matching web (Review Queue has no completed-session log,
// unlike Oral's Recent Sessions list).
export default function ReviewQueueTabScreen() {
  const bootstrap = useBootstrapContext()
  const queue = useReviewQueue({ enabled: bootstrap.ready && bootstrap.entitled })

  const hasFocusedOnce = useRef(false)
  const refreshRef = useRef(queue.refresh)
  useEffect(() => {
    refreshRef.current = queue.refresh
  }, [queue.refresh])
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true
        return
      }
      refreshRef.current()
    }, [])
  )

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Review Queue…" />
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

  // Phase 2 v1: only dpe_question-sourced items are renderable on mobile
  // (see shared/mobile-dto's MobileReviewItem comment) -- the due count
  // shown here is filtered to match exactly what Start Review can
  // actually walk through, never a count that includes items the session
  // screen would silently skip.
  const dueCount = (queue.data?.items ?? []).filter((it) => it.source_type === 'dpe_question').length

  return (
    <Screen>
      <SectionHeader title="Review Queue" subtitle="Spaced-repetition review of questions you missed or flagged" />

      {queue.loading ? (
        <LoadingState label="Checking your review queue…" />
      ) : queue.error ? (
        <ErrorState message={queue.error.userMessage} onRetry={queue.refresh} />
      ) : dueCount === 0 ? (
        <Card>
          <AppText variant="body" color={colors.mutedText}>
            You’re all caught up on reviews right now. Keep practicing and Apex will surface items here as they come due.
          </AppText>
        </Card>
      ) : (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            {dueCount} item{dueCount === 1 ? '' : 's'} ready
          </AppText>
          <Button label="Start Review" onPress={() => router.push('/(app)/review/session')} />
        </Card>
      )}
    </Screen>
  )
}
