import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { validateRegistrationForm } from '../../lib/registrationValidation'
import { colors, radii, spacing } from '../../constants/theme'

// Same URLs/convention as app/(app)/profile.tsx's existing Privacy
// Policy link. site/terms.html now exists (added in this Sprint) --
// still flagged in this Sprint's report as needing a legal/business
// review before this build ships (it describes real, already-published
// product policies where they exist, and is explicit about the few
// business decisions -- e.g. a unified cross-product refund window --
// that were deliberately left out rather than invented).
const TERMS_OF_SERVICE_URL = 'https://apexaviationtx.com/terms.html'
const PRIVACY_POLICY_URL = 'https://apexaviationtx.com/privacy.html'

export default function SignUpScreen() {
  const { signUp } = useAuth()
  const params = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(params.email ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (submitting) return
    const fieldError = validateRegistrationForm({ email, password, confirmPassword, acceptedTerms })
    if (fieldError) {
      setError(fieldError.message)
      return
    }

    setSubmitting(true)
    setError(null)
    const result = await signUp(email.trim(), password)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    if (result.needsVerification) {
      router.replace({ pathname: '/(auth)/check-email', params: { email: email.trim() } })
    }
    // Else: this Supabase project has email confirmation OFF, signUp()
    // already returned a real session, and (auth)/_layout.tsx's existing
    // session-redirect takes the learner straight into (app) -- no
    // explicit navigation needed here.
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <AppText variant="display" heading weight="bold" color={colors.navy} center>
            Create Your Account
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            Free to join. Checkride Prep unlocks separately, any time you’re ready.
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
              editable={!submitting}
            />
          </View>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              PASSWORD
            </AppText>
            <View style={styles.passwordRow}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
                textContentType="newPassword"
                accessibilityLabel="Password"
                style={[styles.input, styles.passwordInput]}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedText}
                editable={!submitting}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                onPress={() => setShowPassword((s) => !s)}
                style={styles.eyeButton}
                hitSlop={8}
              >
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={colors.mutedText} />
              </Pressable>
            </View>
            <AppText variant="caption" color={colors.mutedText}>
              At least 6 characters.
            </AppText>
          </View>

          <View>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              CONFIRM PASSWORD
            </AppText>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoComplete="password-new"
              textContentType="newPassword"
              accessibilityLabel="Confirm password"
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedText}
              editable={!submitting}
            />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTerms }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            onPress={() => setAcceptedTerms((a) => !a)}
            style={styles.termsRow}
            hitSlop={8}
          >
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
              {acceptedTerms ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
            </View>
            <AppText variant="caption" color={colors.mutedText} style={styles.termsText}>
              I agree to the{' '}
              <AppText variant="caption" weight="semibold" color={colors.navy} onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}>
                Terms of Service
              </AppText>{' '}
              and{' '}
              <AppText variant="caption" weight="semibold" color={colors.navy} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
                Privacy Policy
              </AppText>
              .
            </AppText>
          </Pressable>

          {error ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : null}

          <Button label="Create Account" onPress={handleSubmit} loading={submitting} testID="sign-up-submit" />
          <Button label="Back to Sign In" variant="ghost" onPress={() => router.replace({ pathname: '/(auth)/sign-in', params: email.trim() ? { email: email.trim() } : undefined })} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.lightGray },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
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
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 48 },
  eyeButton: {
    position: 'absolute',
    right: 0,
    top: 6,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  termsText: { flex: 1, lineHeight: 18 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.navyBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.navy, borderColor: colors.navy },
})
