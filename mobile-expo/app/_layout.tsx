import { useEffect } from 'react'
import { Stack, type ErrorBoundaryProps } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts, Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold, Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat'
import { PlayfairDisplay_700Bold, PlayfairDisplay_400Regular_Italic } from '@expo-google-fonts/playfair-display'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '../contexts/AuthContext'
import { useNotificationRouting } from '../hooks/useNotificationRouting'
import { ErrorState } from '../components/StateViews'
import { isSupabaseConfigured } from '../lib/supabase'
import { logDevError } from '../lib/api/errors'
import { colors } from '../constants/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

// Defense-in-depth alongside the isSupabaseConfigured check below: Expo
// Router renders this in place of the whole root layout if ANYTHING
// thrown during render anywhere in the app isn't otherwise caught --
// e.g. a future bug elsewhere during initial render, not just the
// specific missing-env-var case. Without this, that kind of error would
// still be an uncaught render exception (a crash), same failure shape as
// the verified startup crash this sprint fixes, just from a different
// cause. `retry` re-mounts the route tree from scratch, which is enough
// to recover from a transient failure (e.g. a one-off exception during
// AuthProvider's initial session read) without forcing a full app
// relaunch. SplashScreen.hideAsync() is force-called here too -- a throw
// during the very first render could happen before the fontsLoaded
// effect above ever runs, which would otherwise leave the splash screen
// up forever despite this recoverable screen being shown underneath it.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logDevError('RootLayout.ErrorBoundary', error)
    SplashScreen.hideAsync().catch(() => {})
  }, [error])

  return (
    <SafeAreaProvider>
      <ErrorState message="Something went wrong starting Apex Advantage. Please try again." onRetry={() => { retry() }} />
    </SafeAreaProvider>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_400Regular_Italic,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded, fontError])

  // Active regardless of auth state -- see this hook's own comment for
  // why a cold-start/backgrounded tap while signed out is safe.
  useNotificationRouting()

  if (!fontsLoaded && !fontError) return null

  // Verified TestFlight startup crash fix (see lib/supabase.ts's own
  // comment): a build shipped without EXPO_PUBLIC_SUPABASE_URL/
  // _ANON_KEY configured used to crash here before any UI could render.
  // Now it renders a clear, recoverable error screen instead -- the
  // splash screen has already been dismissed by the effect above, so
  // this is never an indefinite splash screen either.
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaProvider>
        <ErrorState message="Apex Advantage couldn’t start due to a configuration problem. Please contact info@apexaviationtx.com." />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.lightGray } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          {/* Real route for the apexadvantage://auth-callback deep link
              every verification/recovery email ultimately opens -- see
              app/auth-callback.tsx's own header comment for why this
              must be an actual file-based route rather than a Linking
              listener (the previous approach, which produced Expo
              Router's own "Unmatched Route" screen on a physical
              device). Explicitly declared here, matching (auth)/(app)
              above, rather than relying on it being auto-discovered
              alongside them. */}
          <Stack.Screen name="auth-callback" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
