import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import { SectionHeader } from '../../../components/SectionHeader'
import { ScenarioCard } from '../../../components/ScenarioCard'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useDpeLibrary } from '../../../hooks/useDpeLibrary'
import { setQuestionFavorited, setQuestionStudied, touchQuestionLastViewed } from '../../../lib/api/dpeLibraryDirect'
import { getScenarios } from '../../../lib/dpeLibraryFilter'
import { colors, spacing } from '../../../constants/theme'
import type { MobileDpeQuestion, MobileDpeQuestionProgress } from '../../../../shared/mobile-dto'

// Mobile parity (Phase 5, item 2): Scenario Training Center had no
// mobile equivalent beyond a single linear decision exercise buried
// inside Library Study Packs. Web's "Scenario Center" is literally the
// is_scenario=true subset of the same dpe_questions bank the DPE
// Question Library already serves (see lib/dpeLibraryFilter.ts's own
// getScenarios() comment) -- this screen reuses the exact same
// mobile-dpe-library fetch and progress-write functions, not a second
// content system.
export default function ScenarioTrainingScreen() {
  const bootstrap = useBootstrapContext()
  const library = useDpeLibrary({ enabled: bootstrap.ready && bootstrap.entitled })
  const [progressOverlay, setProgressOverlay] = useState<Record<string, MobileDpeQuestionProgress>>({})

  if (!bootstrap.ready || bootstrap.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading…" />
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

  const profileId = bootstrap.data.user.id

  if (library.error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={library.error.userMessage} onRetry={library.refresh} />
      </Screen>
    )
  }

  if (library.loading || !library.data) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading scenario training…" />
      </Screen>
    )
  }

  const progress = { ...library.data.progress, ...progressOverlay }
  const scenarios = getScenarios(library.data.questions)
  const categoryLabelById = new Map(library.data.categories.map((c) => [c.id, c.label]))
  const reviewedCount = scenarios.filter((s) => progress[s.id]?.completed).length

  function handleToggleFavorite(scenario: MobileDpeQuestion) {
    const current = progress[scenario.id] ?? { favorited: false, completed: false, last_viewed_at: null }
    const next = { ...current, favorited: !current.favorited }
    setProgressOverlay((prev) => ({ ...prev, [scenario.id]: next }))
    setQuestionFavorited(profileId, scenario.id, next.favorited).catch(() => {
      setProgressOverlay((prev) => ({ ...prev, [scenario.id]: current }))
    })
  }

  function handleToggleStudied(scenario: MobileDpeQuestion) {
    const current = progress[scenario.id] ?? { favorited: false, completed: false, last_viewed_at: null }
    const next = { ...current, completed: !current.completed }
    setProgressOverlay((prev) => ({ ...prev, [scenario.id]: next }))
    setQuestionStudied(profileId, scenario.id, next.completed).catch(() => {
      setProgressOverlay((prev) => ({ ...prev, [scenario.id]: current }))
    })
  }

  function handleReveal(scenario: MobileDpeQuestion) {
    const current = progress[scenario.id]
    touchQuestionLastViewed(profileId, scenario.id, !!current?.last_viewed_at).catch(() => {})
    setProgressOverlay((prev) => ({
      ...prev,
      [scenario.id]: { ...(current ?? { favorited: false, completed: false, last_viewed_at: null }), last_viewed_at: new Date().toISOString() },
    }))
  }

  return (
    <Screen>
      <SectionHeader
        title="Scenario Training Center"
        subtitle={`${reviewedCount} / ${scenarios.length} reviewed`}
        icon="git-network-outline"
      />

      {scenarios.length === 0 ? (
        <Card>
          <AppText variant="body" color={colors.mutedText} center>
            No scenarios are available yet.
          </AppText>
        </Card>
      ) : (
        <View style={styles.list}>
          {scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              categoryLabel={categoryLabelById.get(scenario.category) ?? scenario.category}
              progress={progress[scenario.id]}
              onToggleFavorite={() => handleToggleFavorite(scenario)}
              onToggleStudied={() => handleToggleStudied(scenario)}
              onReveal={() => handleReveal(scenario)}
            />
          ))}
        </View>
      )}

      <Button label="Back to Practice" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
})
