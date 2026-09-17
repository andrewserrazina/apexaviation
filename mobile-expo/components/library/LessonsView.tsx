import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { MobileStudyPackKnowledgeCheckQuestion, MobileStudyPackLesson } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { LibraryBackButton } from './LibraryBackButton'

// Same six rendered lesson sections, in the same order, as the web Study
// Pack renderer's SP_LESSON_SECTION_LABELS (site/portal-stable.js) --
// `portal_presentation_guidance` is deliberately absent from both that
// list and from MobileStudyPackLessonSections itself (Sprint 1C Phase 0).
const SECTION_LABELS: { key: keyof MobileStudyPackLesson['sections']; label: string }[] = [
  { key: 'what_is_it', label: 'What Is It?' },
  { key: 'why_it_matters', label: 'Why It Matters' },
  { key: 'flight_operations', label: 'How It Affects Flight Operations' },
  { key: 'adm_legal_vs_wise', label: 'Legal vs. Wise' },
  { key: 'checkride_connection', label: 'How This Could Appear on Your Checkride' },
  { key: 'safety_connection', label: 'Safety Connection' },
]

function KnowledgeCheckItem({ question, index }: { question: MobileStudyPackKnowledgeCheckQuestion; index: number }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <Card>
      <AppText variant="body" weight="semibold">
        {index + 1}. {question.question}
      </AppText>
      {revealed ? (
        <View style={styles.answerBlock}>
          <AppText variant="body" color={colors.success}>
            Answer: {question.correct_answer}
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            {question.explanation}
          </AppText>
          {question.common_mistake ? (
            <AppText variant="caption" color={colors.danger}>
              Common mistake: {question.common_mistake}
            </AppText>
          ) : null}
        </View>
      ) : (
        <Button label="Reveal Answer" variant="ghost" onPress={() => setRevealed(true)} />
      )}
    </Card>
  )
}

export function LessonList({ lessons, onSelect, onBack, packName }: { lessons: MobileStudyPackLesson[]; onSelect: (index: number) => void; onBack: () => void; packName: string }) {
  return (
    <View style={styles.wrap}>
      <LibraryBackButton label={packName} onPress={onBack} />
      <AppText variant="title" heading weight="bold">
        Lessons
      </AppText>
      {lessons.map((lesson, index) => (
        <Card key={lesson.id}>
          <AppText variant="label" weight="semibold" color={colors.mutedText}>
            LESSON {lesson.lesson_number}
          </AppText>
          <AppText variant="subtitle" weight="semibold">
            {lesson.title}
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            {lesson.estimated_time}
          </AppText>
          <Button label="Open Lesson" onPress={() => onSelect(index)} />
        </Card>
      ))}
    </View>
  )
}

export function LessonDetail({ lesson, totalLessons, onBack, onNext }: { lesson: MobileStudyPackLesson; totalLessons: number; onBack: () => void; onNext: (() => void) | null }) {
  return (
    <View style={styles.wrap}>
      <LibraryBackButton label="Lessons" onPress={onBack} />
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        LESSON {lesson.lesson_number} OF {totalLessons}
      </AppText>
      <AppText variant="title" heading weight="bold">
        {lesson.title}
      </AppText>

      {lesson.intro.length > 0 ? (
        <View style={styles.paragraphs}>
          {lesson.intro.map((p, i) => (
            <AppText key={i} variant="body" color={colors.mutedText}>
              {p}
            </AppText>
          ))}
        </View>
      ) : null}

      {SECTION_LABELS.map(({ key, label }) => {
        const paragraphs = lesson.sections[key]
        if (!paragraphs || paragraphs.length === 0) return null
        return (
          <View key={key} style={styles.section}>
            <AppText variant="label" weight="semibold" color={colors.goldDeep}>
              {label.toUpperCase()}
            </AppText>
            {paragraphs.map((p, i) => (
              <AppText key={i} variant="body" color={colors.mutedText}>
                {p}
              </AppText>
            ))}
          </View>
        )
      })}

      <AppText variant="subtitle" weight="semibold" style={styles.knowledgeCheckHeading}>
        Knowledge Check
      </AppText>
      {lesson.knowledge_check.map((q, i) => (
        <KnowledgeCheckItem key={q.id} question={q} index={i} />
      ))}

      {onNext ? <Button label="Next Lesson →" onPress={onNext} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  paragraphs: { gap: spacing.xs },
  section: { gap: spacing.xs },
  answerBlock: { gap: 4 },
  knowledgeCheckHeading: { marginTop: spacing.sm },
})
