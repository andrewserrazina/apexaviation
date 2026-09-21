import { Pressable, View, StyleSheet } from 'react-native'
import type { ConfidenceRating } from '../../lib/groundSchoolEvidence'
import { AppText } from '../AppText'
import { colors, radii, spacing } from '../../constants/theme'

interface ConfidenceRatingGroupProps {
  value: ConfidenceRating | null
  disabled?: boolean
  onChange: (rating: ConfidenceRating) => void
}

const OPTIONS: { value: ConfidenceRating; label: string }[] = [
  { value: 'confident', label: 'Confident' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'not_yet', label: 'Not Yet' },
]

// Shared 3-value confidence rating control -- Checkride Corner (per
// question) and Scenario Workshop (whole scenario) both use this same
// control, mirroring site/portal-stable.js's confidenceRatingGroupHtml().
export function ConfidenceRatingGroup({ value, disabled, onChange }: ConfidenceRatingGroupProps) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {OPTIONS.map((opt) => {
        const selected = value === opt.value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={opt.label}
            style={[styles.option, { backgroundColor: selected ? colors.goldSoft : colors.white, borderColor: selected ? colors.gold : colors.border }]}
          >
            <AppText variant="caption" weight="semibold" color={selected ? colors.goldDeep : colors.navy}>
              {opt.label}
            </AppText>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  option: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill, borderWidth: 1.5 },
})
