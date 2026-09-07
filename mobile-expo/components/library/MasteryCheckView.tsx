import { useMemo, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { MobileStudyPackMasteryCheck } from '../../../shared/mobile-dto'
import { colors, radii, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { LibraryBackButton } from './LibraryBackButton'

// Grading is computed locally, never submitted anywhere -- there is no
// mobile progress-tracking/attempt endpoint for Study Packs in this
// Sprint (the web's submit_study_pack_attempt() RPC is a separate,
// direct-Supabase-client web-only path, not part of the mobile-* Edge
// Function contract this app calls through). This view exists purely to
// let a learner self-check their understanding of a pack they already
// own; it never claims to record a certificate or progress.
export function MasteryCheckView({ masteryCheck, onBack, packName }: { masteryCheck: MobileStudyPackMasteryCheck; onBack: () => void; packName: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const unanswered = masteryCheck.questions.filter((q) => !answers[q.id]).length

  const { score, total, passed } = useMemo(() => {
    const t = masteryCheck.questions.length
    const s = masteryCheck.questions.filter((q) => answers[q.id] === q.correct_option).length
    const pct = t > 0 ? Math.round((s / t) * 100) : 0
    return { score: s, total: t, passed: pct >= masteryCheck.passing_percent }
  }, [answers, masteryCheck])

  if (submitted) {
    const pct = total > 0 ? Math.round((score / total) * 100) : 0
    return (
      <View style={styles.wrap}>
        <LibraryBackButton label={packName} onPress={onBack} />
        <AppText variant="title" heading weight="bold" color={passed ? colors.success : colors.navy}>
          {pct}% — {passed ? 'Passed' : 'Not Yet'}
        </AppText>
        <AppText variant="body" color={colors.mutedText}>
          {score} of {total} correct ({masteryCheck.passing_percent}% required).
        </AppText>
        {masteryCheck.questions.map((q, i) => {
          const yourKey = answers[q.id]
          const correct = yourKey === q.correct_option
          const yourText = q.options.find((o) => o.key === yourKey)?.text ?? '(no answer)'
          const correctText = q.options.find((o) => o.key === q.correct_option)?.text ?? ''
          return (
            <Card key={q.id}>
              <View style={styles.reviewHeader}>
                <AppText variant="label" weight="semibold" color={colors.mutedText}>
                  QUESTION {i + 1}
                </AppText>
                <AppText variant="label" weight="semibold" color={correct ? colors.success : colors.danger}>
                  {correct ? '✓ Correct' : '✗ Incorrect'}
                </AppText>
              </View>
              <AppText variant="body" weight="semibold">
                {q.question}
              </AppText>
              <AppText variant="caption" color={colors.mutedText}>
                Your answer: {yourText}
              </AppText>
              {!correct ? (
                <AppText variant="caption" color={colors.success}>
                  Correct answer: {correctText}
                </AppText>
              ) : null}
              <AppText variant="caption" color={colors.mutedText}>
                {q.explanation}
              </AppText>
            </Card>
          )
        })}
        {!passed ? <Button label="Retake Mastery Check" onPress={() => setSubmitted(false)} /> : null}
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      <LibraryBackButton label={packName} onPress={onBack} />
      <AppText variant="title" heading weight="bold">
        Mastery Check
      </AppText>
      <AppText variant="caption" color={colors.mutedText}>
        Answer all {masteryCheck.questions.length} questions, {masteryCheck.passing_percent}% to pass.
      </AppText>
      {masteryCheck.questions.map((q, i) => (
        <Card key={q.id}>
          <AppText variant="body" weight="semibold">
            {i + 1}. {q.question}
          </AppText>
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.key
            return (
              <Button
                key={opt.key}
                label={opt.text}
                variant={selected ? 'primary' : 'ghost'}
                onPress={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.key }))}
                style={styles.optionButton}
              />
            )
          })}
        </Card>
      ))}
      <Button
        label={unanswered > 0 ? `Answer all questions (${unanswered} remaining)` : 'Submit Mastery Check'}
        onPress={() => setSubmitted(true)}
        disabled={unanswered > 0}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  optionButton: { marginTop: spacing.xs, borderRadius: radii.sm },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between' },
})
