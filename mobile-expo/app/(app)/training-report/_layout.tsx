import { Stack } from 'expo-router'

// Training Report (Phase 5) is reached from Profile's own entry card, not
// its own bottom tab -- see app/(app)/_layout.tsx's comment. A single
// screen, no sub-navigation, but still gets its own nested Stack
// following the exact same convention as review/_layout.tsx/
// ground-school/_layout.tsx.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function TrainingReportLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  )
}
