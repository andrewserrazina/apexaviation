// Sprint 1C Rev4 (independent review): a Supabase access token captured
// before sign-out began can remain valid at the server for the rest of
// its natural JWT lifetime -- access-token pinning alone (see
// lib/api/client.ts's getPinnedAccessToken) closes "this mutation gets
// misattributed to a DIFFERENT account," but it cannot by itself close a
// same-account ORDERING race: a registerDevice() call already dispatched
// for User A can still complete and upsert an ACTIVE mobile_devices row
// for A strictly AFTER AuthContext.signOut() has already read/revoked
// whatever row it knew about and finished its "sign-out cleanup" step.
//
// This module is a tiny, dependency-free, module-level coordinator for
// that specific ordering:
//   - a registration mutation SYNCHRONOUSLY enters a per-user "gate"
//     immediately before its first server-mutating call (never across an
//     indefinitely-waiting step like the OS permission prompt or Expo
//     token acquisition);
//   - sign-out SYNCHRONOUSLY closes that gate to new entrants, then waits
//     for anything that had ALREADY entered to finish, before it reads
//     "the final" local registration pointer and revokes it;
//   - a registration that tries to enter after the gate has closed aborts
//     immediately with ZERO server mutation.
//
// State is keyed by user id only -- never by React generation/component
// instance -- so it is correct across remounts and unrelated to whatever
// component happens to be mounted; User B's gate is a completely separate
// map entry from User A's.
interface PushMutationGate {
  closing: boolean
  pending: Set<Promise<void>>
}

const gates = new Map<string, PushMutationGate>()

function gateFor(userId: string): PushMutationGate {
  let gate = gates.get(userId)
  if (!gate) {
    gate = { closing: false, pending: new Set() }
    gates.set(userId, gate)
  }
  return gate
}

// Call this SYNCHRONOUSLY, immediately before the first server-mutating
// call of a registration attempt for `userId`. Returns a release function
// to call exactly once, in a `finally`, once the mutation and its local
// bookkeeping have settled -- or `null` if this user's sign-out has
// already closed the gate, in which case the caller MUST perform zero
// server mutation and return immediately.
export function beginRegistrationMutation(userId: string): (() => void) | null {
  const gate = gateFor(userId)
  if (gate.closing) return null

  let resolve!: () => void
  const settled = new Promise<void>((res) => {
    resolve = res
  })
  gate.pending.add(settled)

  let released = false
  return () => {
    if (released) return
    released = true
    gate.pending.delete(settled)
    resolve()
  }
}

// Marks `userId` as closing to NEW registration mutations (synchronously
// -- no registration started after this line can ever enter the critical
// section above), then waits for every registration mutation that had
// ALREADY entered before this call to finish releasing. Safe to call for
// a user with no gate yet (nothing to wait for).
export async function closeUserForSignOut(userId: string): Promise<void> {
  const gate = gateFor(userId)
  gate.closing = true
  await Promise.all(Array.from(gate.pending))
}

// Clears this user's gate entirely once sign-out's own cleanup has fully
// finished, so a LATER sign-in by the same user id starts with a fresh,
// open gate rather than staying permanently closed.
export function releaseUserGate(userId: string): void {
  gates.delete(userId)
}
