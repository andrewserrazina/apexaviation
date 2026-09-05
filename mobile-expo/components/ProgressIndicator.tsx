import { View, StyleSheet } from 'react-native'
import { colors, radii } from '../constants/theme'
import { AppText } from './AppText'

interface ProgressIndicatorProps {
  current: number
  total: number
  label?: string
}

// Progress is always shown as a bar AND a "X of Y" text label together --
// never color alone (Sprint 1A section 19, accessibility: "progress not
// conveyed by color alone").
export function ProgressIndicator({ current, total, label }: ProgressIndicatorProps) {
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  const text = label ?? `Question ${Math.min(current, total)} of ${total}`

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: current }}
      accessibilityLabel={text}
    >
      <AppText variant="caption" weight="semibold" color={colors.mutedText}>
        {text}
      </AppText>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.navySoft,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
})
