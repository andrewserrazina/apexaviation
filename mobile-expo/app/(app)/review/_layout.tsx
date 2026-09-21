import { Stack } from 'expo-router'

// Review Queue is reached from the Practice tab's "Review Queue" card,
// not its own bottom tab (see review/index.tsx's own comment) -- but it
// still needs its own nested Stack for the hub -> session push, mirroring
// oral/_layout.tsx's/practice/_layout.tsx's identical pattern.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function ReviewLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="session" />
    </Stack>
  )
}
