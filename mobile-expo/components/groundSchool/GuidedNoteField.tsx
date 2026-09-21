import { useState } from 'react'
import { TextInput, View, StyleSheet } from 'react-native'
import { AppText } from '../AppText'
import { Card } from '../Card'
import { Button } from '../Button'
import { colors, radii, spacing } from '../../constants/theme'

interface GuidedNoteFieldProps {
  sectionLabel?: string | null
  prompt: string
  initialValue: string
  saving: boolean
  saveError: string | null
  singleLine?: boolean
  onChangeDebounced: (value: string) => void
  onSaveNow: (value: string) => void
}

// One free-text guided-note card -- shared by every rich-content section
// (Guided Notes, Key Concepts, Scenario Workshop, Checkride Corner
// answers, Knowledge Check, Reflection, Apex Challenge), mirroring
// site/portal-stable.js's own single textFieldCard()/
// wireGuidedNoteTextCards() used by every one of those sections.
// Autosaves AUTOSAVE_DELAY_MS after the learner stops typing (via
// onChangeDebounced) in addition to an explicit Save button
// (onSaveNow) -- matching web's "autosave or manual save" contract
// exactly.
export function GuidedNoteField({
  sectionLabel,
  prompt,
  initialValue,
  saving,
  saveError,
  singleLine,
  onChangeDebounced,
  onSaveNow,
}: GuidedNoteFieldProps) {
  const [value, setValue] = useState(initialValue)

  function handleChange(text: string) {
    setValue(text)
    onChangeDebounced(text)
  }

  return (
    <Card>
      {sectionLabel ? (
        <AppText variant="label" weight="semibold" color={colors.goldDeep}>
          {sectionLabel.toUpperCase()}
        </AppText>
      ) : null}
      <AppText variant="body" weight="semibold">
        {prompt}
      </AppText>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="Type your response…"
        placeholderTextColor={colors.mutedText}
        multiline={!singleLine}
        numberOfLines={singleLine ? 1 : 4}
        style={[styles.input, singleLine ? styles.inputSingleLine : styles.inputMultiline]}
      />
      <View style={styles.footer}>
        <AppText variant="caption" color={saveError ? colors.danger : colors.mutedText}>
          {saveError ?? (saving ? 'Saving…' : 'Autosaves as you type')}
        </AppText>
        <Button label="Save" variant="ghost" onPress={() => onSaveNow(value)} loading={saving} />
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.navy,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  inputSingleLine: { minHeight: 44 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
})
