import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useBootstrapContext } from '../../contexts/BootstrapContext'
import { useHomeDrill } from '../../hooks/useHomeDrill'
import { Screen } from '../../components/Screen'
import { AppText } from '../../components/AppText'
import { Card } from '../../components/Card'
import { MetricCard } from '../../components/MetricCard'
import { ReadinessCard } from '../../components/ReadinessCard'
import { TodaysDrillCard } from '../../components/TodaysDrillCard'
import { SectionHeader } from '../../components/SectionHeader'
import { ErrorState, LoadingState, LockedState } from '../../components/StateViews'
import { colors, spacing } from '../../constants/theme'

export default function HomeScreen() {
  const bootstrap = useBootstrapContext()
  const drill = useHomeDrill(bootstrap.data?.home.todays_drill ?? null, { enabled: bootstrap.ready && bootstrap.entitled })
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await bootstrap.refresh()
      // useHomeDrill re-syncs on its own once the refreshed
      // bootstrap.data flows back down as a new `bootstrapDrill` prop --
      // no separate drill.retry() call needed here.
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing])

  // Sprint 1A Rev2 section 8: refresh bootstrap whenever Home regains
  // focus (e.g. the learner taps "Back to Home" after completing a
  // drill), so XP/streak/readiness/today's-drill are current without
  // requiring a manual pull-to-refresh. Skips the very first focus --
  // BootstrapProvider already fetches once on mount, so refreshing again
  // immediately would just be a duplicate network call. useBootstrap's
  // own in-flight guard additionally prevents this from ever overlapping
  // a refresh already underway (e.g. from pull-to-refresh).
  const hasFocusedOnce = useRef(false)
  const refreshRef = useRef(bootstrap.refresh)
  useEffect(() => {
    refreshRef.current = bootstrap.refresh
  }, [bootstrap.refresh])
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
        <LoadingState label="Loading your dashboard…" />
      </Screen>
    )
  }

  if (bootstrap.error || !bootstrap.data) {
    return (
      <Screen scroll={false}>
        <ErrorState message={bootstrap.error?.userMessage ?? 'We couldn’t load your dashboard.'} onRetry={bootstrap.refresh} />
      </Screen>
    )
  }

  const { user, training, access, progress, home } = bootstrap.data

  if (!access.checkride_prep) {
    return (
      <Screen scroll={false}>
        <LockedState />
      </Screen>
    )
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.headerRow}>
        <View style={styles.flexOne}>
          <AppText variant="caption" color={colors.mutedText}>
            Welcome back
          </AppText>
          <AppText variant="title" heading weight="bold">
            {user.full_name ?? 'Pilot'}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          onPress={() => router.push('/(app)/profile')}
          style={styles.avatarButton}
          hitSlop={8}
        >
          <Ionicons name="person-circle" size={40} color={colors.navy} />
        </Pressable>
      </View>

      {(training.certificate_type || training.aircraft_class) && (
        <Card style={styles.trainingCard}>
          <AppText variant="label" weight="semibold" color={colors.mutedText}>
            TRAINING CONTEXT
          </AppText>
          <AppText variant="body" weight="semibold">
            {[formatCertificate(training.certificate_type), training.aircraft_class, training.acs_version]
              .filter(Boolean)
              .join(' • ')}
          </AppText>
        </Card>
      )}

      <View style={styles.metricsRow}>
        <MetricCard label="XP" value={String(progress.xp)} accent />
        <MetricCard label="Streak" value={`${progress.current_streak}d`} helper={`Best: ${progress.longest_streak}d`} />
        <MetricCard label="Rank" value={progress.current_rank ?? '—'} />
      </View>

      <ReadinessCard
        overallScore={progress.readiness_summary?.overall_score ?? null}
        evidenceLevel={progress.readiness_summary?.evidence_level ?? null}
        reasonCodes={progress.readiness_summary?.reason_codes ?? []}
      />

      {drill.loading ? (
        <Card>
          <LoadingState label="Loading today’s drill…" />
        </Card>
      ) : drill.error ? (
        <Card>
          <ErrorState message={drill.error.userMessage} onRetry={drill.retry} />
        </Card>
      ) : drill.drill ? (
        <TodaysDrillCard
          status={drill.drill.status}
          estimatedMinutes={drill.drill.estimated_minutes}
          targetAcsTasks={drill.drill.target_acs_tasks}
          onPress={() => router.push({ pathname: '/(app)/practice/[drillId]', params: { drillId: drill.drill!.id } })}
        />
      ) : null}

      {home.weak_areas.length > 0 ? (
        <Card>
          <SectionHeader title="Weak Areas" subtitle="From your recent practice, server-computed" />
          <View style={styles.weakAreaList}>
            {home.weak_areas.map((area) => (
              <View key={area.acs_task_id} style={styles.weakAreaRow}>
                <AppText variant="body" weight="medium">
                  {area.area_code}.{area.task_code}
                </AppText>
                <AppText variant="caption" color={colors.mutedText}>
                  {Math.round(area.evidence_score * 100)}%
                </AppText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  )
}

function formatCertificate(value: string | null): string | null {
  if (!value) return null
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexOne: { flex: 1 },
  avatarButton: { padding: 2 },
  trainingCard: { gap: 4 },
  metricsRow: { flexDirection: 'row', gap: spacing.sm },
  weakAreaList: { gap: spacing.xs },
  weakAreaRow: { flexDirection: 'row', justifyContent: 'space-between' },
})
