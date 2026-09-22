import { View, StyleSheet } from 'react-native'
import { spacing } from '../../constants/theme'
import { AppText } from '../AppText'

// One row inside Strongest/Reinforcement/Insufficient -- mirrors web's
// ".portal-report__category-line" (a label on the left, a single status
// phrase on the right, never two stacked badges).
export function CategoryLine({ label, statusLabel, statusColor }: { label: string; statusLabel: string; statusColor: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="body">{label}</AppText>
      <AppText variant="caption" weight="semibold" color={statusColor}>
        {statusLabel}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
})
