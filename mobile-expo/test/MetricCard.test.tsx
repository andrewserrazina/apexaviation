// Physical-device fix: MetricCard always rendered its value at the
// giant numeric "display" text variant, which is appropriate for XP but
// wraps a longer textual value (a Rank, e.g. "Student Pilot") awkwardly
// in a narrow flex:1 column. `valueVariant` lets a caller opt a textual
// metric into a smaller size instead.
import { render, screen } from '@testing-library/react-native'
import { MetricCard } from '../components/MetricCard'
import { type as typeScale } from '../constants/theme'

describe('MetricCard', () => {
  it('defaults the value to the display variant (correct for a numeric metric like XP)', async () => {
    await render(<MetricCard label="XP" value="4321" />)
    const value = screen.getByText('4321')
    const flattened = [value.props.style].flat(Infinity).filter(Boolean) as Array<{ fontSize?: number }>
    expect(flattened.some((s) => s.fontSize === typeScale.display.fontSize)).toBe(true)
  })

  it('renders the value at a smaller variant when valueVariant is overridden, for a long textual rank', async () => {
    await render(<MetricCard label="Rank" value="Student Pilot" valueVariant="title" />)
    const value = screen.getByText('Student Pilot')
    const flattened = [value.props.style].flat(Infinity).filter(Boolean) as Array<{ fontSize?: number }>
    expect(flattened.some((s) => s.fontSize === typeScale.title.fontSize)).toBe(true)
    expect(flattened.some((s) => s.fontSize === typeScale.display.fontSize)).toBe(false)
  })
})
