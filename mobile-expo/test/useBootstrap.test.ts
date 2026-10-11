// Phase 7 (mobile parity regression coverage): app restart / entitlement
// refresh. BootstrapProvider has no AppState-driven refetch -- a cold
// start (app restart) remounts it fresh, and useBootstrap's own mount
// effect is the ENTIRE mechanism that gives that fresh mount current
// entitlement rather than anything cached from a previous launch. These
// tests exercise the real hook against a mocked fetchBootstrap (not a
// source scan): a fresh mount always calls the server rather than
// reusing any module-level cache, and refresh() (used after a purchase/
// restore, and by pull-to-refresh) picks up a changed entitlement
// in-place too.
const mockFetchBootstrap = jest.fn()
jest.mock('../lib/api/bootstrap', () => ({
  fetchBootstrap: (...args: unknown[]) => mockFetchBootstrap(...args),
}))

import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useBootstrap } from '../hooks/useBootstrap'
import { ApiError } from '../lib/api/errors'

function dto(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', full_name: 'Jordan Pilot', email: 'jordan@example.com', role: null },
    training: { certificate_type: 'private_pilot', aircraft_class: 'airplane_single_engine_land', acs_version: '2024', checkride_date: null },
    access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] },
    progress: { xp: 0, current_rank: null, current_streak: 0, longest_streak: 0, readiness_summary: null },
    home: { todays_drill: null, weak_areas: [] },
    ...overrides,
  }
}

beforeEach(() => {
  mockFetchBootstrap.mockReset()
})

it('fetches fresh from the server on mount', async () => {
  mockFetchBootstrap.mockResolvedValue(dto({ access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } }))
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data?.access.checkride_prep).toBe(false)
  expect(mockFetchBootstrap).toHaveBeenCalledTimes(1)
})

// Simulates an app restart after an Apple purchase was granted while the
// app was closed: a brand-new mount (a separate render, standing in for
// a separate process launch -- there is no module-level cache here that
// a shared-instance test could accidentally hide a bug behind) must
// reflect the NEW entitlement.
it('a fresh mount after entitlement changed server-side reflects the NEW entitlement, not anything stale', async () => {
  mockFetchBootstrap.mockResolvedValue(dto({ access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] } }))
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data?.access.checkride_prep).toBe(true)
})

it('resolves to the fetched data with no error', async () => {
  mockFetchBootstrap.mockResolvedValue(dto())
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).not.toBeNull()
  expect(result.current.error).toBeNull()
})

it('refresh() re-fetches and reflects a newly granted entitlement without remounting', async () => {
  mockFetchBootstrap.mockResolvedValueOnce(dto({ access: { checkride_prep: false, ground_school_pack: false, study_pack_entitlements: [] } }))
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data?.access.checkride_prep).toBe(false)

  mockFetchBootstrap.mockResolvedValueOnce(dto({ access: { checkride_prep: true, ground_school_pack: false, study_pack_entitlements: [] } }))
  await act(async () => {
    await result.current.refresh()
  })

  expect(result.current.data?.access.checkride_prep).toBe(true)
  expect(result.current.refreshing).toBe(false)
})

it('a refresh failure surfaces an error without wiping out the previously-loaded data', async () => {
  mockFetchBootstrap.mockResolvedValueOnce(dto())
  const { result } = await renderHook(() => useBootstrap())
  await waitFor(() => expect(result.current.loading).toBe(false))
  const firstData = result.current.data

  mockFetchBootstrap.mockRejectedValueOnce(new ApiError({ kind: 'network', userMessage: 'Check your connection and try again.' }))
  await act(async () => {
    await result.current.refresh()
  })

  expect(result.current.error?.userMessage).toBe('Check your connection and try again.')
  expect(result.current.data).toBe(firstData)
})

it('calling refresh() while the initial mount fetch is still in flight is a no-op (no overlapping fetch)', async () => {
  let resolveMountFetch: (() => void) | undefined
  mockFetchBootstrap.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveMountFetch = () => resolve(dto())
    })
  )
  const { result } = await renderHook(() => useBootstrap())
  expect(result.current.loading).toBe(true)

  // The mount's own fetch hasn't resolved yet -- refresh() must see
  // inFlight already true and do nothing, not fire a second request.
  await act(async () => {
    await result.current.refresh()
  })
  expect(mockFetchBootstrap).toHaveBeenCalledTimes(1)

  await act(async () => {
    resolveMountFetch?.()
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).not.toBeNull()
})
