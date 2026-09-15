// Sprint 1C Rev4 (independent review): direct unit tests for the tiny
// module-level coordinator that closes the "registration can resurrect
// an active mobile_devices row after sign-out cleanup finished" race --
// see the module's own header comment for why access-token pinning alone
// cannot close this, and AuthContext.tsx/usePushRegistration.ts for how
// it's actually wired into sign-out and registration.
import { beginRegistrationMutation, closeUserForSignOut, releaseUserGate } from '../lib/notifications/pushMutationCoordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  // Coordinator state is module-level (keyed by user id), so it must be
  // reset between tests to avoid one test's user ids leaking into
  // another's -- there is no other lifecycle hook for this.
  releaseUserGate('u1')
  releaseUserGate('u2')
  releaseUserGate('user-a')
  releaseUserGate('user-b')
})

it('a fresh user has an open gate -- beginRegistrationMutation succeeds and returns a release function', () => {
  const release = beginRegistrationMutation('u1')
  expect(release).not.toBeNull()
  expect(typeof release).toBe('function')
})

it('after closeUserForSignOut, beginRegistrationMutation for that user returns null (zero mutation)', async () => {
  await closeUserForSignOut('u1')
  const release = beginRegistrationMutation('u1')
  expect(release).toBeNull()
})

it('closeUserForSignOut waits for an already-entered critical section to release before resolving', async () => {
  const release = beginRegistrationMutation('u1')
  expect(release).not.toBeNull()

  let closed = false
  const closePromise = closeUserForSignOut('u1').then(() => {
    closed = true
  })

  // Give the microtask queue every chance to settle prematurely -- it
  // must not, since the critical section hasn't released yet.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(closed).toBe(false)

  release!()
  await closePromise
  expect(closed).toBe(true)
})

it('releaseUserGate reopens the gate for a later sign-in by the same user id', async () => {
  await closeUserForSignOut('u1')
  expect(beginRegistrationMutation('u1')).toBeNull()

  releaseUserGate('u1')

  const release = beginRegistrationMutation('u1')
  expect(release).not.toBeNull()
  release!()
})

// Test C (Blocker 1 spec): all coordinator state is scoped by user id --
// User A's closing gate must never affect User B's, and vice versa.
it('two different user ids have completely independent gates', async () => {
  await closeUserForSignOut('user-a')

  expect(beginRegistrationMutation('user-a')).toBeNull()
  const releaseB = beginRegistrationMutation('user-b')
  expect(releaseB).not.toBeNull()
  releaseB!()
})

it('calling the release function more than once is safe and does not double-resolve', async () => {
  const release = beginRegistrationMutation('u1')
  expect(release).not.toBeNull()

  release!()
  expect(() => release!()).not.toThrow()

  // closeUserForSignOut must still resolve cleanly afterward.
  await closeUserForSignOut('u1')
})

it('multiple concurrent registrations for the same user are all waited on before closeUserForSignOut resolves', async () => {
  const first = beginRegistrationMutation('u1')
  const second = beginRegistrationMutation('u1')
  expect(first).not.toBeNull()
  expect(second).not.toBeNull()

  let closed = false
  const closePromise = closeUserForSignOut('u1').then(() => {
    closed = true
  })

  first!()
  await Promise.resolve()
  await Promise.resolve()
  expect(closed).toBe(false)

  second!()
  await closePromise
  expect(closed).toBe(true)
})

it('closeUserForSignOut on a user with no gate at all resolves immediately', async () => {
  const gate = deferred<void>()
  closeUserForSignOut('never-seen-user').then(gate.resolve)
  await gate.promise
})
