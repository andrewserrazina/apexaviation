import { useLocalSearchParams } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { AppText } from '../../../components/AppText'
import { ErrorState, LoadingState } from '../../../components/StateViews'
import { ModuleCompanionContent } from '../../../components/groundSchool/ModuleCompanionContent'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useGroundSchoolCatalog } from '../../../hooks/useGroundSchoolCatalog'
import { useGroundSchoolContent } from '../../../hooks/useGroundSchoolContent'
import { useGuidedNotes } from '../../../hooks/useGuidedNotes'
import { useModuleQuiz } from '../../../hooks/useModuleQuiz'
import { groundSchoolModuleDef } from '../../../constants/groundSchool'
import { colors, spacing } from '../../../constants/theme'

// Rev2-pattern (matches Library's own [packId].tsx exactly): moduleId is
// the only trusted route param -- unlocked status is resolved from the
// authenticated catalog, never trusted from a deep link, and the
// content action's own server-side entitlement re-check remains the
// final authority regardless.
export default function ModuleDetailScreen() {
  const params = useLocalSearchParams<{ moduleId: string }>()
  const moduleId = params.moduleId ?? ''
  const moduleDef = groundSchoolModuleDef(moduleId)

  const bootstrap = useBootstrapContext()
  const profileId = bootstrap.data?.user.id ?? null
  const catalog = useGroundSchoolCatalog({ enabled: bootstrap.ready })
  const module = catalog.data?.modules.find((m) => m.module_id === moduleId) ?? null
  const unlocked = module?.unlocked === true

  const { content, quiz, loading: contentLoading, error: contentError, refetch: refetchContent } = useGroundSchoolContent({
    moduleId,
    enabled: unlocked,
  })
  const guidedNotes = useGuidedNotes(profileId, 'PPL', moduleId, unlocked)
  const moduleQuiz = useModuleQuiz(profileId, 'PPL', moduleId, quiz)

  function retry() {
    catalog.refresh()
    refetchContent()
    guidedNotes.retryLoad()
  }

  if (!bootstrap.ready || catalog.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading module…" />
      </Screen>
    )
  }

  if (catalog.error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={catalog.error.userMessage} onRetry={catalog.refresh} />
      </Screen>
    )
  }

  if (!module || !moduleDef) {
    return (
      <Screen scroll={false}>
        <View style={styles.centerWrap}>
          <AppText variant="title" heading weight="bold" center>
            Module not found
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            We couldn’t find that Ground School module.
          </AppText>
        </View>
      </Screen>
    )
  }

  if (!unlocked) {
    return (
      <Screen scroll={false}>
        <View style={styles.centerWrap}>
          <AppText variant="title" heading weight="bold" center>
            {moduleDef.moduleLabel}
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            This Ground School module isn’t currently available on this account.
          </AppText>
          <AppText variant="caption" color={colors.mutedText} center>
            If you believe this is a mistake, contact your instructor or Apex support.
          </AppText>
        </View>
      </Screen>
    )
  }

  if (contentLoading || guidedNotes.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading module…" />
      </Screen>
    )
  }

  if (contentError || guidedNotes.loadError) {
    return (
      <Screen scroll={false}>
        <ErrorState message={contentError?.userMessage ?? guidedNotes.loadError?.userMessage ?? 'We couldn’t load this module.'} onRetry={retry} />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title={moduleDef.moduleLabel} subtitle={moduleDef.courseId === 'PPL' ? 'Private Pilot' : undefined} />
      <ModuleCompanionContent
        content={content}
        quiz={quiz}
        moduleId={moduleId}
        profileId={profileId}
        existingByPrompt={guidedNotes.existingByPrompt}
        savingPrompts={guidedNotes.savingPrompts}
        saveErrors={guidedNotes.saveErrors}
        saveNow={guidedNotes.saveNow}
        saveDebounced={guidedNotes.saveDebounced}
        quizAnswers={moduleQuiz.answers}
        onQuizAnswer={moduleQuiz.setAnswer}
        quizSubmitted={moduleQuiz.submitted}
        quizResults={moduleQuiz.results}
        quizScore={moduleQuiz.score}
        quizTotal={moduleQuiz.total}
        quizSubmitting={moduleQuiz.submitting}
        quizSubmitError={moduleQuiz.submitError?.userMessage ?? null}
        onQuizSubmit={moduleQuiz.submit}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
})
