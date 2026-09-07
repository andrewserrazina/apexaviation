import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { ProgressIndicator } from '../../../components/ProgressIndicator'
import { RevealContent } from '../../../components/RevealContent'
import { RatingButtons } from '../../../components/RatingButtons'
import { PracticeCompletionView } from '../../../components/PracticeCompletionView'
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

// Physical-device fix (unchanged by the Sprint 1B.1 refactor below): this
// screen previously used `<Screen scroll={false}>` with a `flex: 1,
// justifyContent: 'center'` wrapper, relying on Screen's non-scrolling
// branch to hand that wrapper a bounded full-screen height to center
// within. On a real iPhone that inner View did not actually stretch --
// see Screen.tsx's own fix -- so the whole card visibly collapsed/
// clipped. Rendering through the shared, scrolling PracticeCompletionView
// (see that file) removes the fragile centering assumption entirely.
//
// Sprint 1B.1: this is now a thin wrapper around PracticeCompletionView,
// the same completion component ad-hoc practice (Quick/Standard/Weak
// Area) uses -- title/score-line/CTA are parameterized, but the rendered
// output for Daily Drill is byte-for-byte identical to before this
// refactor (see test/DrillCompletion.test.tsx, unchanged).
function CompletionScreen({ score, total, alreadyCompleted }: { score: number; total: number; alreadyCompleted: boolean }) {
  const { loading, progress, readiness } = usePostCompleteRefresh(true, alreadyCompleted)

  return (
    <PracticeCompletionView
      title="Drill Complete"
      // Self-rated, not objectively graded -- "marked" says that
      // honestly rather than implying the system scored an oral response
      // (Sprint 1A Rev2 section 5).
      scoreLine={`You marked ${score} of ${total} correct`}
      loading={loading}
      progress={progress}
      readiness={readiness}
      ctaLabel="Back to Home"
      onCta={() => router.replace('/(app)')}
    />
  )
}

const styles = StyleSheet.create({
  ratingBlock: { gap: spacing.sm },
})
