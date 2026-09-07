import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { ErrorState, LoadingState } from '../../../components/StateViews'
import { PackHome } from '../../../components/library/PackHome'
import { LessonList, LessonDetail } from '../../../components/library/LessonsView'
import { ScenarioList, ScenarioDetail } from '../../../components/library/ScenariosView'
import { CheckrideCornerView } from '../../../components/library/CheckrideCornerView'
import { MasteryCheckView } from '../../../components/library/MasteryCheckView'
import { QuickReferenceView } from '../../../components/library/QuickReferenceView'
import { useLibraryContent } from '../../../hooks/useLibraryContent'
import { colors, spacing } from '../../../constants/theme'
import { StyleSheet, View } from 'react-native'

type PackView =
  | { type: 'home' }
  | { type: 'lessons' }
  | { type: 'lesson'; index: number }
  | { type: 'scenarios' }
  | { type: 'scenario'; index: number }
  | { type: 'checkride' }
  | { type: 'mastery' }
  | { type: 'quickref' }

export default function PackDetailScreen() {
  const params = useLocalSearchParams<{ packId: string; name?: string; owned?: string }>()
  const packId = params.packId ?? ''
  const packName = params.name ?? 'Study Pack'
  // Sprint 1C Phase 3: `owned` here is only ever a UI hint carried from
  // the catalog screen's own server-provided data -- it decides whether
  // this screen calls the content action AT ALL, but never substitutes
  // for the server's own entitlement re-check on that call. A stale/
  // incorrect `true` still fails closed via useLibraryContent's error
  // handling (a 403 clears content and shows a normal error state, never
  // cached/privileged content).
  const owned = params.owned === 'true'

  const { content, loading, error, refetch } = useLibraryContent({ packId, enabled: owned })
  const [view, setView] = useState<PackView>({ type: 'home' })

  if (!owned) {
    return (
      <Screen scroll={false}>
        <View style={styles.lockedWrap}>
          <AppText variant="title" heading weight="bold" center>
            {packName}
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            This Study Pack isn’t currently available on this account.
          </AppText>
          <AppText variant="caption" color={colors.mutedText} center>
            If you believe this is a mistake, contact your instructor or Apex support.
          </AppText>
        </View>
      </Screen>
    )
  }

  if (loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Study Pack…" />
      </Screen>
    )
  }

  if (error || !content) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error?.userMessage ?? 'We couldn’t load this Study Pack.'} onRetry={refetch} />
      </Screen>
    )
  }

  return (
    <Screen>
      {view.type === 'home' ? (
        <PackHome
          content={content}
          onOpenLessons={() => setView({ type: 'lessons' })}
          onOpenScenarios={() => setView({ type: 'scenarios' })}
          onOpenCheckrideCorner={() => setView({ type: 'checkride' })}
          onOpenMasteryCheck={() => setView({ type: 'mastery' })}
          onOpenQuickReference={() => setView({ type: 'quickref' })}
        />
      ) : null}

      {view.type === 'lessons' ? (
        <LessonList lessons={content.lessons} packName={content.product.name} onBack={() => setView({ type: 'home' })} onSelect={(index) => setView({ type: 'lesson', index })} />
      ) : null}

      {view.type === 'lesson' ? (
        <LessonDetail
          lesson={content.lessons[view.index]}
          totalLessons={content.lessons.length}
          onBack={() => setView({ type: 'lessons' })}
          onNext={view.index < content.lessons.length - 1 ? () => setView({ type: 'lesson', index: view.index + 1 }) : null}
        />
      ) : null}

      {view.type === 'scenarios' ? (
        <ScenarioList
          scenarios={content.scenarios}
          packName={content.product.name}
          onBack={() => setView({ type: 'home' })}
          onSelect={(index) => setView({ type: 'scenario', index })}
        />
      ) : null}

      {view.type === 'scenario' ? <ScenarioDetail scenario={content.scenarios[view.index]} onBack={() => setView({ type: 'scenarios' })} /> : null}

      {view.type === 'checkride' ? (
        <CheckrideCornerView questions={content.checkride_corner} packName={content.product.name} onBack={() => setView({ type: 'home' })} />
      ) : null}

      {view.type === 'mastery' ? (
        <MasteryCheckView masteryCheck={content.mastery_check} packName={content.product.name} onBack={() => setView({ type: 'home' })} />
      ) : null}

      {view.type === 'quickref' ? (
        <QuickReferenceView quickReference={content.quick_reference} packName={content.product.name} onBack={() => setView({ type: 'home' })} />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  lockedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
})
