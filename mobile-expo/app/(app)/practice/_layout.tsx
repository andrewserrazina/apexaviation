import { Stack } from 'expo-router'

// The Practice TAB contains three screens (the tab root, a pushed Daily
// Drill session screen, and -- Sprint 1B.1 -- a pushed ad-hoc practice
// session screen), so it needs its own nested Stack navigator per Expo
// Router's documented "Stack inside a Tab" pattern -- the parent Tabs
// layout's single `<Tabs.Screen name="practice" />` resolves to this
// whole nested navigator, not to practice/index.tsx directly. Without
// this file, neither pushed screen would have a navigator of its own to
// mount inside.
//
// `initialRouteName: 'index'` (via unstable_settings, the documented way
// to set it for a directory-based layout) makes the Practice tab always
// land on its hub screen first, with [drillId] and session/[sessionId]
// only ever reached by an explicit push from the hub (or, for
// session/[sessionId], a direct deep link/relaunch, which the screen
// itself gates on bootstrap -- see that screen's own comment) -- never a
// second visible tab, and the tab bar stays on "Practice" for all three
// screens since they share this one navigator.
export const unstable_settings = {
  initialRouteName: 'index',
}

export default function PracticeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[drillId]" />
      <Stack.Screen name="session/[sessionId]" />
    </Stack>
  )
}
