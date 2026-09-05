import { View, StyleSheet } from 'react-native'
import type { EvidenceLevel, ReadinessReasonCode } from '../../shared/mobile-dto'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Card } from './Card'
import { SectionHeader } from './SectionHeader'

interface ReadinessCardProps {
  overallScore: number | null
  evidenceLevel: EvidenceLevel | null
  reasonCodes: ReadinessReasonCode[]
}

// Readiness is a TRAINING-READINESS INDICATOR, never a pass-probability
// estimate (Sprint 1A section 8D, and the DTO's own MobileReadinessSummary
// comment). This is the ONE place readiness ever renders in Sprint 1A --
// it always shows overall_score alongside evidence_level and a restrained
// explanation drawn from reason_codes, never overall_score alone, and the
// copy below never predicts a checkride outcome in any phrasing.
const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  low: 'Limited evidence yet',
  moderate: 'Building evidence',
  high: 'Strong evidence',
}

const REASON_COPY: Partial<Record<string, string>> = {
  low_sample_size: 'Complete more practice to sharpen this indicator.',
  confidence_calibration_not_yet_available: 'Confidence calibration isn’t available yet.',
  score_change_dampened: 'This score moves gradually rather than swinging session to session.',
  insufficient_content_coverage: 'Some ACS areas don’t have Apex content mapped yet, so coverage is measured honestly against the full standard.',
}

export function ReadinessCard({ overallScore, evidenceLevel, reasonCodes }: ReadinessCardProps) {
  if (overallScore === null || evidenceLevel === null) {
    return (
      <Card>
        <SectionHeader title="Readiness" />
        <AppText variant="body" color={colors.mutedText}>
          Complete a practice session to see your first readiness indicator.
        </AppText>
      </Card>
    )
  }

  const explanation = reasonCodes.map((code) => REASON_COPY[code]).find(Boolean)

  return (
    <Card>
      <SectionHeader title="Readiness" subtitle="A training indicator, not a pass prediction" />
      <View style={styles.scoreRow}>
        <AppText variant="display" heading weight="bold">
          {Math.round(overallScore)}
        </AppText>
        <View style={styles.evidenceBadge}>
          <AppText variant="label" weight="semibold" color={colors.navy}>
            {EVIDENCE_LABEL[evidenceLevel].toUpperCase()}
          </AppText>
        </View>
      </View>
      {explanation ? (
        <AppText variant="caption" color={colors.mutedText}>
          {explanation}
        </AppText>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  evidenceBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
})
