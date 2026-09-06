import { Redirect, Stack } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { LoadingState } from '../../components/StateViews'

// Protected-routing guard, auth side: while the session is still
// resolving, show a loading state (never briefly flash the sign-in form
// for an already-signed-in learner). Once resolved, a real session
// redirects straight into the app; only a signed-out learner ever sees
// this group's screens.
export default function AuthLayout() {
  const { session, loading } = useAuth()

  if (loading) return <LoadingState label="Loading Apex Advantage…" />
  if (session) return <Redirect href="/(app)" />

  return <Stack screenOptions={{ headerShown: false }} />
}
