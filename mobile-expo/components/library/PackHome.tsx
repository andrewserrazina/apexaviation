import { View, StyleSheet } from 'react-native'
import type { MobileStudyPackContent } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { SectionHeader } from '../SectionHeader'

interface DownloadStatus {
  downloadedAt: string | null
  downloading: boolean
  error: string | null
}

interface PackHomeProps {
  content: MobileStudyPackContent
  // Phase 4 (offline content download): non-null while this screen is
  // rendering a cached (not freshly fetched) copy -- shown as a plain,
  // disclosed fact, never hidden. downloadStatus/onDownloadForOffline are
  // both omitted entirely while offline (there's nothing new to download
  // until connectivity returns).
  offlineBanner?: string | null
  downloadStatus?: DownloadStatus | null
  onDownloadForOffline?: () => void
  onOpenLessons: () => void
  onOpenScenarios: () => void
  onOpenCheckrideCorner: () => void
  onOpenMasteryCheck: () => void
  onOpenQuickReference: () => void
}

// Mirrors the web Study Pack home's section list (site/portal-stable.js's
// renderStudyPackHome) -- same five sections, same order, none of them
// gated on anything client-side (the server already re-checked
// entitlement to return this content at all).
export function PackHome({
  content,
  offlineBanner,
  downloadStatus,
  onDownloadForOffline,
  onOpenLessons,
  onOpenScenarios,
  onOpenCheckrideCorner,
  onOpenMasteryCheck,
  onOpenQuickReference,
}: PackHomeProps) {
  return (
    <View style={styles.wrap}>
      <SectionHeader title={content.product.name} />

      {offlineBanner ? (
        <Card>
          <AppText variant="caption" color={colors.mutedText}>
            {offlineBanner}
          </AppText>
        </Card>
      ) : null}

      {downloadStatus ? (
        <Card>
          <AppText variant="subtitle" weight="semibold">
            Offline Access
          </AppText>
          <AppText variant="caption" color={colors.mutedText}>
            {downloadStatus.downloadedAt
              ? `Downloaded ${new Date(downloadStatus.downloadedAt).toLocaleString()}`
              : 'Not downloaded for offline use yet.'}
          </AppText>
          {downloadStatus.error ? (
            <AppText variant="caption" color={colors.danger}>
              {downloadStatus.error}
            </AppText>
          ) : null}
          <Button
            label={downloadStatus.downloadedAt ? 'Re-download for Offline' : 'Download for Offline'}
            variant="ghost"
            onPress={onDownloadForOffline ?? (() => {})}
            loading={downloadStatus.downloading}
            disabled={!onDownloadForOffline}
          />
        </Card>
      ) : null}

      <Card>
        <AppText variant="subtitle" weight="semibold">
          Lessons
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          {content.lessons.length} lessons
        </AppText>
        <Button label="Open Lessons" onPress={onOpenLessons} />
      </Card>

      <Card>
        <AppText variant="subtitle" weight="semibold">
          Scenario Lab
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          {content.scenarios.length} decision-making scenarios
        </AppText>
        <Button label="Open Scenario Lab" onPress={onOpenScenarios} />
      </Card>

      <Card>
        <AppText variant="subtitle" weight="semibold">
          Checkride Corner
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          {content.checkride_corner.length} DPE-style questions
        </AppText>
        <Button label="Open Checkride Corner" onPress={onOpenCheckrideCorner} />
      </Card>

      <Card>
        <AppText variant="subtitle" weight="semibold">
          Mastery Check
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          {content.mastery_check.questions.length} questions • {content.mastery_check.passing_percent}% to pass
        </AppText>
        <Button label="Open Mastery Check" onPress={onOpenMasteryCheck} />
      </Card>

      <Card>
        <AppText variant="subtitle" weight="semibold">
          Quick Reference
        </AppText>
        <AppText variant="caption" color={colors.mutedText}>
          Always available
        </AppText>
        <Button label="Open Quick Reference" onPress={onOpenQuickReference} />
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
})
