// Sprint 1C Phase 11: resolveNotificationTarget is the ONE place a
// notification payload's `data` is validated before anything is allowed
// to reach expo-router -- these tests are the actual security boundary
// for "a malicious/malformed push payload can never navigate to
// arbitrary content."
const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}))

import { navigateToNotificationTarget, resolveNotificationTarget } from '../lib/notifications/notificationRouting'

beforeEach(() => mockPush.mockReset())

it('resolves a valid daily_drill payload', () => {
  expect(resolveNotificationTarget({ type: 'daily_drill' })).toEqual({ type: 'daily_drill' })
})

it('resolves a valid practice payload', () => {
  expect(resolveNotificationTarget({ type: 'practice' })).toEqual({ type: 'practice' })
})

it('resolves a valid library_pack payload with a well-formed pack id', () => {
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: 'airspace_mastery' })).toEqual({ type: 'library_pack', packId: 'airspace_mastery' })
})

it('returns null for an unknown type -- never guesses at intent', () => {
  expect(resolveNotificationTarget({ type: 'send_me_money' })).toBeNull()
})

it('returns null for a non-object payload', () => {
  expect(resolveNotificationTarget('practice')).toBeNull()
  expect(resolveNotificationTarget(null)).toBeNull()
  expect(resolveNotificationTarget(undefined)).toBeNull()
  expect(resolveNotificationTarget(42)).toBeNull()
})

it('returns null for library_pack missing pack_id', () => {
  expect(resolveNotificationTarget({ type: 'library_pack' })).toBeNull()
})

it('returns null for library_pack with a non-string pack_id', () => {
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: 12345 })).toBeNull()
})

it('returns null for library_pack with an empty-string pack_id', () => {
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: '' })).toBeNull()
})

// The actual path-injection defense: a pack_id containing a path
// separator or traversal sequence must never resolve, since a pathname
// built from this value (however that navigation is eventually
// implemented) must never let payload data control which app route
// something else's params land on.
it('rejects a library_pack pack_id containing a path separator (path injection attempt)', () => {
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: '../../(auth)/sign-in' })).toBeNull()
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: 'airspace_mastery/../other' })).toBeNull()
  expect(resolveNotificationTarget({ type: 'library_pack', pack_id: 'a b' })).toBeNull()
})

it('navigateToNotificationTarget pushes the exact Practice route for daily_drill/practice', () => {
  navigateToNotificationTarget({ type: 'daily_drill' })
  expect(mockPush).toHaveBeenCalledWith('/(app)/practice')

  mockPush.mockReset()
  navigateToNotificationTarget({ type: 'practice' })
  expect(mockPush).toHaveBeenCalledWith('/(app)/practice')
})

// Rev2: the payload contract no longer carries `owned` at all -- the
// pack detail screen resolves ownership itself from the authenticated
// mobile-library catalog, never from route params.
it('navigateToNotificationTarget pushes the pack detail route with only the validated pack id', () => {
  navigateToNotificationTarget({ type: 'library_pack', packId: 'airspace_mastery' })
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/library/[packId]', params: { packId: 'airspace_mastery' } })
})
