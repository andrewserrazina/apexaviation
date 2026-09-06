import { render, screen } from '@testing-library/react-native'
import { ReadinessCard } from '../components/ReadinessCard'

describe('ReadinessCard', () => {
  it('shows an empty state when there is no readiness snapshot yet', async () => {
    await render(<ReadinessCard overallScore={null} evidenceLevel={null} reasonCodes={[]} />)
    expect(screen.getByText('Complete a practice session to see your first readiness indicator.')).toBeTruthy()
  })

  it('renders the score and evidence level when a snapshot exists', async () => {
    await render(<ReadinessCard overallScore={72.4} evidenceLevel="moderate" reasonCodes={[]} />)
    expect(screen.getByText('72')).toBeTruthy()
    expect(screen.getByText('BUILDING EVIDENCE')).toBeTruthy()
  })

  // Rev2 section 4 regression: a single `.find(Boolean)` could silently
  // hide insufficient_content_coverage whenever another known code
  // appeared earlier in the reason_codes array. Both limitations here
  // must render, not just the first.
  it('surfaces every recognized reason code, including insufficient_content_coverage when it appears after another code', async () => {
    await render(
      <ReadinessCard
        overallScore={55}
        evidenceLevel="low"
        reasonCodes={['low_sample_size', 'insufficient_content_coverage']}
      />
    )
    expect(screen.getByText('Complete more practice to sharpen this indicator.')).toBeTruthy()
    expect(
      screen.getByText('Some ACS areas don’t have Apex content mapped yet, so coverage is measured honestly against the full standard.')
    ).toBeTruthy()
  })

  it('surfaces insufficient_content_coverage even when it is the ONLY recognized code', async () => {
    await render(<ReadinessCard overallScore={55} evidenceLevel="low" reasonCodes={['insufficient_content_coverage']} />)
    expect(
      screen.getByText('Some ACS areas don’t have Apex content mapped yet, so coverage is measured honestly against the full standard.')
    ).toBeTruthy()
  })

  it('never renders pass-probability language', async () => {
    await render(
      <ReadinessCard
        overallScore={40}
        evidenceLevel="low"
        reasonCodes={['low_sample_size', 'insufficient_content_coverage', 'score_change_dampened']}
      />
    )
    const banned = /chance of passing|probability of passing|likelihood of passing|you will pass|you'll pass/i
    expect(screen.queryByText(banned)).toBeNull()
  })
})
