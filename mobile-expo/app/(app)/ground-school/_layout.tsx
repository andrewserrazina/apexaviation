import { Stack } from 'expo-router'

// Ground School (Phase 3) is reached from the Library tab's own card
// (see app/(app)/library/index.tsx), not a dedicated bottom tab -- same
// hidden-tab pattern Review Queue uses. Still needs its own nested Stack
// for the catalog -> module-detail push, mirroring library/_layout.tsx.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function GroundSchoolLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[moduleId]" />
    </Stack>
  )
}
