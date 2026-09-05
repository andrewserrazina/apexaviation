import { StyleSheet } from 'react-native'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Card } from './Card'

interface MetricCardProps {
  label: string
  value: string
  helper?: string
  accent?: boolean
}

export function MetricCard({ label, value, helper, accent }: MetricCardProps) {
  return (
    <Card style={styles.card}>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="display" heading weight="bold" color={accent ? colors.goldDeep : colors.navy}>
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
