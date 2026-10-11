import { useState, type ReactNode } from 'react'
import { Pressable, TextInput, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Screen } from '../../../components/Screen'
import { AppText } from '../../../components/AppText'
import { Card } from '../../../components/Card'
import { Button } from '../../../components/Button'
import { SectionHeader } from '../../../components/SectionHeader'
import { ErrorState, LoadingState, LockedState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useDpeLibrary } from '../../../hooks/useDpeLibrary'
import { setQuestionFavorited, setQuestionStudied, touchQuestionLastViewed } from '../../../lib/api/dpeLibraryDirect'
import { filterDpeLibrary, type DpeLibraryFilterTab } from '../../../lib/dpeLibraryFilter'
import { colors, radii, spacing } from '../../../constants/theme'
import type { MobileDpeQuestion, MobileDpeQuestionProgress } from '../../../../shared/mobile-dto'

// Mobile parity (Phase 5, item 1): the top-priority gap from the web-vs-
// mobile parity audit -- web's full DPE Question Library (search,
// category filters, answer reveal, favorites) had no mobile equivalent;
// questions only ever appeared one at a time inside a drill/practice
// session. Ports web's renderDpeLibrary() (site/portal-stable.js)
// faithfully: same question bank, same categories, same favorite/studied
// semantics -- not a new content system.
export default function DpeLibraryScreen() {
  const bootstrap = useBootstrapContext()
  const library = useDpeLibrary({ enabled: bootstrap.ready && bootstrap.entitled })
  const [activeTab, setActiveTab] = useState<DpeLibraryFilterTab>('all')
  const [search, setSearch] = useState('')
  // Local overlay on top of library.data.progress -- so a favorite/studied
  // toggle reflects instantly without waiting on a full refetch, same
  // reasoning as every other direct-write screen in this app
  // (useGuidedNotes, useModuleQuiz).
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
        <LoadingState label="Loading the question library…" />
      </Screen>
    )
  }

  const progress = { ...library.data.progress, ...progressOverlay }

  function handleToggleFavorite(question: MobileDpeQuestion) {
    const current = progress[question.id] ?? { favorited: false, completed: false, last_viewed_at: null }
    const next = { ...current, favorited: !current.favorited }
    setProgressOverlay((prev) => ({ ...prev, [question.id]: next }))
    setQuestionFavorited(profileId, question.id, next.favorited).catch(() => {
      // Revert on failure so the star never lies about what's actually saved.
      setProgressOverlay((prev) => ({ ...prev, [question.id]: current }))
    })
  }

  function handleToggleStudied(question: MobileDpeQuestion) {
    const current = progress[question.id] ?? { favorited: false, completed: false, last_viewed_at: null }
    const next = { ...current, completed: !current.completed }
    setProgressOverlay((prev) => ({ ...prev, [question.id]: next }))
    setQuestionStudied(profileId, question.id, next.completed).catch(() => {
      setProgressOverlay((prev) => ({ ...prev, [question.id]: current }))
    })
  }

  function handleReveal(question: MobileDpeQuestion) {
    const current = progress[question.id]
    touchQuestionLastViewed(profileId, question.id, !!current?.last_viewed_at).catch(() => {})
    setProgressOverlay((prev) => ({
      ...prev,
      [question.id]: { ...(current ?? { favorited: false, completed: false, last_viewed_at: null }), last_viewed_at: new Date().toISOString() },
    }))
  }

  const groups = filterDpeLibrary(library.data.categories, library.data.questions, progress, activeTab, search)
  const favoriteCount = library.data.questions.filter((q) => progress[q.id]?.favorited).length

  return (
    <Screen>
      <SectionHeader title="DPE Question Library" subtitle="Search, filter, and study the full question bank" icon="library-outline" />

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search questions…"
        placeholderTextColor={colors.mutedText}
        style={styles.search}
        accessibilityLabel="Search the question library"
      />

      <View style={styles.tabsRow}>
        <FilterTab label="All" active={activeTab === 'all'} onPress={() => setActiveTab('all')} />
        <FilterTab label={`Favorites (${favoriteCount})`} active={activeTab === 'favorites'} onPress={() => setActiveTab('favorites')} />
        {library.data.categories.map((category) => (
          <FilterTab key={category.id} label={category.label} active={activeTab === category.id} onPress={() => setActiveTab(category.id)} />
        ))}
      </View>

      {groups.length === 0 ? (
        <Card>
          <AppText variant="body" color={colors.mutedText} center>
            No questions match {search ? 'your search' : 'this filter'}.
          </AppText>
        </Card>
      ) : (
        groups.map((group) => (
          <View key={group.category.id} style={styles.group}>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              {group.category.label.toUpperCase()} ({group.questions.length})
            </AppText>
            {group.questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                progress={progress[question.id]}
                onToggleFavorite={() => handleToggleFavorite(question)}
                onToggleStudied={() => handleToggleStudied(question)}
                onReveal={() => handleReveal(question)}
              />
            ))}
          </View>
        ))
      )}

      <Button label="Back to Practice" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

function FilterTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <AppText variant="caption" weight="semibold" color={active ? colors.white : colors.navy}>
        {label}
      </AppText>
    </Pressable>
  )
}

function fieldBlock(label: string, value: string | null): ReactNode {
  if (!value) return null
  return (
    <View style={styles.field}>
      <AppText variant="label" weight="semibold" color={colors.goldDeep}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  )
}

function QuestionCard({
  question,
  progress,
  onToggleFavorite,
  onToggleStudied,
  onReveal,
}: {
  question: MobileDpeQuestion
  progress: MobileDpeQuestionProgress | undefined
  onToggleFavorite: () => void
  onToggleStudied: () => void
  onReveal: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isFavorited = progress?.favorited ?? false
  const isStudied = progress?.completed ?? false

  function handlePress() {
    if (!expanded) onReveal()
    setExpanded((prev) => !prev)
  }

  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={question.question} onPress={handlePress} style={styles.questionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityState={{ selected: isFavorited }}
          onPress={onToggleFavorite}
          hitSlop={8}
        >
          <Ionicons name={isFavorited ? 'star' : 'star-outline'} size={20} color={isFavorited ? colors.gold : colors.mutedText} />
        </Pressable>
        <AppText variant="body" weight="semibold" style={styles.questionText}>
          {question.question}
        </AppText>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />
      </Pressable>

      {expanded ? (
        <View style={styles.answer}>
          {fieldBlock('Model Answer', question.model_answer)}
          {fieldBlock('Common Student Mistakes', question.common_mistakes)}
          {fieldBlock('What the DPE Is Evaluating', question.dpe_evaluating)}
          {fieldBlock('Real-World Application', question.real_world_application)}
          {question.acs_reference ? (
            <View style={styles.field}>
              <AppText variant="label" weight="semibold" color={colors.goldDeep}>
                ACS CONNECTION
              </AppText>
              <AppText variant="body">{question.acs_reference}</AppText>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Mark as studied"
            accessibilityState={{ checked: isStudied }}
            onPress={onToggleStudied}
            style={styles.studiedRow}
          >
            <Ionicons name={isStudied ? 'checkbox' : 'square-outline'} size={20} color={isStudied ? colors.success : colors.mutedText} />
            <AppText variant="body" color={isStudied ? colors.success : colors.mutedText}>
              Mark as studied
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.navy,
    backgroundColor: colors.white,
  },
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.navySoft,
  },
  tabActive: { backgroundColor: colors.navy },
  group: { gap: spacing.sm },
  questionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  questionText: { flex: 1 },
  answer: { gap: spacing.md, marginTop: spacing.sm },
  field: { gap: spacing.xs },
  studiedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
})
