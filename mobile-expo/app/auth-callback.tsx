import { useLocalSearchParams } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { LoadingState } from '../components/StateViews'
import { useAuthCallback } from '../hooks/useAuthDeepLinks'
import { colors } from '../constants/theme'

// The one real Expo Router route every verification/recovery email's
// apexadvantage://auth-callback?type=...&code=... deep link resolves
// to. This MUST be a real file-based route, not just a Linking listener
// -- Expo Router's own linking integration independently subscribes to
// incoming deep links and tries to navigate to whatever path they
// resolve to; without a matching route here, that navigation landed on
// Expo Router's built-in "Unmatched Route" screen on a physical device,
// regardless of what a separate listener did with the same URL. See
// useAuthCallback (hooks/useAuthDeepLinks.ts) for the actual exchange,
// duplicate-code guarding, and follow-up navigation this screen
// delegates to -- this component only reads the params Expo Router
// already resolved for it and shows a brief loading state while that
// runs.
//
// Deliberately a top-level route (a sibling of the (auth) and (app)
// groups, not nested in either): it manages its own navigation away
// once the exchange resolves, so it doesn't need or want either
// group's own session-redirect guard applying to it while that's still
// in flight.
export default function AuthCallbackScreen() {
  const { code, type } = useLocalSearchParams<{ code?: string; type?: string }>()
  useAuthCallback(code ?? null, type ?? null)

  return (
    <View style={styles.container}>
      <LoadingState label="Verifying…" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightGray },
})
