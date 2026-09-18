import { View, Image, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppText } from './AppText'
import { colors, spacing } from '../constants/theme'

// The one persistent brand surface every tab screen shares -- a navy bar
// carrying the real Apex mark, always visible regardless of which tab or
// scroll position the learner is on. Mirrors the web portal's own
// topbar/sidebar convention (ApexLogo + wordmark on a navy surface) so the
// app doesn't read as an unbranded, all-white shell. This replaces
// React Navigation's default header entirely (screenOptions.header in
// app/(app)/_layout.tsx) -- it is not a per-screen title, which stays in
// each screen's own SectionHeader further down the page.
export function AppHeader() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.bar}>
        <Image source={require('../assets/apex-mark.png')} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
        <AppText variant="subtitle" heading weight="bold" color={colors.white} style={styles.wordmark} accessibilityRole="header">
          Apex Advantage
        </AppText>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.navy },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.navy,
  },
  mark: { width: 26, height: 26 },
  wordmark: { letterSpacing: 0.3 },
})
