import { useState } from 'react'
import { router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { RevealContent } from '../../../components/RevealContent'
import { PracticeCompletionView } from '../../../components/PracticeCompletionView'
import { ReviewOutcomeButtons } from '../../../components/review/ReviewOutcomeButtons'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useReviewSession } from '../../../hooks/useReviewSession'
import type { ReviewOutcomeValue } from '../../../../shared/mobile-dto'
import { colors, spacing } from '../../../constants/theme'

// Phase 2 (Review Queue mobile): Load -> Question -> Reveal -> Reinforced/
// Needs Another Pass -> next item -> completion. No route param -- see
// useReviewSession.ts's own comment for why this screen fetches and
// builds its own session rather than receiving one via navigation.
export default function ReviewSessionScreen() {
  const bootstrap = useBootstrapContext()
  const enabled = bootstrap.ready && bootstrap.entitled
  const session = useReviewSession({ enabled })

  // Tracked here (not in the hook) purely so a failed submission's Retry
  // button knows which outcome to resubmit -- submitOutcome itself never
  // regenerates the item's idempotency key regardless of which layer
  // remembers the outcome value.
  const [pendingOutcome, setPendingOutcome] = useState<ReviewOutcomeValue | null>(null)

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

  if (session.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Building your review session…" />
      </Screen>
    )
  }

  if (session.loadError) {
    return (
      <Screen scroll={false}>
        <ErrorState message={session.loadError.userMessage} onRetry={session.retryLoad} />
      </Screen>
    )
  }

  if (session.total === 0) {
    return (
      <Screen scroll={false}>
        <Card>
          <AppText variant="body" color={colors.mutedText} center>
            You’re all caught up on reviews right now.
          </AppText>
          <Button label="Back to Review Queue" onPress={() => router.replace('/(app)/review')} />
        </Card>
      </Screen>
    )
  }

  if (session.complete) {
    return (
      <PracticeCompletionView
        title="Review Complete"
        scoreLine={`${session.reinforcedCount} / ${session.total} reinforced`}
        loading={false}
        progress={null}
        readiness={null}
        ctaLabel="Back to Review Queue"
        onCta={() => router.replace('/(app)/review')}
      />
    )
  }

  const item = session.item!

  async function handleChoose(outcome: ReviewOutcomeValue) {
    setPendingOutcome(outcome)
    await session.submitOutcome(outcome)
  }

  return (
    <Screen>
      <View style={styles.meta}>
        <AppText variant="caption" color={colors.mutedText}>
          {item.title} · Review {session.index + 1} / {session.total}
        </AppText>
      </View>

      <Card>
        <AppText variant="body">{item.prompt}</AppText>
      </Card>

      {session.revealed && session.revealContent ? (
        <>
          <RevealContent content={session.revealContent} />
          {session.submitError ? (
            <Card>
              <AppText variant="caption" color={colors.danger}>
                {session.submitError.userMessage}
              </AppText>
              <Button
                label="Retry"
                onPress={() => pendingOutcome && handleChoose(pendingOutcome)}
                loading={session.submitting}
                disabled={!pendingOutcome}
              />
            </Card>
          ) : (
            <ReviewOutcomeButtons disabled={session.submitting} onChoose={handleChoose} />
          )}
        </>
      ) : (
        <Button label="Reveal" onPress={session.reveal} loading={session.revealing} />
      )}
      {session.revealError ? (
        <AppText variant="caption" color={colors.danger}>
          {session.revealError.userMessage}
        </AppText>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  meta: { marginBottom: spacing.sm },
})
