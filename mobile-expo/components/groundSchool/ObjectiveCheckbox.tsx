import { Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { AppText } from '../AppText'
import { colors, spacing } from '../../constants/theme'

interface ObjectiveCheckboxProps {
  label: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}

// Mirrors web's Learning Objectives checkboxes -- a simple checked/
// unchecked toggle (guided_notes.response_text 'checked' | ''), no
// evidence write (objectives are a self-tracking aid, never scored --
// see site/portal-stable.js's wireModuleCompanionRich(), which never
// calls record_ground_school_evidence for this section).
export function ObjectiveCheckbox({ label, checked, disabled, onToggle }: ObjectiveCheckboxProps) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      style={styles.row}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.gold : colors.mutedText} />
      <AppText variant="body" color={checked ? colors.navy : colors.mutedText} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  label: { flex: 1 },
})
