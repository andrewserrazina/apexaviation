import { router } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { TodaysDrillCard } from '../../../components/TodaysDrillCard'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useDailyDrill } from '../../../hooks/useDailyDrill'
import { colors } from '../../../constants/theme'

export default function PracticeTabScreen() {
  const bootstrap = useBootstrapContext()
  const { data, loading, error, refetch } = useDailyDrill({ enabled: bootstrap.ready && bootstrap.entitled })

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
  // and never generates a mobile-daily-drill request.
  if (!bootstrap.entitled) {
    return (
      <Screen scroll={false}>
        <LockedState />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title="Practice" subtitle="Today's curated drill, built from your training context" />

      {loading ? (
        <LoadingState label="Loading today’s drill…" />
      ) : error || !data ? (
        <ErrorState message={error?.userMessage ?? 'We couldn’t load today’s drill.'} onRetry={refetch} />
      ) : (
        <TodaysDrillCard
          status={data.drill.status}
          estimatedMinutes={data.drill.estimated_minutes}
          targetAcsTasks={data.drill.target_acs_tasks}
          onPress={() => router.push({ pathname: '/(app)/practice/[drillId]', params: { drillId: data.drill.id } })}
        />
      )}

      <Card>
        <AppText variant="subtitle" weight="semibold">
          More practice modes are coming
        </AppText>
        <AppText variant="body" color={colors.mutedText}>
          Targeted ACS-task drills, rapid-fire review, and full mock checkride sessions will appear here in a future update.
        </AppText>
      </Card>
    </Screen>
  )
}
