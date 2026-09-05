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

// The one locked-access state for a learner whose bootstrap-reported
// access.checkride_prep is false. Sprint 1A has no in-app purchase flow,
// so this is deliberately a dead end with NO url/price/checkout/browser
// steering of any kind (Sprint 1A Rev2 section 3) -- a plain account-
// state message pointing the learner to a human, not a purchase path.
export function LockedState() {
  return (
    <View style={styles.wrap}>
      <AppText variant="subtitle" weight="semibold" center>
        Checkride Prep isn’t included on this account
      </AppText>
      <AppText variant="body" color={colors.mutedText} center>
        If you believe this is a mistake, contact your instructor or Apex support.
      </AppText>
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
