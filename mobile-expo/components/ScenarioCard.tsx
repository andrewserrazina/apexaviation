import { useState } from 'react'
import { Pressable, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { AppText } from './AppText'
import { Card } from './Card'
import { Button } from './Button'
import { colors, spacing } from '../constants/theme'
import type { MobileDpeQuestion, MobileDpeQuestionProgress } from '../../shared/mobile-dto'

interface ScenarioCardProps {
  scenario: MobileDpeQuestion
  categoryLabel: string
  progress: MobileDpeQuestionProgress | undefined
  onToggleFavorite: () => void
  onToggleStudied: () => void
  onReveal: () => void
}

// Mobile parity (Phase 5, item 2): ports web's Scenario Training Center
// card layout (renderScenarios(), site/portal-stable.js) -- deliberately
// its OWN component rather than reusing the DPE Question Library's
// QuestionCard: a scenario's brief is always visible (the whole point is
// to think it through before revealing the model answer), the reveal is
// its own button with its own copy, and "reviewed" is the vocabulary web
// uses here, not "studied." Underlying data and writes are still the
// exact same question bank/favorite/studied semantics as the Library.
export function ScenarioCard({ scenario, categoryLabel, progress, onToggleFavorite, onToggleStudied, onReveal }: ScenarioCardProps) {
  const [revealed, setRevealed] = useState(false)
  const isFavorited = progress?.favorited ?? false
  const isReviewed = progress?.completed ?? false

  function handleReveal() {
    if (!revealed) onReveal()
    setRevealed((prev) => !prev)
  }

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <AppText variant="label" weight="semibold" color={colors.goldDeep}>
            {categoryLabel.toUpperCase()}
          </AppText>
          <AppText
            variant="caption"
            weight="semibold"
            color={isReviewed ? colors.success : colors.mutedText}
          >
            {isReviewed ? '✓ Reviewed' : 'Not Reviewed'}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityState={{ selected: isFavorited }}
          onPress={onToggleFavorite}
          hitSlop={8}
        >
          <Ionicons name={isFavorited ? 'star' : 'star-outline'} size={20} color={isFavorited ? colors.gold : colors.mutedText} />
        </Pressable>
      </View>

      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        THE SCENARIO
      </AppText>
      <AppText variant="subtitle" weight="semibold">
        {scenario.question}
      </AppText>
      {scenario.real_world_application ? <AppText variant="body">{scenario.real_world_application}</AppText> : null}
      <AppText variant="caption" color={colors.mutedText}>
        Think through your decision out loud before revealing the model answer -- that’s what actually builds checkride-ready recall.
      </AppText>

      <Button
        label={revealed ? 'Hide Model Answer' : 'Reveal Model Answer'}
        variant="secondary"
        onPress={handleReveal}
        accessibilityHint="Show the model answer after you've talked through your decision"
      />

      {revealed ? (
        <View style={styles.answer}>
          <Field label="Model Answer" value={scenario.model_answer} />
          <Field label="Common Student Mistakes" value={scenario.common_mistakes} />
          <Field label="What the DPE Is Evaluating" value={scenario.dpe_evaluating} />
          <Field label="ACS Connection" value={scenario.acs_reference} />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Mark as reviewed"
            accessibilityState={{ checked: isReviewed }}
            onPress={onToggleStudied}
            style={styles.reviewedRow}
          >
            <Ionicons name={isReviewed ? 'checkbox' : 'square-outline'} size={20} color={isReviewed ? colors.success : colors.mutedText} />
            <AppText variant="body" color={isReviewed ? colors.success : colors.mutedText}>
              Mark as reviewed
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { gap: spacing.xs },
  answer: { gap: spacing.md, marginTop: spacing.sm },
  field: { gap: spacing.xs },
  reviewedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
})
