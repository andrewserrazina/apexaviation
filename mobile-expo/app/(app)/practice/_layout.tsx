import { Stack } from 'expo-router'

// The Practice TAB contains two screens (the tab root and a pushed drill
// session screen), so it needs its own nested Stack navigator per Expo
// Router's documented "Stack inside a Tab" pattern -- the parent Tabs
// layout's single `<Tabs.Screen name="practice" />` resolves to this
// whole nested navigator, not to practice/index.tsx directly. Without
// this file, [drillId] had no navigator of its own to mount inside.
//
// `initialRouteName: 'index'` (via unstable_settings, the documented way
// to set it for a directory-based layout) makes the Practice tab always
// land on its list/root screen first, with [drillId] only ever reached
// by an explicit push from Home or from this tab's own Today's Drill
// card -- never a second visible tab, and the tab bar stays on
// "Practice" for both screens since they share this one navigator.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function PracticeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[drillId]" />
    </Stack>
  )
}
