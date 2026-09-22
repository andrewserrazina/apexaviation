import { View, StyleSheet } from 'react-native'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'

export interface Stat {
  value: string
  label: string
}

// Mirrors web's trainingReportStatRow() -- a row of big-number/label
// pairs, wrapping to a new line at phone width rather than squeezing.
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((stat, i) => (
        <View key={i} style={styles.stat}>
          <AppText variant="title" weight="bold" color={colors.navy}>
            {stat.value}
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            {stat.label}
          </AppText>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stat: { minWidth: 100 },
})
