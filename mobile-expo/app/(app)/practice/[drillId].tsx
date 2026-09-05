import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { ProgressIndicator } from '../../../components/ProgressIndicator'
import { RevealContent } from '../../../components/RevealContent'
import { RatingButtons } from '../../../components/RatingButtons'
import { ErrorState, LoadingState, EmptyState } from '../../../components/StateViews'
import { useDrillSession } from '../../../hooks/useDrillSession'
import { usePostCompleteRefresh } from '../../../hooks/usePostCompleteRefresh'
import { colors, spacing } from '../../../constants/theme'

export default function DrillSessionScreen() {
  const { drillId } = useLocalSearchParams<{ drillId: string }>()
  const session = useDrillSession(drillId)

  if (session.starting) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Starting today’s drill…" />
      </Screen>
    )
  }

  if (session.startError) {
    return (
      <Screen scroll={false}>
        <ErrorState message={session.startError.userMessage} onRetry={session.retryStart} />
      </Screen>
    )
  }

  // Sprint 1A section 9: a completed drill is never restarted -- this
  // renders a summary state instead of the question flow, whether the
  // learner completed it moments ago (session.completeResult is set) or
  // is simply revisiting an already-done drill from a previous day.
  if (session.drillStatus === 'completed' && !session.completeResult) {
    return (
      <Screen scroll={false}>
        <EmptyState
          title="This drill is already complete"
          message="Nice work -- check Home for your next drill."
          actionLabel="Back to Home"
          onAction={() => router.replace('/(app)')}
        />
      </Screen>
    )
  }

  if (session.completeResult) {
    return <CompletionScreen score={session.completeResult.score} total={session.completeResult.total} />
  }

  if (!session.currentQuestion || session.total === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="No questions available" message="This drill has no questions to practice right now." />
      </Screen>
    )
  }

  const isFinalRatedQuestion = session.isLastQuestion && session.currentRating !== null

  return (
    <Screen>
      <ProgressIndicator current={session.currentIndex + 1} total={session.total} />

      <Card>
        {session.currentQuestion.category ? (
          <AppText variant="label" weight="semibold" color={colors.goldDeep}>
            {session.currentQuestion.category.toUpperCase()}
          </AppText>
        ) : null}
        <AppText variant="subtitle" weight="semibold">
          {session.currentQuestion.question}
        </AppText>
      </Card>

      {!session.isRevealed ? (
        <Button
          label="Reveal Answer"
          onPress={session.reveal}
          loading={session.revealing}
          accessibilityHint="Show the model answer after you've answered out loud"
        />
      ) : null}

      {session.revealError ? <ErrorState message={session.revealError.userMessage} onRetry={session.reveal} /> : null}

      {session.isRevealed && session.revealContent ? (
        <>
          <RevealContent content={session.revealContent} />

          <View style={styles.ratingBlock}>
            <AppText variant="subtitle" weight="semibold">
              How did you do?
            </AppText>
            <RatingButtons value={session.currentRating} onChange={session.rate} />
          </View>

          {session.completeError ? <ErrorState message={session.completeError.userMessage} onRetry={session.complete} /> : null}

          <Button
            label={isFinalRatedQuestion ? 'Complete Drill' : 'Next'}
            onPress={isFinalRatedQuestion ? session.complete : session.goNext}
            disabled={session.currentRating === null}
            loading={isFinalRatedQuestion && session.completing}
          />
        </>
      ) : null}
    </Screen>
  )
}

function CompletionScreen({ score, total }: { score: number; total: number }) {
  const { loading, progress, readiness } = usePostCompleteRefresh(true)

  return (
    <Screen scroll={false}>
      <View style={styles.completionWrap}>
        <AppText variant="display" heading weight="bold" center>
          Drill Complete
        </AppText>
        <AppText variant="subtitle" color={colors.mutedText} center>
          {score} of {total} correct
        </AppText>

        {loading ? (
          <LoadingState label="Updating your progress…" />
        ) : (
          <Card>
            {progress ? (
              <AppText variant="body" center>
                {progress.xp} XP • {progress.current_streak} day streak
              </AppText>
            ) : null}
            {readiness ? (
              <AppText variant="caption" color={colors.mutedText} center>
                Readiness indicator updated -- {readiness.evidence_level} evidence
              </AppText>
            ) : null}
          </Card>
        )}

        <Button label="Back to Home" onPress={() => router.replace('/(app)')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  ratingBlock: { gap: spacing.sm },
  completionWrap: { flex: 1, justifyContent: 'center', gap: spacing.lg },
})
