import { Pressable, View, StyleSheet } from 'react-native'
import type { ReviewOutcomeValue } from '../../../shared/mobile-dto'
import { colors, radii, spacing } from '../../constants/theme'
import { AppText } from '../AppText'

interface ReviewOutcomeButtonsProps {
  disabled: boolean
  onChoose: (outcome: ReviewOutcomeValue) => void
}

// Mirrors RatingButtons.tsx's layout, but a different vocabulary --
// Review Queue's binary reinforced/needs-another-pass outcome, not
// practice's ternary correct/partial/incorrect self-rating. Kept as its
// own component rather than a RatingButtons variant since the two never
// share a value type.
export function ReviewOutcomeButtons({ disabled, onChoose }: ReviewOutcomeButtonsProps) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChoose('reinforced')}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Reinforced"
        style={[styles.option, { backgroundColor: colors.successSoft, borderColor: colors.success, opacity: disabled ? 0.5 : 1 }]}
      >
        <AppText variant="body" weight="semibold" color={colors.success} center>
          ✓ Reinforced
        </AppText>
      </Pressable>
      <Pressable
        onPress={() => onChoose('needs_another_pass')}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Needs Another Pass"
        style={[styles.option, { backgroundColor: colors.warningSoft, borderColor: colors.warning, opacity: disabled ? 0.5 : 1 }]}
      >
        <AppText variant="body" weight="semibold" color={colors.warning} center>
          Needs Another Pass
        </AppText>
      </Pressable>
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
