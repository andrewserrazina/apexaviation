import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { MobileStudyPackCheckrideQuestion } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { LibraryBackButton } from './LibraryBackButton'

function CheckrideQuestionCard({ question }: { question: MobileStudyPackCheckrideQuestion }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <Card>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        {question.topic.toUpperCase()}
      </AppText>
      <AppText variant="body" weight="semibold">
        {question.question}
      </AppText>
      {revealed ? (
        <View style={styles.answerBlock}>
          <AppText variant="body" color={colors.success}>
            {question.model_answer}
          </AppText>
          <AppText variant="caption" color={colors.danger}>
            Common mistake: {question.common_student_mistake}
          </AppText>
          {question.dpe_follow_up ? (
            <AppText variant="caption" color={colors.mutedText}>
              DPE follow-up: {question.dpe_follow_up}
            </AppText>
          ) : null}
          {question.strong_follow_up_answer ? (
            <AppText variant="caption" color={colors.mutedText}>
              {question.strong_follow_up_answer}
            </AppText>
          ) : null}
        </View>
      ) : (
        <Button label="Show Answer" variant="ghost" onPress={() => setRevealed(true)} />
      )}
    </Card>
  )
}

// Groups by difficulty_label preserving each question's own source
// order within its group, matching the web renderer's grouping
// (site/portal-stable.js's renderStudyPackCheckrideCorner) -- never
// re-sorted or re-leveled client-side.
export function CheckrideCornerView({ questions, onBack, packName }: { questions: MobileStudyPackCheckrideQuestion[]; onBack: () => void; packName: string }) {
  const groups: { label: string; items: MobileStudyPackCheckrideQuestion[] }[] = []
  for (const q of questions) {
    const existing = groups.find((g) => g.label === q.difficulty_label)
    if (existing) existing.items.push(q)
    else groups.push({ label: q.difficulty_label, items: [q] })
  }

  return (
    <View style={styles.wrap}>
      <LibraryBackButton label={packName} onPress={onBack} />
      <AppText variant="title" heading weight="bold">
        Checkride Corner
      </AppText>
      <AppText variant="caption" color={colors.mutedText}>
        {questions.length} DPE-style questions
      </AppText>
      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <AppText variant="subtitle" weight="semibold">
            {group.label}
          </AppText>
          {group.items.map((q) => (
            <CheckrideQuestionCard key={q.id} question={q} />
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.sm },
  answerBlock: { gap: 4 },
})
