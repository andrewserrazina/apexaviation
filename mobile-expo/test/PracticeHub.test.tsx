// Sprint 1B.1: the Practice hub replaces the old "more practice modes are
// coming" placeholder with real Quick/Standard/Weak-Area ad-hoc practice
// entry points plus a Continue Practice card. These tests exercise the
// hub's own gating, its Start-request shapes, its local active-session
// bookkeeping, and its honest empty/error states -- not the ad-hoc
// session screen itself (see useAdHocPracticeSession.test.tsx for that).
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native'
import PracticeTabScreen from '../app/(app)/practice/index'
import { ApiError } from '../lib/api/errors'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'

const mockPush = jest.fn()
// Rev3 focus-race fix: unlike the earlier bare `jest.fn()` (which never
// actually invoked its argument, so the focus-return path was never
// exercised), this mock captures the registered callback so tests can
// invoke it directly to simulate real focus events. The hub's own
// `hasFocusedOnce` guard means the FIRST invocation is always the
// (skipped) initial-mount focus, matching real navigation -- a SECOND
// invocation is what simulates actually returning to this screen.
let mockFocusCallback: (() => void) | null = null
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    mockFocusCallback = cb
  },
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseDailyDrill = jest.fn()
jest.mock('../hooks/useDailyDrill', () => ({
  useDailyDrill: (...args: unknown[]) => mockUseDailyDrill(...args),
}))

const mockStartAdHocPractice = jest.fn()
jest.mock('../lib/api/practice', () => ({
  startAdHocPractice: (...args: unknown[]) => mockStartAdHocPractice(...args),
}))

const mockLoadActivePracticeSession = jest.fn()
const mockSaveActivePracticeSession = jest.fn()
jest.mock('../lib/activePracticeStorage', () => ({
  loadActivePracticeSession: (...args: unknown[]) => mockLoadActivePracticeSession(...args),
  saveActivePracticeSession: (...args: unknown[]) => mockSaveActivePracticeSession(...args),
  clearActivePracticeSession: jest.fn(),
  clearActivePracticeSessionIfMatches: jest.fn(),
}))

const mockLoadDrillProgress = jest.fn()
jest.mock('../lib/drillProgressStorage', () => ({
  loadDrillProgress: (...args: unknown[]) => mockLoadDrillProgress(...args),
}))

function bootstrapFixture(overrides: Partial<MobileBootstrapDTO> = {}): MobileBootstrapDTO {
  return {
    user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
    training: { certificate_type: 'private_pilot', aircraft_class: 'ASEL', acs_version: '2024', checkride_date: null },
    access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] },
    progress: { xp: 100, current_rank: null, current_streak: 1, longest_streak: 1, readiness_summary: null },
    home: { todays_drill: null, weak_areas: [] },
    ...overrides,
  }
}

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return {
    data: bootstrapFixture(),
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    ready: true,
    entitled: true,
    ...overrides,
  }
}

const NO_DRILL = { data: null, loading: false, error: null, refetch: jest.fn() }

beforeEach(() => {
  mockFocusCallback = null
  mockPush.mockReset()
  mockUseBootstrapContext.mockReset()
  mockUseDailyDrill.mockReset()
  mockUseDailyDrill.mockReturnValue(NO_DRILL)
  mockStartAdHocPractice.mockReset()
  mockLoadActivePracticeSession.mockReset()
  mockLoadActivePracticeSession.mockResolvedValue(null)
  mockSaveActivePracticeSession.mockReset()
  mockSaveActivePracticeSession.mockResolvedValue(undefined)
  mockLoadDrillProgress.mockReset()
  mockLoadDrillProgress.mockResolvedValue(null)
})

// 7. bootstrap unresolved -> no premium call
it('never starts ad-hoc practice or calls useDailyDrill with enabled=true while bootstrap has not resolved', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ loading: true, ready: false }))

  await render(<PracticeTabScreen />)

  expect(mockUseDailyDrill).toHaveBeenCalledWith({ enabled: false })
  expect(mockStartAdHocPractice).not.toHaveBeenCalled()
  expect(mockLoadActivePracticeSession).not.toHaveBeenCalled()
})

// 8. bootstrap error -> retryable error, not LockedState
it('shows a retryable error, not LockedState, when bootstrap fails', async () => {
  const refresh = jest.fn()
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({ data: null, error: { userMessage: 'Check your connection and try again.' }, entitled: false, refresh })
  )

  await render(<PracticeTabScreen />)

  expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
  expect(screen.queryByText('Checkride Prep isn’t included on this account')).toBeNull()
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

// 9. unentitled -> LockedState and no Start/Resume call
it('shows LockedState and never calls startAdHocPractice when the learner is not entitled', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ entitled: false, data: bootstrapFixture({ access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } }) }))

  await render(<PracticeTabScreen />)

  expect(screen.getByText('Checkride Prep isn’t included on this account')).toBeTruthy()
  expect(mockStartAdHocPractice).not.toHaveBeenCalled()
  expect(mockUseDailyDrill).toHaveBeenCalledWith({ enabled: false })
})

// 10. Quick sends session_size=5
it('Quick Practice calls startAdHocPractice with session_size 5 and no acs_task_id', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockStartAdHocPractice.mockResolvedValue({
    session_id: 's1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    target_acs_tasks: [],
    questions: [{ id: 'q1', question: 'Q?', category: null }],
  })

  await render(<PracticeTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))

  await waitFor(() => expect(mockStartAdHocPractice).toHaveBeenCalledWith({ session_size: 5 }))
  // Settle the rest of handleStart's async chain (navigation, then its
  // `finally` clearing the loading state) inside this test's own act()
  // boundary -- otherwise that trailing setState can land during a LATER
  // test, outside any act() scope, and corrupt that test's own timing.
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
})

// 11. Standard sends session_size=10
it('Standard Practice calls startAdHocPractice with session_size 10 and no acs_task_id', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockStartAdHocPractice.mockResolvedValue({
    session_id: 's1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    target_acs_tasks: [],
    questions: [{ id: 'q1', question: 'Q?', category: null }],
  })

  await render(<PracticeTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Start Standard Practice' }))

  await waitFor(() => expect(mockStartAdHocPractice).toHaveBeenCalledWith({ session_size: 10 }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
})

// 12. Weak Area sends exact bootstrap acs_task_id and session_size=5
it('Practice I.A calls startAdHocPractice with the exact bootstrap-provided acs_task_id and session_size 5', async () => {
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({
      data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [{ acs_task_id: 'task-uuid-123', area_code: 'I', task_code: 'A', evidence_score: 0.38 }] } }),
    })
  )
  mockStartAdHocPractice.mockResolvedValue({
    session_id: 's1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    target_acs_tasks: [],
    questions: [{ id: 'q1', question: 'Q?', category: null }],
  })

  await render(<PracticeTabScreen />)
  expect(screen.getByText('Evidence: 38%')).toBeTruthy()
  fireEvent.press(screen.getByRole('button', { name: 'Practice I.A' }))

  await waitFor(() => expect(mockStartAdHocPractice).toHaveBeenCalledWith({ acs_task_id: 'task-uuid-123', session_size: 5 }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
})

// 13. targeted no-content error does not navigate or persist active session
it('a targeted Start 404 shows an inline message and never navigates or saves an active session', async () => {
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({
      data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [{ acs_task_id: 'task-uuid-123', area_code: 'I', task_code: 'H', evidence_score: 0 }] } }),
    })
  )
  mockStartAdHocPractice.mockRejectedValue(
    new ApiError({ kind: 'not_found', userMessage: 'No practice questions are available for this ACS task yet.' })
  )

  await render(<PracticeTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Practice I.H' }))

  await waitFor(() => expect(screen.getByText('No practice questions are available for this ACS task yet.')).toBeTruthy())
  // Settle handleStart's trailing `finally` (which clears the in-flight/
  // loading flag) within this test's own act() boundary, same reasoning as
  // the settle-waits above -- here the error text appearing IS the last
  // state update handleStart's catch block makes, so waiting for the
  // button to return to non-busy proves the whole chain, including
  // `finally`, already ran before this test function returns.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Practice I.H' }).props.accessibilityState.busy).toBeFalsy())
  expect(mockPush).not.toHaveBeenCalled()
  expect(mockSaveActivePracticeSession).not.toHaveBeenCalled()
})

// 14. successful Start persists active session then navigates
it('a successful Start saves the active session pointer, then navigates to the session route', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockStartAdHocPractice.mockResolvedValue({
    session_id: 'new-session-1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    target_acs_tasks: [],
    questions: [{ id: 'q1', question: 'Q?', category: null }],
  })

  await render(<PracticeTabScreen />)
  fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))

  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
  expect(mockSaveActivePracticeSession).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'new-session-1', userId: 'u1', kind: 'quick', title: 'Quick Practice' })
  )
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(app)/practice/session/[sessionId]',
    params: { sessionId: 'new-session-1', title: 'Quick Practice' },
  })
})

// Rev3 fix B: the hub stays MOUNTED underneath the nested Stack while the
// learner is on the ad-hoc session route -- it is never remounted on
// Back, so its own in-memory state (not just the persisted pointer) must
// already reflect the new session the instant Start succeeds, before any
// navigation or focus-triggered reload. Proven here by asserting Continue
// Practice/the disabled state appear from a SINGLE loadActivePracticeSession
// call (the initial mount's), with no second lookup call required, and
// that an immediate re-press cannot fire a second Start.
it('a successful Start publishes the active session into the hub’s own memory immediately, with no second lookup required', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockStartAdHocPractice.mockResolvedValue({
    session_id: 'new-session-1',
    mode: 'dpe_questions',
    started_at: '2026-01-01T00:00:00Z',
    target_acs_tasks: [],
    questions: [{ id: 'q1', question: 'Q?', category: null }],
  })

  await render(<PracticeTabScreen />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(false))

  fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))

  expect(screen.getByText('Continue Practice')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
  // Only the initial mount's lookup ever ran -- Fix B publishes the new
  // session directly, it doesn't trigger (or require) a second
  // AsyncStorage read to know about its own just-created session.
  expect(mockLoadActivePracticeSession).toHaveBeenCalledTimes(1)

  fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
  expect(mockStartAdHocPractice).toHaveBeenCalledTimes(1)
})

// 15. double tap produces one Start
it('pressing Start Quick Practice twice in quick succession only calls startAdHocPractice once', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  let resolveStart: (value: unknown) => void = () => {}
  mockStartAdHocPractice.mockReturnValue(
    new Promise((resolve) => {
      resolveStart = resolve
    })
  )

  await render(<PracticeTabScreen />)
  const button = screen.getByRole('button', { name: 'Start Quick Practice' })
  // Each press's onPress calls the async handleStart without awaiting it,
  // so fireEvent.press's own act() scope closes before that promise
  // settles. Firing three presses back-to-back with no yield between them
  // stacks act() scopes React never gets a chance to close, which is what
  // produces "overlapping act() calls" (harmless to THIS test's own
  // assertions, but it leaves dangling work that corrupts whichever test
  // runs next) -- wrapping each press in its own awaited act() gives React
  // a microtask boundary to close the previous scope first.
  await act(async () => {
    fireEvent.press(button)
  })
  await act(async () => {
    fireEvent.press(button)
  })
  await act(async () => {
    fireEvent.press(button)
  })

  // resolveStart's continuation (saveActivePracticeSession -> router.push
  // -> the finally block's setStarting(false)) triggers React state
  // updates on a promise chain the test doesn't otherwise hold a handle
  // to. Wrapping the resolve in act() with an explicit macrotask yield
  // (setTimeout 0) forces every pending microtask -- this continuation
  // AND the unrelated mount-time loadActive() promise chain -- to fully
  // drain inside one properly-closed act() scope, instead of leaking a
  // dangling "overlapping act() calls" warning into whichever test runs
  // next (Node always empties the microtask queue before a timer fires,
  // so this is a reliable full flush, not a race).
  await act(async () => {
    resolveStart({
      session_id: 's1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      target_acs_tasks: [],
      questions: [{ id: 'q1', question: 'Q?', category: null }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
  expect(mockStartAdHocPractice).toHaveBeenCalledTimes(1)
})

// 16. active ad-hoc session disables new ad-hoc Starts
it('disables Quick/Standard/Weak-Area starts while a valid local active session exists', async () => {
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({
      data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [{ acs_task_id: 'task-uuid-123', area_code: 'I', task_code: 'A', evidence_score: 0.5 }] } }),
    })
  )
  mockLoadActivePracticeSession.mockResolvedValue({
    sessionId: 'existing-session',
    userId: 'u1',
    kind: 'quick',
    title: 'Quick Practice',
    startedAt: '2026-01-01T00:00:00Z',
    sessionSize: 5,
  })

  await render(<PracticeTabScreen />)

  await waitFor(() => expect(screen.getByText('Continue Practice')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Start Standard Practice' }).props.accessibilityState.disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Practice I.A' }).props.accessibilityState.disabled).toBe(true)
  expect(screen.getByText('Finish your current practice session before starting another.')).toBeTruthy()

  fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
  expect(mockStartAdHocPractice).not.toHaveBeenCalled()
})

// Rev2 blocker 1: the per-user active-session pointer lookup is itself
// async -- while it's still pending, the hub must not enable new ad-hoc
// Starts just because `activeSession` happens to still be null (that's
// "unknown yet," not "no active session"). Enabling Start during that
// window let a learner who already has an unfinished session create a
// second, orphaned one before the lookup resolved.
describe('active-session lookup race (Rev2 blocker 1)', () => {
  it('disables Quick/Standard/Weak-Area starts (never calling startAdHocPractice), while leaving Today’s Drill usable, until the active-session lookup resolves', async () => {
    mockUseBootstrapContext.mockReturnValue(
      bootstrapContext({
        data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [{ acs_task_id: 'task-uuid-123', area_code: 'I', task_code: 'A', evidence_score: 0.5 }] } }),
      })
    )
    mockUseDailyDrill.mockReturnValue({
      data: { drill: { id: 'd1', status: 'pending', estimated_minutes: 8, target_acs_tasks: [] }, session_id: null, questions: [] },
      loading: false,
      error: null,
      refetch: jest.fn(),
    })
    // Never resolves within this test -- the lookup is permanently
    // "still pending" from the hub's point of view.
    mockLoadActivePracticeSession.mockReturnValue(new Promise(() => {}))

    await render(<PracticeTabScreen />)

    expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Start Standard Practice' }).props.accessibilityState.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Practice I.A' }).props.accessibilityState.disabled).toBe(true)
    expect(screen.getByText('Checking for an existing practice session…')).toBeTruthy()
    // Not yet resolved either way -- "Continue Practice" (which requires
    // a known, truthy active session) must not appear during the pending
    // window, and neither must the "Finish your current..." copy, which
    // is specific to a CONFIRMED active session, not an unknown state.
    expect(screen.queryByText('Continue Practice')).toBeNull()
    expect(screen.queryByText('Finish your current practice session before starting another.')).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
    expect(mockStartAdHocPractice).not.toHaveBeenCalled()

    const drillButton = screen.getByRole('button', { name: 'Start Drill' })
    expect(drillButton.props.accessibilityState.disabled).toBeFalsy()
  })

  it('enables new ad-hoc Starts once the active-session lookup resolves to null (no unfinished session)', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockLoadActivePracticeSession.mockResolvedValue(null)

    await render(<PracticeTabScreen />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(false))
    expect(screen.getByRole('button', { name: 'Start Standard Practice' }).props.accessibilityState.disabled).toBe(false)
  })

  it('keeps new ad-hoc Starts disabled once the active-session lookup resolves to an existing unfinished session', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockLoadActivePracticeSession.mockResolvedValue({
      sessionId: 'existing-session',
      userId: 'u1',
      kind: 'quick',
      title: 'Quick Practice',
      startedAt: '2026-01-01T00:00:00Z',
      sessionSize: 5,
    })

    await render(<PracticeTabScreen />)

    await waitFor(() => expect(screen.getByText('Continue Practice')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Start Standard Practice' }).props.accessibilityState.disabled).toBe(true)
  })
})

// Rev3: the hub stays MOUNTED underneath the nested Stack while the
// learner is on the ad-hoc session route -- it is never remounted, so a
// fresh AsyncStorage lookup runs on every FOCUS RETURN (useFocusEffect),
// not just on first mount. The same async-lookup race Rev2 fixed for the
// initial load could still occur here if a focus-triggered loadActive()
// didn't ALSO immediately mark itself pending. Uses the captured
// mockFocusCallback (see the module-level useFocusEffect mock above) to
// actually invoke the focus-return code path, which the earlier bare
// `jest.fn()` mock never did.
describe('return-to-practice focus race (Rev3)', () => {
  it('disables new ad-hoc Starts (never firing a second startAdHocPractice) while a focus-triggered lookup is pending, then shows Continue Practice once it resolves', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext())
    mockUseDailyDrill.mockReturnValue({
      data: { drill: { id: 'd1', status: 'pending', estimated_minutes: 8, target_acs_tasks: [] }, session_id: null, questions: [] },
      loading: false,
      error: null,
      refetch: jest.fn(),
    })
    // 1. initial load resolves null.
    mockLoadActivePracticeSession.mockResolvedValueOnce(null)
    mockStartAdHocPractice.mockResolvedValue({
      session_id: 'new-session-1',
      mode: 'dpe_questions',
      started_at: '2026-01-01T00:00:00Z',
      target_acs_tasks: [],
      questions: [{ id: 'q1', question: 'Q?', category: null }],
    })

    const { unmount } = await render(<PracticeTabScreen />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(false))

    // A real macrotask yield (setTimeout 0), not just a microtask
    // (Promise.resolve()) -- Node always drains the FULL microtask queue
    // before a timer fires, regardless of how many chained `await`s a
    // continuation needs, so this reliably settles an entire async chain
    // (including its trailing `finally`) rather than guessing a tick
    // count. Reused at every settle point below for the same reason.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    // 2. Start Quick succeeds -- 3. the active session is saved (and, per
    // Fix B, already published into the hub's own memory).
    fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
    await act(flush)
    expect(screen.getByText('Continue Practice')).toBeTruthy()

    // 4. Simulate leaving this screen (the learner is now on the session
    // route) and returning to it via Back -- the FIRST focus callback
    // invocation is the hub's own initial-mount focus (skipped by the
    // `hasFocusedOnce` guard, matching real navigation); the SECOND is
    // the actual return-to-focus that triggers the refresh.
    let resolveFocusLookup: (value: unknown) => void = () => {}
    mockLoadActivePracticeSession.mockReturnValue(
      new Promise((resolve) => {
        resolveFocusLookup = resolve
      })
    )
    mockFocusCallback?.()
    await act(flush)
    mockFocusCallback?.()
    await act(flush)

    // 5 + 6. While the focus-triggered lookup is still pending, new
    // ad-hoc Starts must stay disabled and no second Start can fire, but
    // Today's Drill remains independently usable. Confirming the second
    // lookup call actually fired (rather than a UI-text snapshot) is what
    // proves we're synced up to the "still pending" window itself.
    await waitFor(() => expect(mockLoadActivePracticeSession).toHaveBeenCalledTimes(2))
    expect(mockStartAdHocPractice).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Start Standard Practice' }).props.accessibilityState.disabled).toBe(true)
    fireEvent.press(screen.getByRole('button', { name: 'Start Quick Practice' }))
    expect(mockStartAdHocPractice).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Start Drill' }).props.accessibilityState.disabled).toBeFalsy()

    // 7. Resolve the focus-triggered lookup with the same saved session.
    resolveFocusLookup({
      sessionId: 'new-session-1',
      userId: 'u1',
      kind: 'quick',
      title: 'Quick Practice',
      startedAt: '2026-01-01T00:00:00Z',
      sessionSize: 1,
    })
    await act(flush)
    await act(flush)

    // 8 + 9. Continue Practice appears, and new ad-hoc Starts remain
    // disabled (a real, confirmed unfinished session, not just "unknown
    // yet").
    await waitFor(() => expect(mockLoadDrillProgress).toHaveBeenCalledWith('new-session-1'))
    await waitFor(() => expect(screen.getByText('Continue Practice')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start Quick Practice' }).props.accessibilityState.disabled).toBe(true)
    await act(flush)

    // Belt-and-suspenders: explicitly unmount so this render tree can
    // never touch a later test's own render, regardless of anything left
    // pending in this test's promise chains.
    unmount()
  })
})

// 17. Today's Drill remains usable with an active ad-hoc session
it('Today’s Drill stays enabled and pressable even while an ad-hoc session is active', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext())
  mockLoadActivePracticeSession.mockResolvedValue({
    sessionId: 'existing-session',
    userId: 'u1',
    kind: 'standard',
    title: 'Standard Practice',
    startedAt: '2026-01-01T00:00:00Z',
    sessionSize: 10,
  })
  mockUseDailyDrill.mockReturnValue({
    data: { drill: { id: 'd1', status: 'pending', estimated_minutes: 8, target_acs_tasks: [] }, session_id: null, questions: [] },
    loading: false,
    error: null,
    refetch: jest.fn(),
  })

  await render(<PracticeTabScreen />)

  await waitFor(() => expect(screen.getByText('Continue Practice')).toBeTruthy())
  const drillButton = screen.getByRole('button', { name: 'Start Drill' })
  expect(drillButton.props.accessibilityState.disabled).toBeFalsy()
  fireEvent.press(drillButton)
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/practice/[drillId]', params: { drillId: 'd1' } })
})

// 18. weak-area empty state renders honestly
it('shows an honest empty-state message, never a fabricated weak area, when weak_areas is empty', async () => {
  mockUseBootstrapContext.mockReturnValue(bootstrapContext({ data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [] } }) }))

  await render(<PracticeTabScreen />)

  expect(screen.getByText('Complete more practice and Apex will identify areas worth targeting.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Practice /i })).toBeNull()
})

it('never fabricates an ACS task title -- only area_code.task_code and the server-computed evidence score render', async () => {
  mockUseBootstrapContext.mockReturnValue(
    bootstrapContext({
      data: bootstrapFixture({ home: { todays_drill: null, weak_areas: [{ acs_task_id: 'task-uuid-456', area_code: 'III', task_code: 'B', evidence_score: 0.71 }] } }),
    })
  )

  await render(<PracticeTabScreen />)

  expect(screen.getByText('III.B')).toBeTruthy()
  expect(screen.getByText('Evidence: 71%')).toBeTruthy()
})
