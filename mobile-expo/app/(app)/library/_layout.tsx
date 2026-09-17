import { Stack } from 'expo-router'

// Sprint 1C Phase 2/3: the Library tab now contains two screens (the
// catalog hub and a pushed pack detail screen), so it needs its own
// nested Stack navigator -- the exact same "Stack inside a Tab" shape
// Sprint 1B.1 already established for the Practice tab (see
// practice/_layout.tsx's comment). The parent Tabs layout's single
// `<Tabs.Screen name="library" />` resolves to this whole nested
// navigator, not to library/index.tsx directly.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function LibraryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[packId]" />
    </Stack>
  )
}
