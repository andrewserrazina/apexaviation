import { router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { ErrorState, LoadingState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useGroundSchoolCatalog } from '../../../hooks/useGroundSchoolCatalog'
import { GROUND_SCHOOL_MODULES } from '../../../constants/groundSchool'
import { colors, spacing, radii } from '../../../constants/theme'
import type { MobileGroundSchoolModuleSummary } from '../../../../shared/mobile-dto'

// Phase 3 (Ground School mobile): mirrors Library's own catalog screen --
// browsable without checkride_prep (entitlement here is per-module, not a
// flat flag), so every module is listed with its own locked/unlocked
// badge rather than gating the whole screen behind one entitlement check.
function ModuleCard({ label, module }: { label: string; module: MobileGroundSchoolModuleSummary }) {
  const disabled = !module.unlocked || !module.has_authored_content
  return (
    <Card style={disabled ? styles.lockedCard : undefined}>
      <View style={styles.cardHeader}>
        <AppText variant="subtitle" weight="semibold" style={styles.cardTitle}>
          {label}
        </AppText>
        <View style={[styles.badge, module.unlocked ? styles.badgeOwned : styles.badgeLocked]}>
          <AppText variant="label" weight="semibold" color={module.unlocked ? colors.success : colors.mutedText}>
            {module.unlocked ? 'UNLOCKED' : 'LOCKED'}
          </AppText>
        </View>
      </View>
      {!module.unlocked ? (
        <AppText variant="caption" color={colors.mutedText}>
          Not currently available on this account.
        </AppText>
      ) : !module.has_authored_content ? (
        <AppText variant="caption" color={colors.mutedText}>
          Workbook content coming soon.
        </AppText>
      ) : null}
      <Button
        label={module.unlocked && module.has_authored_content ? 'Open' : 'View Details'}
        variant={module.unlocked && module.has_authored_content ? 'primary' : 'ghost'}
        disabled={disabled}
        onPress={() => router.push({ pathname: '/(app)/ground-school/[moduleId]', params: { moduleId: module.module_id } })}
        accessibilityHint={module.unlocked ? `Open ${label}` : `${label} is not currently available on this account`}
      />
    </Card>
  )
}

export default function GroundSchoolTabScreen() {
  const bootstrap = useBootstrapContext()
  const catalog = useGroundSchoolCatalog({ enabled: bootstrap.ready })

  if (!bootstrap.ready || catalog.loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Ground School…" />
      </Screen>
    )
  }

  if (catalog.error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={catalog.error.userMessage} onRetry={catalog.refresh} />
      </Screen>
    )
  }

  const byModuleId = new Map((catalog.data?.modules ?? []).map((m) => [m.module_id, m]))

  return (
    <Screen refreshing={catalog.refreshing} onRefresh={catalog.refresh}>
      <SectionHeader title="Ground School" subtitle="The full 20-module Private Pilot curriculum workbook" />
      <View style={styles.list}>
        {GROUND_SCHOOL_MODULES.map((def) => {
          const module = byModuleId.get(def.moduleId)
          if (!module) return null
          return <ModuleCard key={def.moduleId} label={def.moduleLabel} module={module} />
        })}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeOwned: { backgroundColor: colors.successSoft },
  badgeLocked: { backgroundColor: colors.navySoft },
  lockedCard: { opacity: 0.85 },
})
