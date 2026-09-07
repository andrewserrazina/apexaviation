import { View, StyleSheet } from 'react-native'
import type { MobileStudyPackContent } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Button } from '../Button'
import { Card } from '../Card'
import { SectionHeader } from '../SectionHeader'

interface PackHomeProps {
  content: MobileStudyPackContent
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
export function PackHome({ content, onOpenLessons, onOpenScenarios, onOpenCheckrideCorner, onOpenMasteryCheck, onOpenQuickReference }: PackHomeProps) {
  return (
    <View style={styles.wrap}>
      <SectionHeader title={content.product.name} />

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
