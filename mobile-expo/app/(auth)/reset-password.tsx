import { useState } from 'react'
import { KeyboardAvoidingView, Platform, TextInput, View, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { isValidPassword, passwordsMatch } from '../../lib/registrationValidation'
import { colors, radii, spacing } from '../../constants/theme'

// Only meaningfully reachable once useAuthDeepLinks.ts has exchanged a
// valid recovery-link code, which is what sets isPasswordRecovery true
// and is the ONLY thing that keeps (auth)/_layout.tsx from redirecting
// this screen straight past into (app) (a recovery session is still a
// real session). A direct/stale visit with no such session (e.g. the app
// was killed and relaunched after a Cancel, or a bookmarked deep link
// clicked twice) shows a dead-end message instead of a form that could
// never actually submit.
export default function ResetPasswordScreen() {
  const { isPasswordRecovery, updatePassword, clearPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (submitting) return
    if (!isValidPassword(password)) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (!passwordsMatch(password, confirmPassword)) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await updatePassword(password)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    // updatePassword() already cleared isPasswordRecovery on success, so
    // this now behaves like any other authenticated session -- straight
    // into (app), not back through sign-in.
    router.replace('/(app)')
  }

  async function handleCancel() {
    await clearPasswordRecovery()
    router.replace('/(auth)/sign-in')
  }

  if (!isPasswordRecovery) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <AppText variant="display" heading weight="bold" color={colors.navy} center>
            Link no longer valid.
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            This password reset link has expired or was already used. Request a new one from the sign-in screen.
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
            Set a new password.
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            Choose a new password for your account.
          </AppText>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              NEW PASSWORD
            </AppText>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
              accessibilityLabel="New password"
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedText}
              editable={!submitting}
            />
          </View>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              CONFIRM NEW PASSWORD
            </AppText>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
              accessibilityLabel="Confirm new password"
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedText}
              editable={!submitting}
            />
          </View>

          {error ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : null}

          <Button label="Set Password" onPress={handleSubmit} loading={submitting} testID="reset-password-submit" />
          <Button label="Cancel" variant="ghost" onPress={handleCancel} disabled={submitting} />
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
