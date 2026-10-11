import { StyleSheet } from 'react-native'
import { AppText } from './AppText'
import { Card } from './Card'
import { useCountdownTimer } from '../hooks/useCountdownTimer'
import { formatCountdownClock } from '../lib/countdownTimer'
import { colors, spacing } from '../constants/theme'

interface RapidFireTimerProps {
  totalSeconds: number
  // Freezes the clock once the session is already complete (or being
  // submitted) -- ticking away on a finished session's completion screen
  // would make no sense. See useCountdownTimer's own comment on why
  // `enabled=false` freezes rather than resets.
  enabled: boolean
}

// Phase 5 (mobile parity), item 5: DPE Rapid Fire's visible time
// pressure. Expiry is informational only -- it never force-submits a
// partial session (see the session screen's own comment) -- so this
// only ever changes what it displays, never what the learner can still
// do on the question below it.
export function RapidFireTimer({ totalSeconds, enabled }: RapidFireTimerProps) {
  const { remainingSeconds, expired } = useCountdownTimer(totalSeconds, enabled)

  return (
    <Card accent={expired ? 'gold' : 'navy'} style={styles.card}>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        {expired ? "TIME'S UP" : 'TIME REMAINING'}
      </AppText>
      <AppText variant="title" weight="bold" color={expired ? colors.goldDeep : colors.textPrimary}>
        {expired ? 'Finish rating to submit' : formatCountdownClock(remainingSeconds)}
      </AppText>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
})
