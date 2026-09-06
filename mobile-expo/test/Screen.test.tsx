// Physical-device layout regression (Sprint 1A physical-device pass,
// item 1): Screen's non-scrolling branch used to wrap children in an
// outer `flex: 1` View, then an INNER padded View with no flex of its
// own -- so a screen relying on `flex: 1` + `justifyContent: 'center'`
// to vertically center itself (the drill completion screen) had no
// bounded-height parent to actually center within. On a physical iPhone
// this collapsed/clipped the content instead of merely leaving it
// top-aligned. This is a style-level regression test rather than a real
// layout-engine test, since this project's test renderer doesn't measure
// pixels -- it directly proves the inner content View now also stretches
// to fill height whenever `scroll` is false, which is the actual fix.
import { render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { Screen } from '../components/Screen'

describe('Screen', () => {
  it('gives the inner content View flex: 1 when scroll is false, so a flex child can fill the viewport', async () => {
    await render(
      <Screen scroll={false}>
        <Text testID="content">hello</Text>
      </Screen>
    )
    const content = screen.getByTestId('content')
    // Walk up to the inner content View (content's direct parent) and
    // confirm it carries flex: 1 in its resolved style.
    const innerView = content.parent
    const flattened = [innerView?.props.style].flat(Infinity).filter(Boolean)
    expect(flattened.some((s) => s && typeof s === 'object' && (s as { flex?: number }).flex === 1)).toBe(true)
  })

  it('does not force flex: 1 onto the inner content View when scrolling (default) -- must not change existing ScrollView behavior', async () => {
    await render(
      <Screen>
        <Text testID="content">hello</Text>
      </Screen>
    )
    const content = screen.getByTestId('content')
    const innerView = content.parent
    const flattened = [innerView?.props.style].flat(Infinity).filter(Boolean)
    expect(flattened.some((s) => s && typeof s === 'object' && (s as { flex?: number }).flex === 1)).toBe(false)
  })
})
