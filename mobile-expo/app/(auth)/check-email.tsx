import { useEffect, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { colors, spacing } from '../../constants/theme'

const RESEND_COOLDOWN_SECONDS = 30

// Shown after Create Account only when this Supabase project's "Confirm
// email" setting is ON (signUp() returned no session yet -- see
// AuthContext.signUp's needsVerification). Tapping the emailed link is
// handled by useAuthDeepLinks.ts, which lands the learner signed-in once
// exchanged; this screen never polls or redirects on its own.
export default function CheckEmailScreen() {
  const { resendVerificationEmail } = useAuth()
  const params = useLocalSearchParams<{ email?: string }>()
  const email = params.email ?? ''
  const [resending, setResending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  async function handleResend() {
    if (resending || cooldown > 0 || !email) return
    setResending(true)
    setMessage(null)
    const result = await resendVerificationEmail(email)
    setResending(false)
    if (result.ok) {
      setMessage('Verification email sent.')
      startCooldown()
    } else {
      setMessage(result.message)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <AppText variant="display" heading weight="bold" color={colors.navy} center>
          Check your email.
        </AppText>
        <AppText variant="body" color={colors.mutedText} center>
          {email
            ? `We sent a verification link to ${email}. Tap it to finish setting up your account, then come back and sign in.`
            : 'We sent you a verification link. Tap it to finish setting up your account, then come back and sign in.'}
        </AppText>

        {message ? (
          <AppText variant="caption" color={colors.mutedText} center accessibilityLiveRegion="polite">
            {message}
          </AppText>
        ) : null}

        <Button
          label={cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend verification email'}
          onPress={handleResend}
          loading={resending}
          disabled={cooldown > 0 || !email}
          variant="secondary"
        />
        <Button label="Back to Sign In" variant="ghost" onPress={() => router.replace('/(auth)/sign-in')} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightGray, justifyContent: 'center', padding: spacing.xl },
  content: { gap: spacing.lg },
})
