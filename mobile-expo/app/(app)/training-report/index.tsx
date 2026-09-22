import { router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { ReportSection } from '../../../components/trainingReport/ReportSection'
import { CategoryLine } from '../../../components/trainingReport/CategoryLine'
import { StatRow } from '../../../components/trainingReport/StatRow'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useReadinessBreakdown } from '../../../hooks/useReadinessBreakdown'
import { useTrainingReportAggregates } from '../../../hooks/useTrainingReportAggregates'
import { buildTrainingReportView, EVIDENCE_SUFFICIENCY_LABEL } from '../../../lib/buildTrainingReportView'
import { colors, spacing } from '../../../constants/theme'
import type { TrainingReportAddressRow } from '../../../lib/buildTrainingReportView'

// Phase 5 (final phase of the mobile feature-parity roadmap): a
// read-only, instructor-shareable summary composed client-side from two
// existing/new mobile-* calls (see buildTrainingReportView.ts's own
// header comment). Section order is fixed and mirrors web's
// renderUnifiedTrainingReport() -- never re-ordered by score. Empty
// sections are omitted entirely (each `if (view.X.length)` /
// `if (view.X)` guard below), never rendered blank, matching web's own
// rule.
function runAddressAction(action: TrainingReportAddressRow['action']) {
  if (action.type === 'review_queue') router.push('/(app)/review')
  else if (action.type === 'ai_dpe') router.push('/(app)/oral')
  else router.push({ pathname: '/(app)/ground-school/[moduleId]', params: { moduleId: action.moduleId } })
}

export default function TrainingReportScreen() {
  const bootstrap = useBootstrapContext()
  const enabled = bootstrap.ready && bootstrap.entitled
  const readiness = useReadinessBreakdown({ enabled })
  const aggregates = useTrainingReportAggregates({ enabled })

  function retry() {
    readiness.refresh()
    aggregates.refresh()
  }

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading your training report…" />
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

  if (readiness.loading || aggregates.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading your training report…" />
      </Screen>
    )
  }

  if (readiness.error || aggregates.error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={readiness.error?.userMessage ?? aggregates.error?.userMessage ?? 'We couldn’t load your training report.'} onRetry={retry} />
      </Screen>
    )
  }

  const view = buildTrainingReportView(readiness.data, aggregates.data)

  if (!view) {
    return (
      <Screen scroll={false}>
        <View style={styles.centerWrap}>
          <AppText variant="title" heading weight="bold" center>
            Training Report
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            Complete some training first -- your report builds itself from real evidence as you go.
          </AppText>
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title="Training Report" subtitle="A record of your Apex Advantage training evidence, generated from your account." />

      <ReportSection title="Knowledge & Oral Readiness">
        <StatRow
          stats={[
            { value: view.overallScore === null ? '—' : `${Math.round(view.overallScore)}%`, label: 'Apex Checkride Readiness' },
            { value: view.evidenceLabel, label: 'Overall Evidence Level' },
          ]}
        />
        <AppText variant="caption" color={colors.mutedText}>
          Based on the training evidence Apex Advantage can currently evaluate -- oral-exam knowledge, Ground School, and review performance. Apex does
          not yet digitally assess hands-on flight maneuvers.
        </AppText>
      </ReportSection>

      {view.recommendedAction ? (
        <ReportSection title="Recommended Next Training Action">
          <AppText variant="body" weight="semibold" color={colors.navy}>
            {view.recommendedAction.categoryLabel}
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            {view.recommendedAction.whyText}
          </AppText>
          <Button label={view.recommendedAction.ctaLabel} onPress={() => runAddressAction({ type: view.recommendedAction!.cta })} />
        </ReportSection>
      ) : null}

      {view.strongest.length ? (
        <ReportSection title="Strongest Demonstrated Areas">
          {view.strongest.map((cat) => (
            <CategoryLine key={cat.category} label={`${cat.label} — ${Math.round(cat.score ?? 0)}%`} statusLabel="Strong Evidence" statusColor={colors.success} />
          ))}
        </ReportSection>
      ) : null}

      {view.reinforcement.length ? (
        <ReportSection title="Areas Needing Reinforcement">
          {view.reinforcement.map((cat) => (
            <CategoryLine
              key={cat.category}
              label={`${cat.label} — ${cat.score === null ? '—' : Math.round(cat.score) + '%'}`}
              statusLabel="Needs Reinforcement"
              statusColor={colors.warning}
            />
          ))}
        </ReportSection>
      ) : null}

      {view.insufficient.length ? (
        <ReportSection title="Insufficient or Limited Evidence">
          <AppText variant="caption" color={colors.mutedText}>
            Not enough training evidence yet to confidently assess these areas -- this reflects available data, not performance.
          </AppText>
          {view.insufficient.map((cat) => (
            <CategoryLine key={cat.category} label={cat.label} statusLabel={EVIDENCE_SUFFICIENCY_LABEL[cat.evidence_level]} statusColor={colors.mutedText} />
          ))}
        </ReportSection>
      ) : null}

      <ReportSection title="Flight Proficiency Not Yet Tracked">
        <AppText variant="caption" color={colors.mutedText}>
          Apex Advantage currently evaluates oral-exam knowledge, Ground School progress, and review performance. Hands-on flight maneuvers are outside
          Apex’s current digital assessment scope and are not reflected in this report -- they remain your CFI’s direct evaluation.
        </AppText>
      </ReportSection>

      <ReportSection title="Evidence Summary">
        <StatRow
          stats={[
            { value: `${view.evidenceSummary.evidencedTaskCount} of ${view.evidenceSummary.assessableTaskCount}`, label: 'Assessable ACS tasks with evidence' },
            { value: String(view.evidenceSummary.reviewsCompletedCount), label: 'Review Queue items completed' },
          ]}
        />
      </ReportSection>

      <ReportSection title="Ground School Progress">
        <StatRow
          stats={[
            { value: `${view.groundSchool.activeModuleCount} of ${view.groundSchool.totalModuleCount}`, label: 'Modules with recorded activity' },
            { value: String(view.groundSchool.confidentCount), label: 'Self-rated Confident' },
            { value: String(view.groundSchool.needsReviewCount), label: 'Self-rated Needs Review' },
          ]}
        />
        {view.groundSchool.mostRecentModuleLabel ? (
          <AppText variant="caption" color={colors.mutedText}>
            Most recent module activity: {view.groundSchool.mostRecentModuleLabel}
            {view.groundSchool.mostRecentModuleAt ? ` — ${new Date(view.groundSchool.mostRecentModuleAt).toLocaleDateString()}` : ''}
          </AppText>
        ) : null}
      </ReportSection>

      <ReportSection title="ACS Knowledge Evidence">
        <AppText variant="caption" color={colors.mutedText}>
          {view.evidenceSummary.evidencedTaskCount} of {view.evidenceSummary.assessableTaskCount} ACS tasks Apex Advantage currently assesses digitally
          have recorded evidence. Flight-only ACS tasks are outside Apex’s current digital readiness scope, not missing evidence.
        </AppText>
      </ReportSection>

      <ReportSection title="My Review Queue">
        {view.reviewQueue.dueCount ? (
          <>
            <StatRow stats={[{ value: String(view.reviewQueue.dueCount), label: 'Items currently due' }]} />
            {view.reviewQueue.dueCategoryLabels.length ? (
              <AppText variant="caption" color={colors.mutedText}>
                {view.reviewQueue.dueCategoryLabels.join(', ')}
              </AppText>
            ) : null}
          </>
        ) : (
          <AppText variant="caption" color={colors.mutedText}>
            No review items currently due.
          </AppText>
        )}
      </ReportSection>

      {view.aiOralPractice ? (
        <ReportSection title="AI Oral Practice">
          <StatRow stats={[{ value: new Date(view.aiOralPractice.mostRecentEndedAt).toLocaleDateString(), label: 'Most recent session' }]} />
          {view.aiOralPractice.weakCategoryLabels.length ? (
            <AppText variant="caption" color={colors.mutedText}>
              Flagged for reinforcement: {view.aiOralPractice.weakCategoryLabels.join(', ')}
            </AppText>
          ) : null}
        </ReportSection>
      ) : null}

      <ReportSection title="Areas to Address">
        {view.areasToAddress.length ? (
          view.areasToAddress.map((row, i) => (
            <Card key={i} style={styles.addressRow}>
              <AppText variant="body">{row.text}</AppText>
              <Button label="Open" variant="ghost" onPress={() => runAddressAction(row.action)} />
            </Card>
          ))
        ) : (
          <AppText variant="caption" color={colors.mutedText}>
            Nothing currently needs attention -- keep up the consistent training.
          </AppText>
        )}
      </ReportSection>

      <AppText variant="caption" color={colors.mutedText} center>
        Generated from Apex Advantage member portal data. Does not include billing or account credential information.
      </AppText>
    </Screen>
  )
}

const styles = StyleSheet.create({
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  addressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
})
