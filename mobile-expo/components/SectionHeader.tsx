import { View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radii, spacing } from '../constants/theme'
import { AppText } from './AppText'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  // Optional icon badge to the left of the title -- gives a card's
  // header a focal point instead of bare text. Omitting it (every
  // existing call site today) renders exactly as before.
  icon?: keyof typeof Ionicons.glyphMap
  accent?: 'gold' | 'navy'
}

export function SectionHeader({ title, subtitle, icon, accent = 'navy' }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.badge, accent === 'gold' ? styles.badgeGold : styles.badgeNavy]}>
          <Ionicons name={icon} size={18} color={accent === 'gold' ? colors.goldDeep : colors.navy} />
        </View>
      ) : null}
      <View style={styles.wrap}>
        <AppText variant="title" heading weight="bold" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.mutedText}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  wrap: { flex: 1, gap: spacing.xs },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeGold: { backgroundColor: colors.goldSoft },
  badgeNavy: { backgroundColor: colors.navySoft },
})
