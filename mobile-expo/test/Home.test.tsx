// Sprint 1A Rev2 section 7: real component-render tests for Home,
// against production-shaped MobileBootstrapDTO fixtures (built from the
// shared DTO's own shape), not a source-scan. useBootstrapContext and
// useHomeDrill are mocked here so these tests exercise Home's own
// rendering logic in isolation -- the underlying hooks already have
// their own dedicated unit tests (useBootstrap is exercised indirectly
// via the context; useHomeDrill's entitlement-gating behavior is covered
// separately in test/entitlementGating.test.tsx, which does NOT mock
// these hooks).
import { render, screen } from '@testing-library/react-native'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import HomeScreen from '../app/(app)/index'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../hooks/useCheckridePrepPurchase', () => ({
  useCheckridePrepPurchase: () => ({
    state: 'idle',
    product: null,
    errorMessage: null,
    purchase: jest.fn(),
    restore: jest.fn(),
  }),
}))

jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseHomeDrill = jest.fn()
jest.mock('../hooks/useHomeDrill', () => ({
  useHomeDrill: (...args: unknown[]) => mockUseHomeDrill(...args),
}))

function bootstrapFixture(overrides: Partial<MobileBootstrapDTO> = {}): MobileBootstrapDTO {
  return {
    user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
    training: { certificate_type: 'private_pilot', aircraft_class: 'ASEL', acs_version: '2024', checkride_date: null },
    access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
    progress: {
      xp: 1240,
      current_rank: 'Solo Pilot',
      current_streak: 5,
      longest_streak: 9,
      readiness_summary: {
        overall_score: 68,
        evidence_level: 'moderate',
        algorithm_version: 'v3',
        reason_codes: [],
        computed_at: '2026-01-01T00:00:00Z',
      },
    },
    home: { todays_drill: null, weak_areas: [] },
    ...overrides,
  }
}

function bootstrapContextFixture(overrides: Partial<ReturnType<typeof defaultBootstrapContext>> = {}) {
  return { ...defaultBootstrapContext(), ...overrides }
}

function defaultBootstrapContext() {
  return {
    data: bootstrapFixture(),
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    ready: true,
    entitled: true,
  }
}

function homeDrillFixture(overrides: Partial<ReturnType<typeof defaultHomeDrill>> = {}) {
  return { ...defaultHomeDrill(), ...overrides }
}

function defaultHomeDrill() {
  return {
    drill: null as MobileBootstrapDTO['home']['todays_drill'],
    loading: false,
    error: null,
    retry: jest.fn(),
  }
}

describe('HomeScreen', () => {
  beforeEach(() => {
    mockUseBootstrapContext.mockReset()
    mockUseHomeDrill.mockReset()
  })

  // H: bootstrap success renders learner state.
  it('renders the learner name and training context from bootstrap', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('Jordan Pilot')).toBeTruthy()
    expect(screen.getByText(/Private Pilot/)).toBeTruthy()
  })

  // I: XP/rank/streak reflect server values.
  it('reflects XP, rank, and streak exactly as bootstrap reported them', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          progress: { xp: 4321, current_rank: 'Checkride Ready', current_streak: 12, longest_streak: 20, readiness_summary: null },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('4321')).toBeTruthy()
    expect(screen.getByText('Checkride Ready')).toBeTruthy()
    expect(screen.getByText('12d')).toBeTruthy()
    expect(screen.getByText('Best: 20d')).toBeTruthy()
  })

  // ACS task names request: Weak Areas used to show only the bare code
  // (e.g. "I.C"), with no indication of what that task actually is --
  // mobile-bootstrap now enriches each weak area with its real name.
  it('shows each weak area’s real name next to its code, when the server provides one', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          home: {
            todays_drill: null,
            weak_areas: [
              { acs_task_id: 't1', area_code: 'I', task_code: 'C', area_title: 'Preflight Preparation', task_title: 'Weather Information', evidence_score: 0.4 },
            ],
          },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('I.C Weather Information')).toBeTruthy()
  })

  it('falls back to the bare code alone for a weak area with no title (older/un-enriched data)', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          home: { todays_drill: null, weak_areas: [{ acs_task_id: 't1', area_code: 'I', task_code: 'C', evidence_score: 0.4 }] },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('I.C')).toBeTruthy()
  })

  // Physical-device fix: a raw snake_case server rank value ("student_
  // pilot") was rendering with the literal underscore and wrapping
  // mid-word ("stud/ent_/pilot") in the giant numeric display font.
  // Presentation-only formatting must turn it into "Student Pilot" with
  // no underscore, and it must not render at the same "display" variant
  // XP uses.
  it('formats a long snake_case rank for display, with no underscore, and not at the giant numeric display size', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          progress: { xp: 100, current_rank: 'student_pilot', current_streak: 1, longest_streak: 1, readiness_summary: null },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('Student Pilot')).toBeTruthy()
    expect(screen.queryByText(/student_pilot/i)).toBeNull()
    expect(screen.queryByText('stud')).toBeNull()
  })

  // J: readiness includes evidence level alongside the score.
  it('renders readiness with its evidence level', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          progress: {
            xp: 100,
            current_rank: null,
            current_streak: 0,
            longest_streak: 0,
            readiness_summary: { overall_score: 81, evidence_level: 'high', algorithm_version: 'v3', reason_codes: [], computed_at: '2026-01-01T00:00:00Z' },
          },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('81')).toBeTruthy()
    expect(screen.getByText('STRONG EVIDENCE')).toBeTruthy()
  })

  // K: missing readiness snapshot gets the intentional empty state.
  it('renders the readiness empty state when no snapshot exists yet', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          progress: { xp: 0, current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(screen.getByText('Complete a practice session to see your first readiness indicator.')).toBeTruthy()
  })

  // L: insufficient_content_coverage is surfaced, and never alongside
  // pass-probability language.
  it('surfaces insufficient_content_coverage without any pass-probability copy', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContextFixture({
        data: bootstrapFixture({
          progress: {
            xp: 0,
            current_rank: null,
            current_streak: 0,
            longest_streak: 0,
            readiness_summary: {
              overall_score: 50,
              evidence_level: 'low',
              algorithm_version: 'v3',
              reason_codes: ['insufficient_content_coverage'],
              computed_at: '2026-01-01T00:00:00Z',
            },
          },
        }),
      })
    )
    mockUseHomeDrill.mockReturnValue(homeDrillFixture())

    await render(<HomeScreen />)

    expect(
      screen.getByText('Some ACS areas don’t have Apex content mapped yet, so coverage is measured honestly against the full standard.')
    ).toBeTruthy()
    const banned = /chance of passing|probability of passing|likelihood of passing|you will pass|you'll pass/i
    expect(screen.queryByText(banned)).toBeNull()
  })

  // M: Today's Drill CTA reflects pending/in_progress/completed correctly.
  describe('Today’s Drill CTA', () => {
    it('shows "Start Drill" for a pending drill', async () => {
      mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
      mockUseHomeDrill.mockReturnValue(
        homeDrillFixture({ drill: { id: 'd1', status: 'pending', estimated_minutes: 10, target_acs_tasks: [] } })
      )

      await render(<HomeScreen />)
      expect(screen.getByText('Start Drill')).toBeTruthy()
    })

    it('shows "Continue Drill" for an in_progress drill', async () => {
      mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
      mockUseHomeDrill.mockReturnValue(
        homeDrillFixture({ drill: { id: 'd1', status: 'in_progress', estimated_minutes: 10, target_acs_tasks: [] } })
      )

      await render(<HomeScreen />)
      expect(screen.getByText('Continue Drill')).toBeTruthy()
    })

    // Physical-device fix: "View Summary" promised a completion summary
    // the current contract can't actually show -- replaced with an
    // honest, non-interactive "Completed" state.
    it('shows an honest, non-interactive "Completed" state for a completed drill, never a promised summary', async () => {
      mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
      mockUseHomeDrill.mockReturnValue(
        homeDrillFixture({ drill: { id: 'd1', status: 'completed', estimated_minutes: 10, target_acs_tasks: [] } })
      )

      await render(<HomeScreen />)
      expect(screen.getByText("Today's Drill — Done")).toBeTruthy()
      expect(screen.queryByText('View Summary')).toBeNull()
      const completedButton = screen.getByRole('button', { name: 'Completed' })
      expect(completedButton).toBeTruthy()
      expect(completedButton.props.accessibilityState?.disabled).toBe(true)
    })

    // ACS task names request: a focus-area chip used to show only the
    // bare code (e.g. "I.C"), with no indication of what that task
    // actually is -- now appends the real title when mobile-bootstrap
    // provides one.
    it('shows the task’s real name next to its code in a focus-area chip, when the server provides one', async () => {
      mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
      mockUseHomeDrill.mockReturnValue(
        homeDrillFixture({
          drill: {
            id: 'd1',
            status: 'pending',
            estimated_minutes: 10,
            target_acs_tasks: [{ acs_task_id: 't1', area_code: 'I', task_code: 'C', area_title: 'Preflight Preparation', task_title: 'Weather Information' }],
          },
        })
      )

      await render(<HomeScreen />)
      expect(screen.getByText('I.C Weather Information')).toBeTruthy()
    })

    it('falls back to the bare code alone when no title is provided (older/un-enriched data)', async () => {
      mockUseBootstrapContext.mockReturnValue(bootstrapContextFixture())
      mockUseHomeDrill.mockReturnValue(
        homeDrillFixture({
          drill: { id: 'd1', status: 'pending', estimated_minutes: 10, target_acs_tasks: [{ acs_task_id: 't1', area_code: 'I', task_code: 'C' }] },
        })
      )

      await render(<HomeScreen />)
      expect(screen.getByText('I.C')).toBeTruthy()
    })
  })

  // Priority 3 (free student experience): a free account's Home used to
  // be a single-message dead end (LockedState) -- it now shows a real,
  // useful dashboard instead. The Checkride Prep teaser specifically
  // must still carry zero purchase/checkout/price/URL language (Rev2
  // section 3's original compliance bar for this exact wall, preserved
  // even though it's no longer the WHOLE screen) -- Apple's anti-
  // steering rules are about directing someone to pay outside IAP for
  // content that should be sold through it, which is a different thing
  // from the free Readiness Assessment link this screen does show.
  describe('free account (checkride_prep not unlocked)', () => {
    function freeContext(overrides: Partial<ReturnType<typeof defaultBootstrapContext>> = {}) {
      return bootstrapContextFixture({
        data: bootstrapFixture({ access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } }),
        entitled: false,
        ...overrides,
      })
    }

    it('welcomes the learner by name instead of showing a dead-end message', async () => {
      mockUseBootstrapContext.mockReturnValue(freeContext())
      mockUseHomeDrill.mockReturnValue(homeDrillFixture())

      await render(<HomeScreen />)

      expect(screen.getByText('Jordan Pilot')).toBeTruthy()
      expect(screen.queryByText('Checkride Prep isn’t included on this account')).toBeNull()
    })

    it('shows a working link to the free Readiness Assessment', async () => {
      mockUseBootstrapContext.mockReturnValue(freeContext())
      mockUseHomeDrill.mockReturnValue(homeDrillFixture())

      await render(<HomeScreen />)

      expect(screen.getByText('Take the Free Assessment')).toBeTruthy()
      expect(screen.getByText(/zero cost/i)).toBeTruthy()
    })

    it('accurately distinguishes free from paid features, without touting locked Ground School/Library content as "free"', async () => {
      mockUseBootstrapContext.mockReturnValue(freeContext())
      mockUseHomeDrill.mockReturnValue(homeDrillFixture())

      await render(<HomeScreen />)

      expect(screen.getByText('FREE')).toBeTruthy()
      expect(screen.getByText('CHECKRIDE PREP')).toBeTruthy()
      expect(screen.queryByText(/ground school/i)).toBeNull()
      expect(screen.queryByText(/study pack/i)).toBeNull()
    })

    // Apple IAP implementation: the teaser now leads with the real
    // purchase flow (CheckridePrepPaywall) instead of a text-only
    // disclaimer -- "Purchase"/"Restore Purchases" controls are now the
    // intended, required content here, not forbidden steering. What's
    // still genuinely forbidden is WEB/Stripe steering: this app's own
    // domain, a bare URL, or sending someone to a browser to pay
    // outside IAP for content that must be sold through it.
    it('the Checkride Prep teaser shows the real purchase controls, with zero web/browser-checkout steering', async () => {
      mockUseBootstrapContext.mockReturnValue(freeContext())
      mockUseHomeDrill.mockReturnValue(homeDrillFixture())

      await render(<HomeScreen />)

      expect(screen.getByText('Ready for the full Checkride Prep System?')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Unlock Checkride Prep' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Restore Purchases' })).toBeTruthy()
      expect(screen.queryByText(/https?:\/\/|apexaviationtx|browser/i)).toBeNull()
    })

    it('never shows a bare purchase/checkout URL anywhere on the free dashboard -- the only link is the free Readiness Assessment', async () => {
      mockUseBootstrapContext.mockReturnValue(freeContext())
      mockUseHomeDrill.mockReturnValue(homeDrillFixture())

      await render(<HomeScreen />)

      const urlPattern = /https?:\/\/\S+/i
      const matches = screen.queryAllByText(urlPattern)
      expect(matches.length).toBe(0) // the assessment URL itself is only ever passed to Linking.openURL, never rendered as visible text
    })
  })
})
