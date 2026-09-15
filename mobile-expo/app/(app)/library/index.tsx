import { router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { Screen } from '../../../components/Screen'
import { SectionHeader } from '../../../components/SectionHeader'
import { Card } from '../../../components/Card'
import { AppText } from '../../../components/AppText'
import { Button } from '../../../components/Button'
import { ErrorState, LoadingState, EmptyState } from '../../../components/StateViews'
import { useBootstrapContext } from '../../../contexts/BootstrapContext'
import { useLibraryCatalog } from '../../../hooks/useLibraryCatalog'
import { colors, spacing, radii } from '../../../constants/theme'
import type { MobileStudyPackSummary } from '../../../../shared/mobile-dto'

function formatEstimatedTime(pack: MobileStudyPackSummary): string | null {
  if (pack.estimated_minutes_min == null && pack.estimated_minutes_max == null) return null
  if (pack.estimated_minutes_min != null && pack.estimated_minutes_max != null && pack.estimated_minutes_min !== pack.estimated_minutes_max) {
    return `${pack.estimated_minutes_min}–${pack.estimated_minutes_max} min`
  }
  const single = pack.estimated_minutes_min ?? pack.estimated_minutes_max
  return `${single} min`
}

function formatPrice(pack: MobileStudyPackSummary): string {
  const amount = (pack.price_cents / 100).toFixed(pack.price_cents % 100 === 0 ? 0 : 2)
  return `${pack.currency.toUpperCase()} $${amount}`
}

// Sprint 1C Phase 2: every pack in the catalog is browsable, but Library
// itself is not gated on any checkride_prep-style entitlement -- only the
// per-pack `owned` flag decides what a card can lead to. Price is shown
// passively (a fact about the account's account state, not a call to
// action) -- deliberately no Buy/Checkout/purchase-on-web affordance
// anywhere on this screen, matching Sprint 1A Rev2 section 3's existing
// no-purchase-steering rule for Practice's own locked state.
function PackCard({ pack }: { pack: MobileStudyPackSummary }) {
  const estimated = formatEstimatedTime(pack)
  return (
    <Card style={!pack.owned ? styles.lockedCard : undefined}>
      <View style={styles.cardHeader}>
        <AppText variant="subtitle" weight="semibold" style={styles.cardTitle}>
          {pack.name}
        </AppText>
        <View style={[styles.badge, pack.owned ? styles.badgeOwned : styles.badgeLocked]}>
          <AppText variant="label" weight="semibold" color={pack.owned ? colors.success : colors.mutedText}>
            {pack.owned ? 'OWNED' : 'LOCKED'}
          </AppText>
        </View>
      </View>
      {pack.subtitle ? (
        <AppText variant="body" color={colors.mutedText}>
          {pack.subtitle}
        </AppText>
      ) : null}
      <View style={styles.metaRow}>
        <AppText variant="caption" color={colors.mutedText}>
          {pack.certificate_type}
        </AppText>
        {estimated ? (
          <AppText variant="caption" color={colors.mutedText}>
            {' '}
            • {estimated}
          </AppText>
        ) : null}
        {!pack.owned ? (
          <AppText variant="caption" color={colors.mutedText}>
            {' '}
            • {formatPrice(pack)}
          </AppText>
        ) : null}
      </View>
      {!pack.owned ? (
        <AppText variant="caption" color={colors.mutedText}>
          Not currently available on this account.
        </AppText>
      ) : null}
      <Button
        label={pack.owned ? 'Open' : 'View Details'}
        variant={pack.owned ? 'primary' : 'ghost'}
        onPress={() =>
          // Rev2: only the pack id is passed -- [packId].tsx no longer
          // trusts `owned`/`name` from route params as entitlement
          // authority; it re-resolves both from the authenticated
          // mobile-library catalog itself.
          router.push({ pathname: '/(app)/library/[packId]', params: { packId: pack.id } })
        }
        accessibilityHint={pack.owned ? `Open ${pack.name}` : `View details for ${pack.name}, not currently available on this account`}
      />
    </Card>
  )
}

export default function LibraryTabScreen() {
  const bootstrap = useBootstrapContext()
  // Sprint 1C Phase 2: Library is browsable without checkride_prep, so
  // this only waits for bootstrap/auth to have resolved at all -- it does
  // NOT gate on bootstrap.entitled the way Practice does.
  const { data, loading, refreshing, error, refresh } = useLibraryCatalog({ enabled: bootstrap.ready })

  if (!bootstrap.ready || loading) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading Library…" />
      </Screen>
    )
  }

  if (error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error.userMessage} onRetry={refresh} />
      </Screen>
    )
  }

  const packs = data?.packs ?? []

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <SectionHeader title="Library" subtitle="Study Packs for focused, self-paced review" />
      {packs.length === 0 ? (
        <EmptyState title="Nothing here yet" message="Study Packs will appear here as they become available." />
      ) : (
        <View style={styles.list}>
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} />
          ))}
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeOwned: { backgroundColor: colors.successSoft },
  badgeLocked: { backgroundColor: colors.navySoft },
  lockedCard: { opacity: 0.85 },
})
