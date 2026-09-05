import { type ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { colors, radii, shadow, spacing } from '../constants/theme'

interface CardProps {
  children: ReactNode
  style?: ViewStyle
}

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>
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
})
