import { Stack } from 'expo-router'

// The Oral TAB contains two screens (the tab root hub, and a pushed
// oral-practice session screen), so it needs its own nested Stack
// navigator per Expo Router's documented "Stack inside a Tab" pattern --
// mirrors app/(app)/practice/_layout.tsx exactly, see that file's own
// comment for the full rationale.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function OralLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="session/[sessionId]" />
    </Stack>
  )
}
