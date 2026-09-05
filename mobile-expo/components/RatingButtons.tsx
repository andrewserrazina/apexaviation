import { Pressable, View, StyleSheet } from 'react-native'
import type { SelfRating } from '../../shared/mobile-dto'
import { colors, radii, spacing } from '../constants/theme'
import { AppText } from './AppText'

interface RatingButtonsProps {
  value: SelfRating | null
  onChange: (rating: SelfRating) => void
}

// Exact wire values -- 'correct' | 'partial' | 'incorrect' -- are the
// SelfRating type itself, so there's no separate mapping step that could
// drift from what mobile-practice expects.
const OPTIONS: { value: SelfRating; label: string; color: string; soft: string }[] = [
  { value: 'correct', label: 'Correct', color: colors.success, soft: colors.successSoft },
  { value: 'partial', label: 'Partial', color: colors.warning, soft: colors.warningSoft },
  { value: 'incorrect', label: 'Incorrect', color: colors.danger, soft: colors.dangerSoft },
]

export function RatingButtons({ value, onChange }: RatingButtonsProps) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="How did you do?">
      {OPTIONS.map((opt) => {
        const selected = value === opt.value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            style={[
              styles.option,
              { backgroundColor: selected ? opt.soft : colors.white, borderColor: selected ? opt.color : colors.border },
            ]}
          >
            <AppText variant="body" weight="semibold" color={selected ? opt.color : colors.navy} center>
              {opt.label}
            </AppText>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
})
