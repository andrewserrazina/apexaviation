import { Redirect, Stack } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { LoadingState } from '../../components/StateViews'

// Protected-routing guard, auth side: while the session is still
// resolving, show a loading state (never briefly flash the sign-in form
// for an already-signed-in learner). Once resolved, a real session
// redirects straight into the app; only a signed-out learner ever sees
// this group's screens.
//
// isPasswordRecovery is the one deliberate exception: exchanging a
// password-reset deep link's code (useAuthDeepLinks.ts) establishes a
// real Supabase session, which would otherwise look identical to a
// normal sign-in and redirect straight past the Reset Password screen
// into the app before the learner ever sets a new password -- exactly
// the "recovery callback creates a navigation loop" failure this guard
// must not have.
export default function AuthLayout() {
  const { session, loading, isPasswordRecovery } = useAuth()

  if (loading) return <LoadingState label="Loading Apex Advantage…" />
  if (session && !isPasswordRecovery) return <Redirect href="/(app)" />

  return <Stack screenOptions={{ headerShown: false }} />
}
