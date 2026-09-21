import { Pressable, TextInput, View, StyleSheet } from 'react-native'
import type { MobileModuleQuizQuestion } from '../../../shared/mobile-dto'
import { AppText } from '../AppText'
import { Card } from '../Card'
import { Button } from '../Button'
import { colors, radii, spacing } from '../../constants/theme'

interface ModuleQuizViewProps {
  quiz: MobileModuleQuizQuestion[]
  answers: Record<string, string>
  onAnswer: (questionId: string, value: string) => void
  submitted: boolean
  results: Record<string, boolean>
  score: number
  total: number
  submitting: boolean
  submitError: string | null
  onSubmit: () => void
}

// Scored self-assessment quiz -- mirrors site/portal-stable.js's
// renderModuleQuizSection()/wireModuleQuizSection() exactly: correct
// answers/explanations arrive with the questions (self-study, not a
// proctored exam), scoring happens client-side, and only multiple_choice
// questions are objectively graded. Once submitted, every question shows
// its result/model answer and inputs lock -- there is no re-submit.
export function ModuleQuizView({
  quiz,
  answers,
  onAnswer,
  submitted,
  results,
  score,
  total,
  submitting,
  submitError,
  onSubmit,
}: ModuleQuizViewProps) {
  if (!quiz.length) return null

  return (
    <View style={styles.section}>
      <Card>
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          KNOWLEDGE CHECK
        </AppText>
        <AppText variant="subtitle" weight="semibold">
          Scored self-assessment quiz
        </AppText>
        {submitted ? (
          <AppText variant="body" color={colors.mutedText}>
            Scored {score} / {total} on the multiple-choice questions.
          </AppText>
        ) : null}
      </Card>

      {quiz.map((q, i) => {
        const isCorrect = results[q.id]
        const chosen = answers[q.id] ?? ''
        return (
          <Card key={q.id}>
            <AppText variant="body" weight="semibold">
              {i + 1}. {q.prompt}
            </AppText>

            {q.question_type === 'multiple_choice' && q.choices ? (
              <View style={styles.choices}>
                {q.choices.map((c) => {
                  const selected = chosen === c.key
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => !submitted && onAnswer(q.id, c.key)}
                      disabled={submitted}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: submitted }}
                      accessibilityLabel={`${c.key}) ${c.label}`}
                      style={[styles.choiceRow, selected ? styles.choiceRowSelected : null]}
                    >
                      <AppText variant="body" color={selected ? colors.navy : colors.mutedText}>
                        {c.key}) {c.label}
                      </AppText>
                    </Pressable>
                  )
                })}
              </View>
            ) : (
              <TextInput
                value={chosen}
                onChangeText={(text) => onAnswer(q.id, text)}
                editable={!submitted}
                multiline
                numberOfLines={2}
                placeholder="Your answer (self-graded — the explanation shows once you submit)…"
                placeholderTextColor={colors.mutedText}
                style={styles.freeText}
              />
            )}

            {submitted ? (
              <View style={styles.resultBox}>
                <AppText variant="caption" weight="semibold" color={isCorrect === true ? colors.success : isCorrect === false ? colors.danger : colors.goldDeep}>
                  {isCorrect === true ? 'Correct.' : isCorrect === false ? 'Not quite.' : 'Model answer:'}
                </AppText>
                <AppText variant="caption" color={colors.mutedText}>
                  {q.model_answer}
                </AppText>
              </View>
            ) : null}
          </Card>
        )
      })}

      {!submitted ? (
        <Button label="Submit Quiz" onPress={onSubmit} loading={submitting} />
      ) : null}
      {submitError ? (
        <AppText variant="caption" color={colors.danger}>
          {submitError}
        </AppText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  choices: { gap: spacing.xs },
  choiceRow: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sm },
  choiceRowSelected: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  freeText: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    minHeight: 70,
    textAlignVertical: 'top',
    color: colors.navy,
  },
  resultBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 },
})
