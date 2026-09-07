import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { ErrorState, LoadingState } from '../../../components/StateViews'
import { PackHome } from '../../../components/library/PackHome'
import { LessonList, LessonDetail } from '../../../components/library/LessonsView'
import { ScenarioList, ScenarioDetail } from '../../../components/library/ScenariosView'
import { CheckrideCornerView } from '../../../components/library/CheckrideCornerView'
import { MasteryCheckView } from '../../../components/library/MasteryCheckView'
import { QuickReferenceView } from '../../../components/library/QuickReferenceView'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useLibraryCatalog } from '../../../hooks/useLibraryCatalog'
import { useLibraryContent } from '../../../hooks/useLibraryContent'
import { colors, spacing } from '../../../constants/theme'

type PackView =
  | { type: 'home' }
  | { type: 'lessons' }
  | { type: 'lesson'; index: number }
  | { type: 'scenarios' }
  | { type: 'scenario'; index: number }
  | { type: 'checkride' }
  | { type: 'mastery' }
  | { type: 'quickref' }

// Rev2 (independent review): this screen used to trust `owned`/`name`
// route params as entitlement authority -- a notification (or a
// hand-crafted deep link) could pass owned:'false' for a pack the
// learner actually owns and the pack would render locked, or in
// principle the reverse. Route params are now UNTRUSTED: the only
// trusted input is `packId`, and ownership/name are resolved by asking
// the authenticated mobile-library catalog directly, the exact same
// server-provided data the Library tab itself renders. The `content`
// action's own entitlement re-check remains the final authority
// regardless -- this screen only ever uses the catalog's `owned` to
// decide whether to call it at all.
export default function PackDetailScreen() {
  const params = useLocalSearchParams<{ packId: string }>()
  const packId = params.packId ?? ''

  const bootstrap = useBootstrapContext()
  const catalog = useLibraryCatalog({ enabled: bootstrap.ready })
  const pack = catalog.data?.packs.find((p) => p.id === packId) ?? null
  const owned = pack?.owned === true

  const { content, loading: contentLoading, error: contentError, refetch: refetchContent } = useLibraryContent({ packId, enabled: owned })
  const [view, setView] = useState<PackView>({ type: 'home' })

  function retry() {
    catalog.refresh()
    refetchContent()
  }

  if (!bootstrap.ready || catalog.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Study Pack…" />
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

  // The catalog resolved successfully but has no pack with this id --
  // an honest not-found state, never a guess at ownership.
  if (!pack) {
    return (
      <Screen scroll={false}>
        <View style={styles.lockedWrap}>
          <AppText variant="title" heading weight="bold" center>
            Study Pack not found
          </AppText>
          <AppText variant="body" color={colors.mutedText} center>
            We couldn’t find that Study Pack on this account.
          </AppText>
        </View>
      </Screen>
    )
  }

  if (!owned) {
    return (
      <Screen scroll={false}>
        <View style={styles.lockedWrap}>
          <AppText variant="title" heading weight="bold" center>
            {pack.name}
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

  if (contentLoading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Study Pack…" />
      </Screen>
    )
  }

  // The catalog said this pack is owned, but the server's own
  // entitlement re-check on the content action disagreed (a stale local
  // catalog, a revoked entitlement between the two calls, etc.) -- fail
  // closed to a normal retryable error, which also refreshes the catalog
  // itself rather than ever rendering privileged content.
  if (contentError || !content) {
    return (
      <Screen scroll={false}>
        <ErrorState message={contentError?.userMessage ?? 'We couldn’t load this Study Pack.'} onRetry={retry} />
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
