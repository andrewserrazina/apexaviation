import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { BootstrapProvider } from '../../contexts/BootstrapContext'
import { LoadingState } from '../../components/StateViews'
import { colors, fonts } from '../../constants/theme'

// Protected-routing guard, app side: a signed-out learner (or one whose
// session is still resolving) never sees any tab's content. Also mounts
// BootstrapProvider here -- one mobile-bootstrap call shared by every
// authenticated screen -- rather than inside Home, so the Practice tab
// can read the same entitlement/loading state without a second bootstrap
// call of its own (Sprint 1A Rev2 section 2/3).
export default function AppLayout() {
  const { session, loading } = useAuth()

  if (loading) return <LoadingState label="Loading Apex Advantage…" />
  if (!session) return <Redirect href="/(auth)/sign-in" />

  return (
    <BootstrapProvider>
      <AppTabs />
    </BootstrapProvider>
  )
}

function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.bodySemiBold, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }} />
      <Tabs.Screen
        name="practice"
        options={{ title: 'Practice', tabBarIcon: ({ color, size }) => <Ionicons name="school" color={color} size={size} /> }}
      />
      <Tabs.Screen name="acs" options={{ title: 'ACS', tabBarIcon: ({ color, size }) => <Ionicons name="compass" color={color} size={size} /> }} />
      <Tabs.Screen name="oral" options={{ title: 'Oral', tabBarIcon: ({ color, size }) => <Ionicons name="mic" color={color} size={size} /> }} />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Ionicons name="library" color={color} size={size} /> }}
      />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  )
}
