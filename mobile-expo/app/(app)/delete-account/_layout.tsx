import { Stack } from 'expo-router'

// Delete Account is reached from Profile's own card, not its own bottom
// tab -- same href: null pattern as training-report/review/ground-school
// (see app/(app)/_layout.tsx's comment). A single screen, no
// sub-navigation.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function DeleteAccountLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  )
}
