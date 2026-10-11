import { useState } from 'react'
import { TextInput, View, StyleSheet } from 'react-native'
import { AppText } from './AppText'
import { Card } from './Card'
import { Button } from './Button'
import { SectionHeader } from './SectionHeader'
import { colors, radii, spacing } from '../constants/theme'
import { upsertCheckrideDate } from '../lib/api/checkrideDateDirect'
import { countdownLabel, daysUntil, parseDateParts, urgencyBand, type CheckrideUrgencyBand } from '../lib/checkrideCountdown'

interface CheckrideCountdownCardProps {
  profileId: string
  checkrideDate: string | null
  onSaved: () => void
}

// Mobile parity (Phase 5, item 6): web's renderCheckrideCountdown() has no
// mobile equivalent even though training.checkride_date is already in the
// mobile-bootstrap DTO -- this port keeps the exact same day-math (local
// midnight to local midnight, so "today" means today in the learner's own
// timezone, not a UTC boundary) and the same three urgent/soon/normal
// bands, since those are judgment calls already made on web and this is a
// port, not a redesign.
export function CheckrideCountdownCard({ profileId, checkrideDate, onSaved }: CheckrideCountdownCardProps) {
  const [editing, setEditing] = useState(!checkrideDate)

  if (editing) {
    return (
      <Card accent="gold">
        <SectionHeader title="Checkride Countdown" icon="calendar-outline" accent="gold" />
        <CheckrideDateEditor
          profileId={profileId}
          initialValue={checkrideDate}
          onSaved={() => {
            setEditing(false)
            onSaved()
          }}
          onCancel={checkrideDate ? () => setEditing(false) : undefined}
        />
      </Card>
    )
  }

  const days = daysUntil(checkrideDate!)
  const band = urgencyBand(days)

  return (
    <Card accent="gold">
      <SectionHeader title="Checkride Countdown" icon="calendar-outline" accent="gold" />
      <View style={styles.row}>
        <AppText variant="display" weight="bold" color={bandColor(band)} style={styles.value}>
          {countdownLabel(days)}
        </AppText>
        <Button label="Edit" variant="ghost" onPress={() => setEditing(true)} />
      </View>
    </Card>
  )
}

function CheckrideDateEditor({
  profileId,
  initialValue,
  onSaved,
  onCancel,
}: {
  profileId: string
  initialValue: string | null
  onSaved: () => void
  onCancel?: () => void
}) {
  const initial = initialValue ? initialValue.split('-') : ['', '', '']
  const [year, setYear] = useState(initial[0] ?? '')
  const [month, setMonth] = useState(initial[1] ?? '')
  const [day, setDay] = useState(initial[2] ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseDateParts(year, month, day)

  async function handleSave() {
    if (!parsed) {
      setError('Enter a valid date.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await upsertCheckrideDate(profileId, parsed)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that date. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.editor}>
      <AppText variant="body" color={colors.mutedText}>
        Add your expected checkride date to see a live countdown.
      </AppText>
      <View style={styles.dateRow}>
        <DatePart label="MM" value={month} onChangeText={setMonth} maxLength={2} />
        <AppText variant="subtitle" color={colors.mutedText}>/</AppText>
        <DatePart label="DD" value={day} onChangeText={setDay} maxLength={2} />
        <AppText variant="subtitle" color={colors.mutedText}>/</AppText>
        <DatePart label="YYYY" value={year} onChangeText={setYear} maxLength={4} width={64} />
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.dateRow}>
        <Button label="Save Date" onPress={handleSave} loading={saving} disabled={!parsed} />
        {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={saving} /> : null}
      </View>
    </View>
  )
}

function DatePart({
  label,
  value,
  onChangeText,
  maxLength,
  width = 48,
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  maxLength: number
  width?: number
}) {
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, '').slice(0, maxLength))}
      placeholder={label}
      placeholderTextColor={colors.mutedText}
      keyboardType="number-pad"
      maxLength={maxLength}
      style={[styles.dateInput, { width }]}
      accessibilityLabel={`Checkride date ${label}`}
    />
  )
}

function bandColor(band: CheckrideUrgencyBand): string {
  if (band === 'today' || band === 'urgent') return colors.danger
  if (band === 'soon') return colors.goldDeep
  return colors.navy
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  value: { flex: 1 },
  editor: { gap: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.navy,
    textAlign: 'center',
  },
})
