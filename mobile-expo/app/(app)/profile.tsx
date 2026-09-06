import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'
import { Screen } from '../../components/Screen'
import { AppText } from '../../components/AppText'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { colors, spacing } from '../../constants/theme'

export default function ProfileScreen() {
  const { user, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      router.replace('/(auth)/sign-in')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Profile', presentation: 'modal' }} />
      <Screen scroll={false}>
        <View style={styles.wrap}>
          <Card>
            <AppText variant="label" weight="semibold" color={colors.mutedText}>
              SIGNED IN AS
            </AppText>
            <AppText variant="body" weight="semibold">
              {user?.email ?? 'Unknown'}
            </AppText>
          </Card>
          <Button label="Sign Out" onPress={handleSignOut} loading={signingOut} variant="danger" />
        </View>
      </Screen>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
})
