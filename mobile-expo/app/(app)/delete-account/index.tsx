import { useState } from 'react'
import { router } from 'expo-router'
import { KeyboardAvoidingView, Platform, TextInput, View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { useAuth } from '../../../contexts/AuthContext'
import { deleteAccount } from '../../../lib/api/account'
import { emailConfirmationMatches } from '../../../lib/deleteAccountConfirmation'
import { ApiError, logDevError } from '../../../lib/api/errors'
import { colors, radii, spacing } from '../../../constants/theme'

// Required for App Store submission -- Apple Guideline 5.1.1(v): any app
// that supports account creation/sign-in must offer in-app account
// deletion, not just a website-only path. Mirrors the web portal's own
// type-your-email-to-confirm flow (site/portal-stable.js's Delete
// Account modal) since this is irreversible: the confirm button stays
// disabled until the typed text exactly matches the signed-in member's
// own email.
export default function DeleteAccountScreen() {
  const { user, signOut } = useAuth()
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const memberEmail = user?.email ?? ''
  const matches = emailConfirmationMatches(confirmText, memberEmail)

  async function handleDelete() {
    if (!matches || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteAccount()
      await signOut()
      router.replace('/(auth)/sign-in')
    } catch (err) {
      logDevError('DeleteAccountScreen', err)
      setError(err instanceof ApiError ? err.userMessage : 'Something went wrong. Please try again or contact info@apexaviationtx.com.')
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <SectionHeader title="Delete Account" />

      <Card>
        <AppText variant="body" color={colors.mutedText}>
          This immediately disables your login, cancels any active subscription, and erases your name, email, and AI chat history. Purchase and Ground
          School attendance records are kept in anonymized form for accounting purposes.
        </AppText>
        <AppText variant="body" weight="semibold" color={colors.danger}>
          This can’t be undone.
        </AppText>
      </Card>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <AppText variant="label" weight="semibold" color={colors.mutedText}>
            {`TYPE YOUR EMAIL (${memberEmail}) TO CONFIRM`}
          </AppText>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Type your email to confirm account deletion"
            style={styles.input}
            placeholder={memberEmail}
            placeholderTextColor={colors.mutedText}
            editable={!submitting}
          />

          {error ? (
            <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </AppText>
          ) : null}

          <Button
            label="Permanently Delete My Account"
            onPress={handleDelete}
            variant="danger"
            disabled={!matches}
            loading={submitting}
            testID="delete-account-confirm"
          />
          <Button label="Cancel" onPress={() => router.back()} variant="ghost" disabled={submitting} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, marginTop: spacing.md },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.navy,
  },
})
