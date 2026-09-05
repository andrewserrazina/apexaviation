import { router } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { TodaysDrillCard } from '../../../components/TodaysDrillCard'
import { ErrorState, LoadingState } from '../../../components/StateViews'
import { useDailyDrill } from '../../../hooks/useDailyDrill'
import { colors } from '../../../constants/theme'

export default function PracticeTabScreen() {
  const { data, loading, error, refetch } = useDailyDrill()

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
