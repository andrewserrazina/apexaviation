import { View, StyleSheet } from 'react-native'
import type { DrillStatus, MobileAcsTaskRef } from '../../shared/mobile-dto'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Button } from './Button'
import { Card } from './Card'
import { SectionHeader } from './SectionHeader'

interface TodaysDrillCardProps {
  status: DrillStatus
  estimatedMinutes: number
  targetAcsTasks: MobileAcsTaskRef[]
  onPress: () => void
}

const STATUS_COPY: Record<DrillStatus, { title: string; cta: string }> = {
  pending: { title: "Today's Drill", cta: 'Start Drill' },
  in_progress: { title: "Today's Drill", cta: 'Continue Drill' },
  completed: { title: "Today's Drill — Done", cta: 'View Summary' },
}

export function TodaysDrillCard({ status, estimatedMinutes, targetAcsTasks, onPress }: TodaysDrillCardProps) {
  const copy = STATUS_COPY[status]

  return (
    <Card>
      <SectionHeader title={copy.title} subtitle={`${estimatedMinutes} min • ${targetAcsTasks.length} focus areas`} />

      {targetAcsTasks.length > 0 ? (
        <View style={styles.chipRow}>
          {targetAcsTasks.slice(0, 3).map((task) => (
            <View key={task.acs_task_id} style={styles.chip}>
              <AppText variant="caption" weight="semibold" color={colors.navy}>
                {task.area_code}.{task.task_code}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        label={copy.cta}
        onPress={onPress}
        variant={status === 'completed' ? 'ghost' : 'primary'}
        accessibilityHint={status === 'completed' ? 'View a summary of your completed drill' : 'Begin today’s practice drill'}
      />
    </Card>
  )
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.navySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
})
