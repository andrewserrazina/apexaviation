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
export function Screen({ children, scroll = true, refreshing, onRefresh, contentStyle, padded = true }: ScreenProps) {
  const inner = (
    <View style={[padded && styles.padded, contentStyle]}>{children}</View>
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
