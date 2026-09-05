import { useState } from 'react'
import { KeyboardAvoidingView, Platform, TextInput, View, StyleSheet } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { colors, radii, spacing } from '../../constants/theme'

export default function SignInScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.')
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await signIn(email.trim(), password)
    setSubmitting(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        <View style={styles.brand}>
          <AppText variant="display" heading weight="bold" color={colors.navy} center>
            Apex Advantage
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            Checkride Prep, on your phone.
          </AppText>
        </View>

        <View style={styles.form}>
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
            />
          </View>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              PASSWORD
            </AppText>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              accessibilityLabel="Password"
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedText}
            />
          </View>

          {error ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : null}

          <Button label="Sign In" onPress={handleSubmit} loading={submitting} testID="sign-in-submit" />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.lightGray },
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  brand: { gap: spacing.xs },
  form: { gap: spacing.md },
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
