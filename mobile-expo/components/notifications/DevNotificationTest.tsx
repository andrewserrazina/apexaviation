import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import * as Notifications from 'expo-notifications'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { colors, spacing } from '../../constants/theme'

// Sprint 1C Phase 12: a development-only way to prove notification tap
// routing end-to-end (notification -> tap -> the SAME validated resolver
// in lib/notifications/notificationRouting.ts real push notifications
// will use -> the correct native screen) using a LOCAL scheduled
// notification. This never touches Expo's push service and is NOT a
// substitute for verifying actual remote push delivery, which requires a
// development/native build on a physical device (Expo Go does not
// support remote push on this SDK) -- see the Sprint report for that
// separate verification step. __DEV__-gated so this can never appear in
// a production build.
export function DevNotificationTest() {
  const [scheduled, setScheduled] = useState(false)

  if (!__DEV__) return null

  async function schedule() {
    setScheduled(false)
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Apex Advantage (dev routing test)',
        body: 'Tap this to verify it opens Practice.',
        data: { type: 'practice' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, repeats: false },
    })
    setScheduled(true)
  }

  return (
    <View style={styles.wrap}>
      <AppText variant="label" weight="semibold" color={colors.mutedText}>
        DEV ONLY -- NOTIFICATION ROUTING TEST
      </AppText>
      <AppText variant="caption" color={colors.mutedText}>
        Schedules a local notification in 5 seconds targeting Practice. Background the app (or lock the device), then tap the notification when it arrives to verify it opens the correct screen.
      </AppText>
      <Button label={scheduled ? 'Scheduled — background the app now' : 'Schedule Test Notification'} variant="ghost" onPress={schedule} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
})
