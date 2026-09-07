import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../../components/Screen'
import { AppText } from '../../../../components/AppText'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import { ProgressIndicator } from '../../../../components/ProgressIndicator'
import { RevealContent } from '../../../../components/RevealContent'
import { RatingButtons } from '../../../../components/RatingButtons'
import { PracticeCompletionView } from '../../../../components/PracticeCompletionView'
import { ErrorState, LoadingState, EmptyState, LockedState } from '../../../../components/StateViews'
import { useAdHocPracticeSession } from '../../../../hooks/useAdHocPracticeSession'
import { usePostCompleteRefresh } from '../../../../hooks/usePostCompleteRefresh'
import { useBootstrapContext } from '../../../../contexts/BootstrapContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { colors, spacing } from '../../../../constants/theme'

// Sprint 1B.1: ad-hoc practice (Quick / Standard / Weak Area) session
// screen. This route ALWAYS resumes an already-created server session --
// the Practice hub is the only place a new ad-hoc session is ever
// started (section 6: "Do not create a new session inside this route").
// That gives a fresh app launch (Continue Practice -> here) and a normal
// in-app navigation (Start -> here) the exact same initialization path:
// resume, restore local ratings, require a fresh Reveal.
//
// `title` is an optional route param set by the Practice hub when it
// navigates here (e.g. "Quick Practice", "Weak Area Practice • I.A") --
// purely a display label, never treated as authoritative session state
// (section 2). A direct deep link that arrives without it (no prior
// Practice-hub navigation in this session) falls back to a generic
// header; the server's resume response is what actually drives
// everything else on this screen.
export default function AdHocPracticeSessionScreen() {
  const { sessionId, title } = useLocalSearchParams<{ sessionId: string; title?: string }>()
  const bootstrap = useBootstrapContext()
  const { user } = useAuth()

  // Section 13: this screen must obey the SAME bootstrap gating as the
  // Practice hub, since it can be reached directly (a deep link, or a
  // cold-started app resuming its last route) without ever passing
  // through the hub's own gating first. `enabled` only ever becomes true
  // once bootstrap has resolved and confirmed entitlement -- no premium
  // resume call fires before then, and none fires at all if bootstrap
  // failed or the learner isn't entitled.
  const enabled = bootstrap.ready && !bootstrap.error && !!bootstrap.data && bootstrap.entitled
  const session = useAdHocPracticeSession(sessionId, { enabled, userId: user?.id ?? null })

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Practice…" />
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

  const headerLabel = title || 'Practice Session'

  if (session.resuming) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Resuming your practice session…" />
      </Screen>
    )
  }

  if (session.resumeError) {
    // Section 12: a permanent (non-resumable) failure gets an explicit
    // recovery action, "Remove Saved Session," alongside Retry -- never
    // just a dead-end disabled state. A transient failure (network/server
    // hiccup) only ever offers Retry -- clearing a perfectly valid local
    // pointer on a momentary failure would strand the learner's real,
    // still-resumable server session for no reason.
    return (
      <Screen scroll={false}>
        <View style={styles.errorWrap}>
          <ErrorState message={session.resumeError.userMessage} onRetry={session.retryResume} />
          {session.resumeErrorKind === 'permanent' ? (
            <Button
              label="Remove Saved Session"
              variant="ghost"
              onPress={async () => {
                await session.removeSavedSession()
                router.replace('/(app)/practice')
              }}
              accessibilityHint="Clears this saved practice session from your device only -- it does not affect any server record"
            />
          ) : null}
        </View>
      </Screen>
    )
  }

  if (session.alreadyCompletedOnResume) {
    return (
      <Screen scroll={false}>
        <EmptyState
          title="This practice session is already complete"
          message="Nice work -- head back to Practice to start a new session."
          actionLabel="Back to Practice"
          onAction={() => router.replace('/(app)/practice')}
        />
      </Screen>
    )
  }

  if (session.completeResult) {
    return (
      <AdHocCompletionScreen
        title={headerLabel}
        score={session.completeResult.score}
        total={session.completeResult.total}
        alreadyCompleted={session.completeResult.alreadyCompleted}
      />
    )
  }

  if (!session.currentQuestion || session.total === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="No questions available" message="This practice session has no questions to practice right now." />
      </Screen>
    )
  }

  const isFinalRatedQuestion = session.isLastQuestion && session.currentRating !== null

  return (
    <Screen>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        {headerLabel.toUpperCase()}
      </AppText>
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
            label={isFinalRatedQuestion ? 'Complete Practice' : 'Next'}
            onPress={isFinalRatedQuestion ? session.complete : session.goNext}
            disabled={session.currentRating === null}
            loading={isFinalRatedQuestion && session.completing}
          />
        </>
      ) : null}
    </Screen>
  )
}

// Reuses PracticeCompletionView -- the exact same completion experience
// Daily Drill's physical-device pass verified (section 10: "Do not
// duplicate a second readiness algorithm or XP display system"). Only
// the title and CTA differ: ad-hoc completion returns to Practice, never
// to Home, since this was never Today's Drill.
function AdHocCompletionScreen({
  title,
  score,
  total,
  alreadyCompleted,
}: {
  title: string
  score: number
  total: number
  alreadyCompleted: boolean
}) {
  const { loading, progress, readiness } = usePostCompleteRefresh(true, alreadyCompleted)

  return (
    <PracticeCompletionView
      title="Practice Complete"
      scoreLine={`You marked ${score} of ${total} correct in ${title}`}
      loading={loading}
      progress={progress}
      readiness={readiness}
      ctaLabel="Back to Practice"
      onCta={() => router.replace('/(app)/practice')}
    />
  )
}

const styles = StyleSheet.create({
  ratingBlock: { gap: spacing.sm },
  errorWrap: { gap: spacing.md, padding: spacing.lg },
})
