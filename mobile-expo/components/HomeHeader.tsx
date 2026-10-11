import { Pressable, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radii, shadow, spacing } from '../constants/theme'
import { AppText } from './AppText'

interface HomeHeaderProps {
  eyebrow: string
  name: string
  tagline: string
  onAvatarPress: () => void
}

// Replaces Home's old plain "Welcome / Name" text row with a navy hero
// card -- the same visual treatment a premium aviation dashboard would
// give its most-seen screen, built only from existing Apex palette
// tokens (navy background, gold eyebrow/avatar ring) rather than any new
// color or font.
export function HomeHeader({ eyebrow, name, tagline, onAvatarPress }: HomeHeaderProps) {
  return (
    <View style={styles.hero}>
      <View style={styles.textWrap}>
        <AppText variant="label" weight="semibold" color={colors.gold}>
          {eyebrow}
        </AppText>
        <AppText variant="title" heading weight="bold" color={colors.white}>
          {name}
        </AppText>
        <AppText variant="caption" color="rgba(255, 255, 255, 0.72)">
          {tagline}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile and settings"
        onPress={onAvatarPress}
        style={styles.avatarButton}
        hitSlop={8}
      >
        <Ionicons name="person-circle" size={40} color={colors.gold} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  textWrap: { flex: 1, gap: 2 },
  avatarButton: {
    padding: 2,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
})
