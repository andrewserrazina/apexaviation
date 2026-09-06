import { Ionicons } from '@expo/vector-icons'
import { View, StyleSheet } from 'react-native'
import { Screen } from './Screen'
import { AppText } from './AppText'
import { colors, spacing } from '../constants/theme'

interface PlaceholderScreenProps {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  description: string
}

// A deliberate, polished "coming soon" state -- Sprint 1A section 6 is
// explicit that ACS/Oral/Library must not fake functionality that
// doesn't exist yet. No fabricated data, no dead buttons.
export function PlaceholderScreen({ icon, title, description }: PlaceholderScreenProps) {
  return (
    <Screen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={36} color={colors.navy} />
        </View>
        <AppText variant="title" heading weight="bold" center>
          {title}
        </AppText>
        <AppText variant="body" color={colors.mutedText} center>
          {description}
        </AppText>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
