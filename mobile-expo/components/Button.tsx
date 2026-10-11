import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native'
import { colors, radii, spacing } from '../constants/theme'
import { AppText } from './AppText'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
  accessibilityHint?: string
  testID?: string
}

const MIN_TOUCH_TARGET = 48

export function Button({ label, onPress, variant = 'primary', disabled, loading, style, accessibilityHint, testID }: ButtonProps) {
  const isDisabled = disabled || loading
  const palette = variantPalette[variant]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.background, borderColor: palette.border, borderWidth: palette.border ? 1 : 0 },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <AppText variant="subtitle" weight="semibold" color={palette.text}>
          {label}
        </AppText>
      )}
    </Pressable>
  )
}

// Primary is solid gold -- matches web's actual signature CTA color on
// both the marketing site (.btn--primary) and the portal app
// (.btn-primary), not mobile's previous navy-filled button (a mismatch
// from web's own convention, independent of the dark-theme pass).
// Gold-button text is dark navy, matching the portal app's own
// convention (not the marketing site's white-on-gold variant).
const variantPalette: Record<Variant, { background: string; text: string; border?: string }> = {
  primary: { background: colors.gold, text: colors.textOnGold },
  secondary: { background: colors.goldSoft, text: colors.gold, border: colors.gold },
  ghost: { background: 'transparent', text: colors.textPrimary, border: colors.navyBorder },
  danger: { background: colors.dangerSoft, text: colors.danger, border: colors.danger },
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
})
