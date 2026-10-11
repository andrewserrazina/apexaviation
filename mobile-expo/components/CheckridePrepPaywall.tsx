import { View, StyleSheet } from 'react-native'
import { useBootstrapContext } from '../contexts/BootstrapContext'
import { useCheckridePrepPurchase } from '../hooks/useCheckridePrepPurchase'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Button } from './Button'

// Replaces the old Sprint 1A "dead end" (no purchase path existed yet --
// see this component's own former home, StateViews.tsx's LockedState)
// with a real purchase flow: Apple IAP for anyone who isn't entitled,
// using StoreKit's own returned title/price -- never a hardcoded price,
// per this project's IAP implementation report. A web/Stripe purchaser
// never sees this at all: BootstrapContext's `entitled` already flips
// true for them from the SAME checkride_prep_unlocked flag, which is
// checked one level up by every screen that renders this.
interface CheckridePrepPaywallProps {
  // Home's free-dashboard teaser card already has its own SectionHeader
  // above this component -- a second "Checkride Prep isn't included"
  // heading right under it would be redundant, so that one caller opts
  // out. StateViews.tsx's full-screen LockedState (every other caller)
  // has no heading of its own and keeps the default.
  showHeading?: boolean
}

export function CheckridePrepPaywall({ showHeading = true }: CheckridePrepPaywallProps = {}) {
  const bootstrap = useBootstrapContext()
  const profileId = bootstrap.data?.user.id ?? null
  const { state, product, errorMessage, purchase, restore } = useCheckridePrepPurchase({
    profileId,
    onGranted: () => {
      bootstrap.refresh()
    },
  })

  return (
    <View style={styles.wrap}>
      {showHeading ? (
        <AppText variant="subtitle" weight="semibold" center>
          Checkride Prep isn’t included on this account
        </AppText>
      ) : null}

      {state === 'storekit_unavailable' ? (
        <AppText variant="body" color={colors.mutedText} center>
          In-app purchases aren’t available right now. If you believe this is a mistake, contact your instructor or Apex support.
        </AppText>
      ) : (
        <>
          <AppText variant="body" color={colors.mutedText} center>
            Unlock the full DPE Question Library, Scenario Training Center, AI Oral Practice, and progress tracking.
          </AppText>

          {product ? (
            <AppText variant="title" heading weight="bold" center>
              {product.displayPrice}
            </AppText>
          ) : null}

          {state === 'pending' ? (
            <AppText variant="body" color={colors.warning} center>
              Waiting for approval on this purchase (e.g. Ask to Buy). You’ll be unlocked automatically once it’s approved.
            </AppText>
          ) : null}

          {state === 'claimed_by_another_account' || state === 'revoked' || (state === 'failed' && errorMessage) ? (
            <AppText variant="body" color={colors.danger} center>
              {errorMessage}
            </AppText>
          ) : null}

          {state === 'success' ? (
            <AppText variant="body" color={colors.success} center>
              You’re unlocked! Loading Checkride Prep…
            </AppText>
          ) : (
            <View style={styles.actions}>
              <Button
                label="Unlock Checkride Prep"
                onPress={purchase}
                loading={state === 'purchasing' || state === 'verifying'}
                disabled={!product || state === 'loading_product' || state === 'pending'}
                accessibilityHint="Buy Checkride Prep through the App Store"
              />
              <Button
                label="Restore Purchases"
                onPress={restore}
                variant="ghost"
                loading={state === 'verifying'}
                disabled={state === 'loading_product' || state === 'purchasing'}
                accessibilityHint="Restore a Checkride Prep purchase already made on this Apple ID"
              />
            </View>
          )}
        </>
      )}

      <AppText variant="caption" color={colors.mutedText} center>
        Already bought Checkride Prep on the web? Sign in with the same email and it unlocks automatically.
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  // Deliberately NOT flex:1/padded here -- this component is embedded
  // both full-screen (StateViews.tsx's LockedState, which supplies its
  // own flex/centering wrapper) and inside a Card on Home's free
  // dashboard, which already provides its own padding.
  wrap: { alignItems: 'center', gap: spacing.md },
  actions: { width: '100%', gap: spacing.sm },
})
