import { View, StyleSheet } from 'react-native'
import { Screen } from '../../components/Screen'
import { SectionHeader } from '../../components/SectionHeader'
import { Card } from '../../components/Card'
import { AppText } from '../../components/AppText'
import { ProgressIndicator } from '../../components/ProgressIndicator'
import { ErrorState, LoadingState, LockedState, EmptyState } from '../../components/StateViews'
import { useBootstrapContext } from '../../contexts/BootstrapContext'
import { useReadinessBreakdown } from '../../hooks/useReadinessBreakdown'
import { colors, spacing, radii } from '../../constants/theme'
import type { ReadinessCategoryBreakdown, ReadinessEvidenceLevel } from '../../../shared/mobile-dto'

// Mirrors site/portal-stable.js's EVIDENCE_SUFFICIENCY_LABELS exactly --
// same four-value evidence-sufficiency vocabulary and copy as the web
// Readiness Detail view, so a learner moving between platforms never
// sees a different word for the same underlying state.
const EVIDENCE_LABEL: Record<ReadinessEvidenceLevel, string> = {
  none: 'Insufficient Evidence',
  limited: 'Limited Evidence',
  developing: 'Developing',
  strong: 'Strong Evidence',
}

const EVIDENCE_COLOR: Record<ReadinessEvidenceLevel, { bg: string; text: string }> = {
  none: { bg: colors.navySoft, text: colors.mutedText },
  limited: { bg: colors.warningSoft, text: colors.warning },
  developing: { bg: colors.goldSoft, text: colors.goldDeep },
  strong: { bg: colors.successSoft, text: colors.success },
}

function formatLastDemonstrated(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `Last practiced ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function CategoryCard({ category }: { category: ReadinessCategoryBreakdown }) {
  const evidenceColor = EVIDENCE_COLOR[category.evidence_level]
  const lastDemonstrated = formatLastDemonstrated(category.last_demonstrated_at)

  return (
    <Card>
      <View style={styles.cardHeader}>
        <AppText variant="subtitle" weight="semibold" style={styles.cardTitle}>
          {category.label}
        </AppText>
        <View style={[styles.badge, { backgroundColor: evidenceColor.bg }]}>
          <AppText variant="label" weight="semibold" color={evidenceColor.text}>
            {EVIDENCE_LABEL[category.evidence_level].toUpperCase()}
          </AppText>
        </View>
      </View>

      {category.score !== null ? (
        <ProgressIndicator current={category.score} total={100} label={`Score: ${Math.round(category.score)}%`} />
      ) : (
        <AppText variant="body" color={colors.mutedText}>
          Not enough evidence yet to show a score.
        </AppText>
      )}

      {category.weak_task_count > 0 || (typeof category.strong_task_count === 'number' && category.strong_task_count > 0) ? (
        <View style={styles.metaRow}>
          {category.weak_task_count > 0 ? (
            <AppText variant="caption" color={colors.warning}>
              {category.weak_task_count} task{category.weak_task_count === 1 ? '' : 's'} need reinforcement
            </AppText>
          ) : null}
          {typeof category.strong_task_count === 'number' && category.strong_task_count > 0 ? (
            <AppText variant="caption" color={colors.success}>
              {category.strong_task_count} task{category.strong_task_count === 1 ? '' : 's'} demonstrated strong
            </AppText>
          ) : null}
        </View>
      ) : null}

      {lastDemonstrated ? (
        <AppText variant="caption" color={colors.mutedText}>
          {lastDemonstrated}
        </AppText>
      ) : null}
    </Card>
  )
}

export default function AcsScreen() {
  const bootstrap = useBootstrapContext()
  const readiness = useReadinessBreakdown({ enabled: bootstrap.ready && bootstrap.entitled })

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading ACS Explorer…" />
      </Screen>
    )
  }

  // Sprint 1A Rev3 section 2's ordering rule, same as Practice/Library: a
  // bootstrap failure must never be misrepresented as "not entitled."
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

  if (readiness.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading ACS Explorer…" />
      </Screen>
    )
  }

  if (readiness.error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={readiness.error.userMessage} onRetry={readiness.refresh} />
      </Screen>
    )
  }

  // category_breakdown is additive on 'v2'+ snapshots (see the DTO's own
  // comment) -- an empty array covers both "no snapshot exists yet" and
  // the (mobile-readiness-filtered-out) case of a legacy pre-v3 row, so
  // both collapse to the same honest "no evidence yet" empty state rather
  // than a confusing blank list.
  const categories = readiness.data?.category_breakdown ?? []

  if (!readiness.data || categories.length === 0) {
    return (
      <Screen refreshing={readiness.refreshing} onRefresh={readiness.refresh}>
        <SectionHeader title="ACS Explorer" subtitle="Your evidence and coverage across every ACS area" />
        <EmptyState title="No ACS evidence yet" message="Complete a practice session to see your first ACS coverage breakdown." />
      </Screen>
    )
  }

  const { assessable_task_count: assessable, evidenced_task_count: evidenced } = readiness.data

  return (
    <Screen refreshing={readiness.refreshing} onRefresh={readiness.refresh}>
      <SectionHeader title="ACS Explorer" subtitle="Your evidence and coverage across every ACS area" />
      {assessable != null && evidenced != null ? (
        <AppText variant="caption" color={colors.mutedText}>
          {evidenced} of {assessable} assessable ACS tasks have evidence
        </AppText>
      ) : null}
      <View style={styles.list}>
        {categories.map((category) => (
          <CategoryCard key={category.category} category={category} />
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, marginTop: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
})
