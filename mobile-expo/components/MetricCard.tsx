import { StyleSheet } from 'react-native'
import { colors, spacing } from '../constants/theme'
import { AppText, type AppTextProps } from './AppText'
import { Card } from './Card'

interface MetricCardProps {
  label: string
  value: string
  helper?: string
  accent?: boolean
  // Physical-device fix: a numeric metric (XP) reads fine in the giant
  // "display" size, but a textual one (Rank, e.g. "Student Pilot") can
  // wrap awkwardly at that size in a narrow flex:1 column. Callers with a
  // textual value pass a smaller variant instead of forcing every metric
  // into the same numeric-scale typography.
  valueVariant?: AppTextProps['variant']
}

export function MetricCard({ label, value, helper, accent, valueVariant = 'display' }: MetricCardProps) {
  return (
    <Card style={styles.card}>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant={valueVariant} heading weight="bold" color={accent ? colors.goldDeep : colors.navy}>
        {value}
      </AppText>
      {helper ? (
        <AppText variant="caption" color={colors.mutedText}>
          {helper}
        </AppText>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: spacing.xs },
})
