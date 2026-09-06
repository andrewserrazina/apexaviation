import { type ReactNode } from 'react'
import { SafeAreaView, ScrollView, StyleSheet, View, type ViewStyle, RefreshControl } from 'react-native'
import { colors, spacing } from '../constants/theme'

interface ScreenProps {
  children: ReactNode
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  contentStyle?: ViewStyle
  padded?: boolean
}

// The one root layout every screen renders through -- consistent safe-area
// handling, background, and optional pull-to-refresh, so individual
// screens never re-solve this.
//
// Physical-device fix: the non-scrolling branch used to wrap children in
// an outer `flex: 1` View, then an INNER padded View with no flex of its
// own. That inner View sized itself to its content rather than the outer
// View's full height, so a child relying on `flex: 1` + `justifyContent:
// 'center'` to center itself vertically (the drill completion screen) had
// no taller parent to actually center within -- on a physical iPhone,
// with real fonts/Dynamic Type/safe-area insets rather than this
// project's plain jsdom-style test renderer, that collapsed/clipped the
// content instead of just leaving it top-aligned. The inner content View
// now also stretches to fill the full height whenever `scroll` is false,
// so a screen's own `flex: 1` child can rely on it.
export function Screen({ children, scroll = true, refreshing, onRefresh, contentStyle, padded = true }: ScreenProps) {
  const inner = (
    <View style={[!scroll && styles.flexOne, padded && styles.padded, contentStyle]}>{children}</View>
  )

  return (
    <SafeAreaView style={styles.safeArea}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.navy} colors={[colors.navy]} />
            ) : undefined
          }
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.flexOne}>{inner}</View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.lightGray },
  flexOne: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  padded: { padding: spacing.lg, gap: spacing.lg },
})
