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

  // Rev2 section 4: render every recognized, distinct limitation the
  // server reported, not just the first match. A single `.find(Boolean)`
  // could silently hide insufficient_content_coverage whenever another
  // known code happened to appear earlier in the array -- content/
  // evidence limitations must never be silently hidden.
  const explanations = [...new Set(reasonCodes.map((code) => REASON_COPY[code]).filter((copy): copy is string => Boolean(copy)))]

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
      {explanations.length > 0 ? (
        <View style={styles.explanationList}>
          {explanations.map((explanation) => (
            <AppText key={explanation} variant="caption" color={colors.mutedText}>
              {explanation}
            </AppText>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  explanationList: { gap: 2 },
  evidenceBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
})
