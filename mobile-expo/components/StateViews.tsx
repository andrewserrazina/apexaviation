import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Button } from './Button'

// LoadingState, ErrorState, and EmptyState are grouped in one file since
// they share the same "centered message inside a screen" shape -- kept as
// three named exports rather than one configurable component so callers
// stay explicit about which state they're rendering.

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.navy} />
      <AppText variant="body" color={colors.mutedText}>
        {label}
      </AppText>
    </View>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({ message, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <View style={styles.wrap} accessibilityLiveRegion="assertive">
      <AppText variant="subtitle" weight="semibold" center>
        {message}
      </AppText>
      {onRetry ? <Button label={retryLabel} onPress={onRetry} variant="secondary" /> : null}
    </View>
  )
}

interface EmptyStateProps {
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <AppText variant="subtitle" weight="semibold" center>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" color={colors.mutedText} center>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
})
