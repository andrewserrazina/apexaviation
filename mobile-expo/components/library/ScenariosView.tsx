import { useState } from 'react'
import { View, TextInput, StyleSheet } from 'react-native'
import type { MobileStudyPackScenario } from '../../../shared/mobile-dto'
import { colors, radii, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { LibraryBackButton } from './LibraryBackButton'

export function ScenarioList({ scenarios, onSelect, onBack, packName }: { scenarios: MobileStudyPackScenario[]; onSelect: (index: number) => void; onBack: () => void; packName: string }) {
  return (
    <View style={styles.wrap}>
      <LibraryBackButton label={packName} onPress={onBack} />
      <AppText variant="title" heading weight="bold">
        Scenario Lab
      </AppText>
      {scenarios.map((scenario, index) => (
        <Card key={scenario.id}>
          <AppText variant="label" weight="semibold" color={colors.mutedText}>
            SCENARIO {scenario.scenario_number}
          </AppText>
          <AppText variant="subtitle" weight="semibold">
            {scenario.title}
          </AppText>
          <Button label="Open Scenario" onPress={() => onSelect(index)} />
        </Card>
      ))}
    </View>
  )
}

// The web renderer requires a written commitment before revealing the
// discussion/recommended action/debrief (site/portal-stable.js's
// renderStudyPackScenarioDetail) -- kept here since it's the exercise's
// whole pedagogical point (commit to a decision before seeing the
// answer), not persisted anywhere server-side in this Sprint (no
// progress-tracking endpoint exists for mobile yet).
export function ScenarioDetail({ scenario, onBack }: { scenario: MobileStudyPackScenario; onBack: () => void }) {
  const [commitment, setCommitment] = useState('')
  const [revealed, setRevealed] = useState(false)

  return (
    <View style={styles.wrap}>
      <LibraryBackButton label="Scenario Lab" onPress={onBack} />
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        SCENARIO {scenario.scenario_number}
      </AppText>
      <AppText variant="title" heading weight="bold">
        {scenario.title}
      </AppText>

      <Card>
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          SITUATION
        </AppText>
        <AppText variant="body" color={colors.mutedText}>
          {scenario.situation}
        </AppText>
      </Card>

      <Card>
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          DECISION POINT
        </AppText>
        <AppText variant="body" color={colors.mutedText}>
          {scenario.decision_point}
        </AppText>
      </Card>

      <Card>
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          YOUR COMMITMENT
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          {scenario.student_commitment_prompt}
        </AppText>
        <TextInput
          value={commitment}
          onChangeText={setCommitment}
          editable={!revealed}
          multiline
          numberOfLines={4}
          placeholder="What would you do?"
          placeholderTextColor={colors.mutedText}
          style={styles.input}
        />
        {!revealed ? (
          <Button label="Reveal Discussion" onPress={() => setRevealed(true)} disabled={commitment.trim().length === 0} />
        ) : null}
      </Card>

      {revealed ? (
        <>
          <Card>
            <AppText variant="label" weight="semibold" color={colors.goldDeep}>
              DISCUSSION
            </AppText>
            <AppText variant="body" color={colors.mutedText}>
              {scenario.reveal_discussion}
            </AppText>
          </Card>
          <Card>
            <AppText variant="label" weight="semibold" color={colors.goldDeep}>
              RECOMMENDED ACTION
            </AppText>
            <AppText variant="body" color={colors.mutedText}>
              {scenario.recommended_action}
            </AppText>
          </Card>
          <Card>
            <AppText variant="label" weight="semibold" color={colors.goldDeep}>
              DEBRIEF
            </AppText>
            <AppText variant="body" color={colors.mutedText}>
              {scenario.debrief}
            </AppText>
          </Card>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.navyBorder,
    borderRadius: radii.md,
    padding: spacing.sm,
    color: colors.navy,
    fontSize: 14,
    textAlignVertical: 'top',
  },
})
