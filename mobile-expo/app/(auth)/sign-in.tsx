import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, TextInput, View, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { colors, radii, spacing } from '../../constants/theme'

export default function SignInScreen() {
  const { signIn, authCallbackError, setAuthCallbackError } = useAuth()
  // Carries the typed email back from Create Account (Delivery
  // requirement: "Preserve the user's email when returning to the login
  // screen") -- both sign-up.tsx's own "Back to Sign In" link and its
  // "an account with this email already exists" error path send the
  // learner here with ?email= set, matching the web portal's own
  // backToSignInFromSignup convention (site/portal-login.html).
  const params = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(params.email ?? '')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A deep-link callback (expired/invalid verification or recovery link)
  // routes here and sets this once -- shown here, then cleared, so it
  // never reappears on a later, unrelated visit to this screen.
  useEffect(() => {
    if (authCallbackError) {
      // Same established repo-wide pattern as e.g. practice/index.tsx's
      // own loadActive() effect -- this lint rule flags setState calls
      // inside effects generally; this one specifically surfaces a
      // one-shot deep-link error exactly once, which has no other
      // trigger than "this screen just mounted/received a new value."
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(authCallbackError)
      setAuthCallbackError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authCallbackError])

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

          <Button
            label="Forgot password?"
            onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: email.trim() ? { email: email.trim() } : undefined })}
            variant="ghost"
            testID="sign-in-forgot-password"
          />
        </View>

        <View style={styles.footer}>
          <AppText variant="body" color={colors.mutedText} center>
            New to Apex Advantage?
          </AppText>
          <Button
            label="Create Free Account"
            onPress={() => router.push({ pathname: '/(auth)/sign-up', params: email.trim() ? { email: email.trim() } : undefined })}
            variant="secondary"
            testID="sign-in-create-account"
          />
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
  footer: { gap: spacing.sm },
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
