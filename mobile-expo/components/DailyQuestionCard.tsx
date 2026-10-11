import { useState } from 'react'
import { Pressable, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { AppText } from './AppText'
import { Card } from './Card'
import { Button } from './Button'
import { SectionHeader } from './SectionHeader'
import { LoadingState, ErrorState } from './StateViews'
import { setQuestionFavorited, setQuestionStudied, touchQuestionLastViewed } from '../lib/api/dpeLibraryDirect'
import { ensureStudyActivityToday } from '../lib/api/studyActivityDirect'
import { colors, spacing } from '../constants/theme'
import type { ApiError } from '../lib/api/errors'
import type { MobileDailyQuestion, MobileDpeQuestionProgress } from '../../shared/mobile-dto'

interface DailyQuestionCardProps {
  profileId: string
  question: MobileDailyQuestion | null
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  // Only an entitled account can actually start Rapid Fire -- a free
  // account still gets the free daily question itself (matching web's
  // own free QOTD exemption), just not the paid follow-up CTA.
  entitled: boolean
}

// Mobile parity (Phase 5, item 4): the top-of-funnel free engagement
// hook web's Question of the Day already is, with none of it on mobile
// before now. Reuses the exact same portal_question_progress writes as
// the DPE Question Library (same question id space, same table) --
// favoriting or studying today's question from here is the same action
// as doing it from the Library.
export function DailyQuestionCard({ profileId, question, loading, error, onRetry, entitled }: DailyQuestionCardProps) {
  const [revealed, setRevealed] = useState(false)
  const [progress, setProgress] = useState<MobileDpeQuestionProgress>({ favorited: false, completed: false, last_viewed_at: null })

  if (loading) {
    return (
      <Card>
        <SectionHeader title="Question of the Day" icon="sunny-outline" accent="gold" />
        <LoadingState label="Loading today’s question…" />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <SectionHeader title="Question of the Day" icon="sunny-outline" accent="gold" />
        <ErrorState message={error.userMessage} onRetry={onRetry} />
      </Card>
    )
  }

  if (!question) return null

  function handleReveal() {
    setRevealed(true)
    touchQuestionLastViewed(profileId, question!.id, !!progress.last_viewed_at).catch(() => {})
    ensureStudyActivityToday(profileId)
    setProgress((prev) => ({ ...prev, last_viewed_at: new Date().toISOString() }))
  }

  function handleToggleFavorite() {
    const next = { ...progress, favorited: !progress.favorited }
    setProgress(next)
    setQuestionFavorited(profileId, question!.id, next.favorited).catch(() => {
      setProgress((prev) => ({ ...prev, favorited: !next.favorited }))
    })
  }

  function handleToggleStudied() {
    const next = { ...progress, completed: !progress.completed }
    setProgress(next)
    setQuestionStudied(profileId, question!.id, next.completed).catch(() => {
      setProgress((prev) => ({ ...prev, completed: !next.completed }))
    })
  }

  return (
    <Card accent="gold">
      <SectionHeader title="Question of the Day" subtitle={question.category_label} icon="sunny-outline" accent="gold" />

      <View style={styles.questionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={progress.favorited ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityState={{ selected: progress.favorited }}
          onPress={handleToggleFavorite}
          hitSlop={8}
        >
          <Ionicons name={progress.favorited ? 'star' : 'star-outline'} size={20} color={progress.favorited ? colors.gold : colors.mutedText} />
        </Pressable>
        <AppText variant="subtitle" weight="semibold" style={styles.questionText}>
          {question.question}
        </AppText>
      </View>

      {!revealed ? (
        <Button label="Reveal Answer" onPress={handleReveal} accessibilityHint="Show the model answer after you've answered out loud" />
      ) : (
        <View style={styles.answer}>
          <AppText variant="body">{question.model_answer}</AppText>
          {question.dpe_evaluating ? (
            <View style={styles.field}>
              <AppText variant="label" weight="semibold" color={colors.goldDeep}>
                WHAT THE DPE IS EVALUATING
              </AppText>
              <AppText variant="body">{question.dpe_evaluating}</AppText>
            </View>
          ) : null}
          {question.real_world_application ? (
            <View style={styles.field}>
              <AppText variant="label" weight="semibold" color={colors.goldDeep}>
                REAL-WORLD APPLICATION
              </AppText>
              <AppText variant="body">{question.real_world_application}</AppText>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Mark as studied"
            accessibilityState={{ checked: progress.completed }}
            onPress={handleToggleStudied}
            style={styles.studiedRow}
          >
            <Ionicons
              name={progress.completed ? 'checkbox' : 'square-outline'}
              size={20}
              color={progress.completed ? colors.success : colors.mutedText}
            />
            <AppText variant="body" color={progress.completed ? colors.success : colors.mutedText}>
              Mark as studied
            </AppText>
          </Pressable>

          {entitled ? (
            <Button
              label="Another Round →"
              variant="ghost"
              onPress={() => router.push('/(app)/practice')}
              accessibilityHint="Go to Practice to start a timed DPE Rapid Fire round"
            />
          ) : null}
        </View>
      )}

      <AppText variant="caption" color={colors.mutedText}>
        New DPE question every day — come back tomorrow.
      </AppText>
    </Card>
  )
}

const styles = StyleSheet.create({
  questionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  questionText: { flex: 1 },
  answer: { gap: spacing.md },
  field: { gap: spacing.xs },
  studiedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
})
