import { type ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { colors, radii, shadow, spacing } from '../constants/theme'

interface CardProps {
  children: ReactNode
  style?: ViewStyle
  // Optional left-edge color bar -- a lightweight way to give a card
  // visual weight (a primary action vs. a purely informational one)
  // without a new shape/shadow/radius, so every existing Card caller
  // that doesn't pass this renders exactly as before.
  accent?: 'gold' | 'navy'
}

export function Card({ children, style, accent }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        accent === 'gold' && styles.accentGold,
        accent === 'navy' && styles.accentNavy,
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.navyBorder,
    gap: spacing.sm,
    ...shadow.card,
  },
  accentGold: { borderLeftWidth: 4, borderLeftColor: colors.gold },
  accentNavy: { borderLeftWidth: 4, borderLeftColor: colors.navy },
})
