// Pure predicate for Delete Account's type-your-email-to-confirm gate,
// extracted so it's unit-testable without simulating TextInput typing --
// this jest-expo/@testing-library/react-native setup does not commit
// state updates from a controlled TextInput's fireEvent.changeText (see
// test/DpeSession.test.tsx's own comment on this same environment
// limitation), so screen-level tests can't exercise this logic directly.
export function emailConfirmationMatches(typedText: string, memberEmail: string | null | undefined): boolean {
  const email = (memberEmail ?? '').trim().toLowerCase()
  if (!email) return false
  return typedText.trim().toLowerCase() === email
}
