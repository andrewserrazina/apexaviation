import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, View, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useBootstrapContext } from '../../contexts/BootstrapContext'
import { useHomeDrill } from '../../hooks/useHomeDrill'
import { Screen } from '../../components/Screen'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { CheckridePrepPaywall } from '../../components/CheckridePrepPaywall'
import { CheckrideCountdownCard } from '../../components/CheckrideCountdownCard'
import { HomeHeader } from '../../components/HomeHeader'
import { MetricCard } from '../../components/MetricCard'
import { ReadinessCard } from '../../components/ReadinessCard'
import { TodaysDrillCard } from '../../components/TodaysDrillCard'
import { SectionHeader } from '../../components/SectionHeader'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { colors, spacing } from '../../constants/theme'

// Free, no-account-required tool, already live on the public site --
// the one substantial thing a free member can actually DO today, so
// it's what Home's free-tier view leads with (Priority 3: "a new free
// account should have a useful dashboard rather than appearing broken
// or entirely locked"). Opening it is not purchase/checkout steering --
// Apple's anti-steering rules govern directing someone to pay outside
// IAP for content that should be sold through it, not a plain link to
// free content -- so this is a DELIBERATELY different case from the
// Checkride Prep teaser below it, which still carries zero URL/price/
// purchase language, matching this screen's own previously-reviewed
// compliance bar (see FreeCheckridePrepTeaser's own comment).
const FREE_READINESS_ASSESSMENT_URL = 'https://apexaviationtx.com/readiness-assessment.html'

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
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <HomeHeader
          eyebrow="WELCOME ABOARD"
          name={user.full_name ?? 'Pilot'}
          tagline="Your checkride prep starts here."
          onAvatarPress={() => router.push('/(app)/profile')}
        />

        <CheckrideCountdownCard profileId={user.id} checkrideDate={training.checkride_date} onSaved={bootstrap.refresh} />
        <FreeReadinessAssessmentCard />
        <FreeVsPaidCard />
        <FreeCheckridePrepTeaser />
      </Screen>
    )
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <HomeHeader
        eyebrow="WELCOME BACK"
        name={user.full_name ?? 'Pilot'}
        tagline="Keep building toward checkride day."
        onAvatarPress={() => router.push('/(app)/profile')}
      />

      <CheckrideCountdownCard profileId={user.id} checkrideDate={training.checkride_date} onSaved={bootstrap.refresh} />

      {(training.certificate_type || training.aircraft_class) && (
        <Card style={styles.trainingCard}>
          <AppText variant="label" weight="semibold" color={colors.mutedText}>
            TRAINING CONTEXT
          </AppText>
          <AppText variant="body" weight="semibold">
            {[formatSnakeCaseLabel(training.certificate_type), training.aircraft_class, training.acs_version]
              .filter(Boolean)
              .join(' • ')}
          </AppText>
        </Card>
      )}

      <View style={styles.metricsRow}>
        <MetricCard label="XP" value={String(progress.xp)} accent />
        <MetricCard label="Streak" value={`${progress.current_streak}d`} helper={`Best: ${progress.longest_streak}d`} />
        {/* Physical-device fix: the server's rank identity string (e.g.
            "student_pilot") is authoritative and never altered -- only
            reformatted for display -- and rendered at a smaller,
            two-line-friendly variant than XP's giant numeric display
            size, since a textual value wraps awkwardly at that size in
            this narrow flex:1 column. */}
        <MetricCard label="Rank" value={formatSnakeCaseLabel(progress.current_rank) ?? '—'} valueVariant="title" />
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
        <Card accent="gold">
          <SectionHeader title="Weak Areas" subtitle="From your recent practice, server-computed" icon="alert-circle-outline" accent="gold" />
          <View style={styles.weakAreaList}>
            {home.weak_areas.map((area) => (
              <View key={area.acs_task_id} style={styles.weakAreaRow}>
                <AppText variant="body" weight="medium" style={styles.weakAreaLabel}>
                  {area.area_code}.{area.task_code}
                  {area.task_title ? ` ${area.task_title}` : ''}
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

// Priority 3 (free student experience): the one substantial, genuinely
// free, already-functioning tool a free member can use today -- opens
// in the system browser since this app has no in-app web view. Plain
// content link, not purchase steering (see this file's own URL-constant
// comment above for why that distinction matters here).
function FreeReadinessAssessmentCard() {
  return (
    <Card accent="gold">
      <SectionHeader
        title="Free Readiness Assessment"
        subtitle="Your first step toward checkride confidence"
        icon="speedometer-outline"
        accent="gold"
      />
      <AppText variant="body" color={colors.mutedText}>
        Five minutes, zero cost: a short diagnostic that gives you an honest, personalized read on how checkride-ready you are right now -- no account or purchase required.
      </AppText>
      <Button label="Take the Free Assessment" onPress={() => Linking.openURL(FREE_READINESS_ASSESSMENT_URL)} variant="secondary" />
    </Card>
  )
}

// Accurate, non-deceptive free-vs-paid breakdown (Priority 3 requirement)
// -- lists only what a $0 account can ACTUALLY do today. Ground School
// and Study Pack browsing are deliberately left out: every module/pack
// shows LOCKED for a true free account, so touting either as a "free
// feature" here would be the exact misleading impression this card
// exists to avoid.
function FreeVsPaidCard() {
  return (
    <Card accent="navy">
      <SectionHeader title="Your Plan at a Glance" icon="layers-outline" accent="navy" />
      <View style={styles.planRow}>
        <AppText variant="label" weight="semibold" color={colors.success}>
          FREE
        </AppText>
        <AppText variant="body" color={colors.mutedText} style={styles.planText}>
          Your account, dashboard, and the free Readiness Assessment above -- already unlocked.
        </AppText>
      </View>
      <View style={styles.planRow}>
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          CHECKRIDE PREP
        </AppText>
        <AppText variant="body" color={colors.mutedText} style={styles.planText}>
          The full DPE Question Library, Scenario Training Center, AI Oral Practice, and progress tracking -- unlocked together.
        </AppText>
      </View>
    </Card>
  )
}

// Was a deliberate zero-purchase-language dead end before Apple IAP
// existed (Sprint 1A Rev2 section 3's original compliance bar for this
// card). Now that in-app purchase is the real, required way to buy
// digital content on iOS, this card leads with the actual purchase
// flow (CheckridePrepPaywall) instead of a text-only description --
// Apple's anti-steering rules are about directing someone to pay
// OUTSIDE IAP for content that should be sold through it, which is the
// opposite of what this card now does.
function FreeCheckridePrepTeaser() {
  return (
    <Card accent="gold">
      <SectionHeader title="Ready for the full Checkride Prep System?" icon="ribbon-outline" accent="gold" />
      <CheckridePrepPaywall showHeading={false} />
    </Card>
  )
}

// Presentation-only: the server value (certificate_type, current_rank)
// is authoritative and never altered, only reformatted for display --
// e.g. "student_pilot" -> "Student Pilot". A value with no underscores
// (already human-formatted, or a single word) passes through with only
// its first character capitalized, so this is safe to apply
// unconditionally rather than needing to guess whether a given field is
// "snake_case-shaped" first.
function formatSnakeCaseLabel(value: string | null): string | null {
  if (!value) return null
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const styles = StyleSheet.create({
  trainingCard: { gap: 4 },
  metricsRow: { flexDirection: 'row', gap: spacing.sm },
  weakAreaList: { gap: spacing.xs },
  weakAreaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  weakAreaLabel: { flex: 1 },
  planRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  planText: { flex: 1 },
})
