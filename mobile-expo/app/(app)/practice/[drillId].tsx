import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { ProgressIndicator } from '../../../components/ProgressIndicator'
import { RevealContent } from '../../../components/RevealContent'
import { RatingButtons } from '../../../components/RatingButtons'
import { ReadinessCard } from '../../../components/ReadinessCard'
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
    return (
      <CompletionScreen
        score={session.completeResult.score}
        total={session.completeResult.total}
        alreadyCompleted={session.completeResult.alreadyCompleted}
      />
    )
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

// Physical-device fix: this screen previously used `<Screen scroll=
// {false}>` with a `flex: 1, justifyContent: 'center'` wrapper, relying
// on Screen's non-scrolling branch to hand that wrapper a bounded full-
// screen height to center within. On a real iPhone (unlike this
// project's test renderer) that inner View did not actually stretch --
// see Screen.tsx's own fix -- so the whole card visibly collapsed/
// clipped. Rendering as a normal SCROLLING Screen (the default) removes
// the fragile centering assumption entirely and, per this fix's explicit
// guidance, is also the more robust choice for smaller phones, larger
// Dynamic Type, and longer readiness reason-code content -- none of
// which need to fit inside one fixed viewport anymore.
function CompletionScreen({ score, total, alreadyCompleted }: { score: number; total: number; alreadyCompleted: boolean }) {
  const { loading, progress, readiness } = usePostCompleteRefresh(true, alreadyCompleted)

  return (
    <Screen>
      <AppText variant="display" heading weight="bold" center>
        Drill Complete
      </AppText>
      {/* Self-rated, not objectively graded -- "marked" says that
          honestly rather than implying the system scored an oral
          response (Sprint 1A Rev2 section 5). */}
      <AppText variant="subtitle" color={colors.mutedText} center>
        You marked {score} of {total} correct
      </AppText>

      {loading ? (
        <LoadingState label="Updating your progress…" />
      ) : (
        <>
          {progress ? (
            <Card>
              <AppText variant="body" center>
                {progress.xp} XP • {progress.current_streak} day streak
              </AppText>
            </Card>
          ) : null}
          {readiness ? (
            <ReadinessCard
              overallScore={readiness.overall_score}
              evidenceLevel={readiness.evidence_level}
              reasonCodes={readiness.reason_codes}
            />
          ) : null}
        </>
      )}

      <Button label="Back to Home" onPress={() => router.replace('/(app)')} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  ratingBlock: { gap: spacing.sm },
})
