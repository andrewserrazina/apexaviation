import { useState } from 'react'
import { View, StyleSheet, Pressable } from 'react-native'
import { Screen } from '../../components/Screen'
import { SectionHeader } from '../../components/SectionHeader'
import { Card } from '../../components/Card'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { ProgressIndicator } from '../../components/ProgressIndicator'
import { ErrorState, LoadingState, LockedState, EmptyState } from '../../components/StateViews'
import { useBootstrapContext } from '../../contexts/BootstrapContext'
import { useReadinessBreakdown } from '../../hooks/useReadinessBreakdown'
import { useAcsTaskBreakdown } from '../../hooks/useAcsTaskBreakdown'
import { colors, spacing, radii } from '../../constants/theme'
import type { MobileAcsTaskInfo, ReadinessCategoryBreakdown, ReadinessEvidenceLevel } from '../../../shared/mobile-dto'

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

// V142: one task row inside an expanded category. content_available
// takes precedence over evidence_summary -- a task with no Apex content
// mapped to it can never have evidence, so that's the more fundamental
// (and honest) gap to surface first, matching
// compute_readiness_snapshot()'s own insufficient_content_coverage
// framing on the web side. evidence_score is a 0..1 fraction on the
// wire (task_evidence's own storage unit) -- converted to a percentage
// only for display, never re-derived or fabricated when null.
function TaskRow({ task }: { task: MobileAcsTaskInfo }) {
  const evidence = task.evidence_summary

  return (
    <View style={styles.taskRow}>
      <View style={styles.taskRowHeader}>
        <AppText variant="label" weight="semibold" color={colors.navy}>
          {task.area_code}.{task.task_code}
        </AppText>
        <AppText variant="body" style={styles.taskTitle}>
          {task.task_title}
        </AppText>
      </View>
      {!task.content_available ? (
        <AppText variant="caption" color={colors.mutedText}>
          No Apex content mapped to this task yet.
        </AppText>
      ) : evidence ? (
        <AppText variant="caption" color={colors.mutedText}>
          {evidence.attempt_count} attempt{evidence.attempt_count === 1 ? '' : 's'} • Evidence: {Math.round(evidence.evidence_score * 100)}%
        </AppText>
      ) : (
        <AppText variant="caption" color={colors.mutedText}>
          No evidence yet.
        </AppText>
      )}
    </View>
  )
}

interface CategoryCardProps {
  category: ReadinessCategoryBreakdown
  expanded: boolean
  onToggle: () => void
  tasks: MobileAcsTaskInfo[]
  tasksLoading: boolean
  tasksError: string | null
  onRetryTasks: () => void
}

function CategoryCard({ category, expanded, onToggle, tasks, tasksLoading, tasksError, onRetryTasks }: CategoryCardProps) {
  const evidenceColor = EVIDENCE_COLOR[category.evidence_level]
  const lastDemonstrated = formatLastDemonstrated(category.last_demonstrated_at)

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${category.label}. ${expanded ? 'Collapse' : 'Expand'} to see its individual tasks.`}
        onPress={onToggle}
        style={styles.pressableHeader}
      >
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

        <AppText variant="caption" weight="semibold" color={colors.navy}>
          {expanded ? 'Hide tasks ▲' : 'View tasks ▼'}
        </AppText>
      </Pressable>

      {expanded ? (
        <View style={styles.taskList}>
          {tasksLoading ? (
            <AppText variant="caption" color={colors.mutedText}>
              Loading tasks…
            </AppText>
          ) : tasksError ? (
            <View style={styles.taskErrorRow}>
              <AppText variant="caption" color={colors.danger}>
                {tasksError}
              </AppText>
              <Button label="Try again" onPress={onRetryTasks} variant="ghost" />
            </View>
          ) : tasks.length === 0 ? (
            <AppText variant="caption" color={colors.mutedText}>
              No tasks found for this category.
            </AppText>
          ) : (
            tasks.map((task) => <TaskRow key={task.acs_task_id} task={task} />)
          )}
        </View>
      ) : null}
    </Card>
  )
}

export default function AcsScreen() {
  const bootstrap = useBootstrapContext()
  const readiness = useReadinessBreakdown({ enabled: bootstrap.ready && bootstrap.entitled })
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [tasksRequested, setTasksRequested] = useState(false)
  // Fetched lazily -- only once a learner actually expands a category,
  // not on every ACS Explorer open, since a learner who just glances at
  // the category rollup and leaves never needs the task-level detail.
  const taskBreakdown = useAcsTaskBreakdown({ enabled: bootstrap.ready && bootstrap.entitled && tasksRequested })

  function toggleCategory(categoryId: string) {
    setTasksRequested(true)
    setExpandedCategory((current) => (current === categoryId ? null : categoryId))
  }

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
          <CategoryCard
            key={category.category}
            category={category}
            expanded={expandedCategory === category.category}
            onToggle={() => toggleCategory(category.category)}
            tasks={taskBreakdown.tasks.filter((t) => t.dpe_category === category.category)}
            tasksLoading={taskBreakdown.loading}
            tasksError={taskBreakdown.error?.userMessage ?? null}
            onRetryTasks={taskBreakdown.refetch}
          />
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, marginTop: spacing.sm },
  pressableHeader: { gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  taskList: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.navyBorder, gap: spacing.sm },
  taskRow: { gap: 2 },
  taskRowHeader: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  taskTitle: { flex: 1 },
  taskErrorRow: { gap: spacing.sm, alignItems: 'flex-start' },
})
