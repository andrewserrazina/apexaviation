import { useState } from 'react'
import { KeyboardAvoidingView, Platform, TextInput, View, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { isValidEmail } from '../../lib/registrationValidation'
import { colors, radii, spacing } from '../../constants/theme'

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth()
  const params = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(params.email ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Deliberately neutral regardless of whether the email actually has an
  // account -- see AuthContext.requestPasswordReset's own comment.
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (submitting) return
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await requestPasswordReset(email.trim())
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <AppText variant="display" heading weight="bold" color={colors.navy} center>
            Check your email.
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            If an account exists for {email.trim()}, we’ve sent a link to reset your password.
          </AppText>
          <Button label="Back to Sign In" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        <View style={styles.content}>
          <AppText variant="display" heading weight="bold" color={colors.navy} center>
            Reset your password.
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            Enter your account email and we’ll send you a link to set a new password.
          </AppText>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              EMAIL
            </AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="Email address"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedText}
              editable={!submitting}
            />
          </View>

          {error ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : null}

          <Button label="Send Reset Link" onPress={handleSubmit} loading={submitting} testID="forgot-password-submit" />
          <Button label="Back to Sign In" variant="ghost" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.lightGray },
  container: { flex: 1, backgroundColor: colors.lightGray, justifyContent: 'center', padding: spacing.xl },
  content: { gap: spacing.lg },
  input: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.navy,
  },
})
