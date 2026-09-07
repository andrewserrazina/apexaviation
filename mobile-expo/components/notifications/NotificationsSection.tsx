import { Linking, Switch, View, StyleSheet } from 'react-native'
import type { MobileNotificationPreferences } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { SectionHeader } from '../SectionHeader'
import { useNotificationsContext } from '../../contexts/NotificationsContext'

interface PreferenceRowProps {
  label: string
  value: boolean
  saving: boolean
  onToggle: (value: boolean) => void
}

function PreferenceRow({ label, value, saving, onToggle }: PreferenceRowProps) {
  return (
    <View style={styles.preferenceRow}>
      <AppText variant="body" style={styles.preferenceLabel}>
        {label}
      </AppText>
      <Switch value={value} onValueChange={onToggle} disabled={saving} trackColor={{ false: colors.navyBorder, true: colors.navy }} thumbColor={colors.white} />
    </View>
  )
}

const PREFERENCE_FIELDS: { key: keyof Omit<MobileNotificationPreferences, 'daily_drill_time'>; label: string }[] = [
  { key: 'daily_drill_enabled', label: 'Daily Drill Reminder' },
  { key: 'checkride_countdown_enabled', label: 'Checkride Countdown' },
  { key: 'weak_area_enabled', label: 'Weak Area Nudges' },
  { key: 'streak_enabled', label: 'Streak Reminders' },
]

// Sprint 1C Phase 6: notification permission is NEVER requested on cold
// launch -- this section is the one intentional, explicit place a
// learner opts in. Behavior on grant/deny both come straight from
// usePushRegistration's contract (see that hook's own comments); this
// component only renders whatever state it reports, it makes no
// permission/registration decisions of its own.
export function NotificationsSection() {
  const { permission, registered, enabling, enableError, enable, disabling, disable, preferences, preferencesLoading, preferencesError, savingFields, updatePreference } =
    useNotificationsContext()

  return (
    <Card>
      <SectionHeader title="Notifications" />

      {permission === 'granted' && registered ? (
        <View style={styles.section}>
          <AppText variant="caption" color={colors.success}>
            Notifications are enabled on this device.
          </AppText>

          {preferencesLoading ? (
            <AppText variant="caption" color={colors.mutedText}>
              Loading preferences…
            </AppText>
          ) : preferences ? (
            <View style={styles.preferenceList}>
              {PREFERENCE_FIELDS.map(({ key, label }) => (
                <PreferenceRow
                  key={key}
                  label={label}
                  value={preferences[key]}
                  saving={savingFields.has(key)}
                  onToggle={(value) => updatePreference({ [key]: value })}
                />
              ))}
            </View>
          ) : null}

          {preferencesError ? (
            <AppText variant="caption" color={colors.danger}>
              {preferencesError}
            </AppText>
          ) : null}

          <Button label="Disable Notifications" variant="ghost" onPress={disable} loading={disabling} />
        </View>
      ) : permission === 'denied' ? (
        <View style={styles.section}>
          <AppText variant="body" color={colors.mutedText}>
            Notifications are turned off for Apex Advantage in system settings. Enable them there to get Daily Drill reminders, checkride countdown alerts, and weak-area nudges.
          </AppText>
          <Button label="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
        </View>
      ) : (
        <View style={styles.section}>
          <AppText variant="body" color={colors.mutedText}>
            Turn on notifications to get Daily Drill reminders, checkride countdown alerts, and weak-area nudges.
          </AppText>
          <Button label="Enable Notifications" onPress={enable} loading={enabling} />
          {enableError ? (
            <AppText variant="caption" color={colors.danger}>
              {enableError}
            </AppText>
          ) : null}
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  preferenceList: { gap: spacing.xs },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  preferenceLabel: { flex: 1 },
})
