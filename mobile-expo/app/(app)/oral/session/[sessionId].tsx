import { useState } from 'react'
import { useLocalSearchParams, router } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View, StyleSheet } from 'react-native'
import { Screen } from '../../../../components/Screen'
import { AppText } from '../../../../components/AppText'
import { Button } from '../../../../components/Button'
import { ErrorState, LoadingState, LockedState } from '../../../../components/StateViews'
import { DebriefView } from '../../../../components/oral/DebriefView'
import { useDpeSession } from '../../../../hooks/useDpeSession'
import { useBootstrapContext } from '../../../../contexts/BootstrapContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { colors, radii, spacing } from '../../../../constants/theme'

// Phase 1 (AI DPE mobile): the oral-practice chat screen. This route
// ALWAYS resumes an already-created server session -- the Oral hub is
// the only place a new session is ever started, matching Practice's ad-
// hoc session route convention exactly (see that screen's own comment).
export default function OralSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const bootstrap = useBootstrapContext()
  const { user } = useAuth()

  const enabled = bootstrap.ready && !bootstrap.error && !!bootstrap.data && bootstrap.entitled
  const session = useDpeSession(sessionId, { enabled, userId: user?.id ?? null })

  const [draft, setDraft] = useState('')

  if (bootstrap.loading || !bootstrap.ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Oral Practice…" />
      </Screen>
    )
  }

  if (bootstrap.error || !bootstrap.data) {
    return (
      <Screen scroll={false}>
        <ErrorState message={bootstrap.error?.userMessage ?? 'We couldn’t load your account.'} onRetry={bootstrap.refresh} />
      </Screen>
    )
  }

  if (!bootstrap.entitled) {
    return (
      <Screen scroll={false}>
        <LockedState />
      </Screen>
    )
  }

  if (session.resuming) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Resuming your oral practice session…" />
      </Screen>
    )
  }

  if (session.resumeError) {
    return (
      <Screen scroll={false}>
        <ErrorState message={session.resumeError.userMessage} onRetry={session.retryResume} />
      </Screen>
    )
  }

  if (session.status === 'completed' && session.debrief) {
    return (
      <DebriefView
        debrief={session.debrief}
        onPracticeAgain={() => router.replace('/(app)/oral')}
        onBackToOral={() => router.replace('/(app)/oral')}
      />
    )
  }

  async function handleSend() {
    const text = draft
    if (!text.trim()) return
    setDraft('')
    await session.sendMessage(text)
    // On failure, the hook rolls back the optimistic bubble but the
    // typed text is already cleared from the input -- restore it so the
    // student doesn't have to retype a lost answer.
    if (session.sendError) setDraft(text)
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll={false} padded={false}>
        <ScrollView contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
          {session.turns.map((turn, i) => (
            <View
              key={i}
              style={[styles.bubble, turn.role === 'student' ? styles.studentBubble : styles.dpeBubble, turn.pending && styles.pendingBubble]}
            >
              <AppText variant="body" color={turn.role === 'student' ? colors.white : colors.navy}>
                {turn.message}
              </AppText>
            </View>
          ))}
          {session.sending ? (
            <View style={[styles.bubble, styles.dpeBubble]}>
              <LoadingState label="The examiner is responding…" />
            </View>
          ) : null}
        </ScrollView>

        {session.sendError ? (
          <View style={styles.errorBar}>
            <AppText variant="caption" color={colors.danger}>
              {session.sendError.userMessage}
            </AppText>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Answer the examiner’s question…"
            placeholderTextColor={colors.mutedText}
            style={styles.input}
            multiline
            accessibilityLabel="Your answer"
            editable={!session.sending && session.status === 'in_progress'}
          />
          <Button label="Send" onPress={handleSend} loading={session.sending} disabled={!draft.trim() || session.status !== 'in_progress'} />
        </View>

        <Button
          label="End Session"
          variant="ghost"
          onPress={session.endSession}
          loading={session.ending}
          disabled={session.status !== 'in_progress' || session.sending}
        />
        {session.endError ? (
          <AppText variant="caption" color={colors.danger}>
            {session.endError.userMessage}
          </AppText>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  messages: { padding: spacing.lg, gap: spacing.sm },
  bubble: { maxWidth: '85%', borderRadius: radii.lg, padding: spacing.md },
  dpeBubble: { backgroundColor: colors.white, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.navyBorder },
  studentBubble: { backgroundColor: colors.navy, alignSelf: 'flex-end' },
  pendingBubble: { opacity: 0.6 },
  errorBar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.lg, paddingTop: 0 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.navy,
  },
})
