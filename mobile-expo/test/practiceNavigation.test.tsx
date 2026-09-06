// Narrow structural check for the Practice tab's nested navigator (Final
// pre-device navigation fix, extended by Sprint 1B.1 for the new ad-hoc
// practice session route): the Practice TAB contains three screens (its
// own root, a pushed Daily Drill session, and a pushed ad-hoc practice
// session), so it needs a Stack navigator of its own per Expo Router's
// documented "Stack inside a Tab" pattern -- the parent Tabs layout's
// single `<Tabs.Screen name="practice" />` resolves to this whole nested
// navigator. This isn't a route-resolution integration test (that needs a
// real Expo Router test harness, out of scope for this narrow fix) -- it
// just proves the layout module itself declares exactly the three
// expected screens, with `index` first.
import { render } from '@testing-library/react-native'
import PracticeLayout, { unstable_settings } from '../app/(app)/practice/_layout'

const mockScreenNames: string[] = []

jest.mock('expo-router', () => {
  const React = require('react')
  function Stack({ children }: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, children)
  }
  Stack.Screen = function StackScreen({ name }: { name: string }) {
    mockScreenNames.push(name)
    return null
  }
  return { Stack }
})

describe('Practice tab nested navigator', () => {
  beforeEach(() => {
    mockScreenNames.length = 0
  })

  it('lands on the tab root by default', () => {
    expect(unstable_settings.initialRouteName).toBe('index')
  })

  it('declares exactly the tab root, the drill session screen, and the ad-hoc practice session screen, root first', async () => {
    await render(<PracticeLayout />)
    expect(mockScreenNames).toEqual(['index', '[drillId]', 'session/[sessionId]'])
  })
})
