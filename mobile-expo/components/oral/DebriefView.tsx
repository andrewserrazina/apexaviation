import { View, StyleSheet } from 'react-native'
import type { MobileDpeDebrief } from '../../../shared/mobile-dto'
import { Screen } from '../Screen'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { colors, radii, spacing } from '../../constants/theme'

// Sprint AI-DPE-1: the debrief has a materially different shape than
// PracticeCompletionView (verdict badge, strengths/weaknesses two-column,
// per-ACS-domain verdict list) -- a new component, not a forced reuse of
// PracticeCompletionView, but built from the same Card/AppText/theme
// primitives every other completion-style screen uses.

const OVERALL_READINESS_LABEL: Record<MobileDpeDebrief['overallReadiness'], string> = {
  ready: 'Ready for Checkride',
  almost: 'Almost There',
  not_yet: 'Not Yet — Keep Practicing',
}

const OVERALL_READINESS_COLOR: Record<MobileDpeDebrief['overallReadiness'], { bg: string; text: string }> = {
  ready: { bg: colors.successSoft, text: colors.success },
  almost: { bg: colors.warningSoft, text: colors.warning },
  not_yet: { bg: colors.dangerSoft, text: colors.danger },
}

const DOMAIN_VERDICT_LABEL: Record<MobileDpeDebrief['perDomain'][number]['verdict'], string> = {
  strong: 'Strong',
  ok: 'OK',
  weak: 'Needs Work',
}

const DOMAIN_VERDICT_COLOR: Record<MobileDpeDebrief['perDomain'][number]['verdict'], string> = {
  strong: colors.success,
  ok: colors.warning,
  weak: colors.danger,
}

export function dpeVerdictLabel(verdict: MobileDpeDebrief['overallReadiness']): string {
  return OVERALL_READINESS_LABEL[verdict]
}

interface DebriefViewProps {
  debrief: MobileDpeDebrief
  onPracticeAgain: () => void
  onBackToOral: () => void
}

export function DebriefView({ debrief, onPracticeAgain, onBackToOral }: DebriefViewProps) {
  const badge = OVERALL_READINESS_COLOR[debrief.overallReadiness]

  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
        <AppText variant="subtitle" weight="semibold" color={badge.text}>
          {OVERALL_READINESS_LABEL[debrief.overallReadiness]}
        </AppText>
      </View>

      <AppText variant="body" color={colors.mutedText}>
        {debrief.summary}
      </AppText>

      {debrief.strengths.length > 0 ? (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            Strengths
          </AppText>
          {debrief.strengths.map((s, i) => (
            <AppText key={i} variant="body">
              • {s}
            </AppText>
          ))}
        </Card>
      ) : null}

      {debrief.weaknesses.length > 0 ? (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            Focus Areas
          </AppText>
          {debrief.weaknesses.map((w, i) => (
            <AppText key={i} variant="body">
              • {w}
            </AppText>
          ))}
        </Card>
      ) : null}

      {debrief.perDomain.length > 0 ? (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            By ACS Area
          </AppText>
          {debrief.perDomain.map((d, i) => (
            <View key={i} style={styles.domainRow}>
              <View style={styles.domainRowHeader}>
                <AppText variant="body" weight="medium" style={styles.domainName}>
                  {d.domain}
                </AppText>
                <AppText variant="caption" weight="semibold" color={DOMAIN_VERDICT_COLOR[d.verdict]}>
                  {DOMAIN_VERDICT_LABEL[d.verdict]}
                </AppText>
              </View>
              <AppText variant="caption" color={colors.mutedText}>
                {d.note}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      <Button label="Practice Again" onPress={onPracticeAgain} />
      <Button label="Back to Oral" variant="ghost" onPress={onBackToOral} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  domainRow: { gap: spacing.xs },
  domainRowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  domainName: { flex: 1 },
})
