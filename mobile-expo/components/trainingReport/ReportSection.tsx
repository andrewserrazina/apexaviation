import { type ReactNode } from 'react'
import { View, StyleSheet } from 'react-native'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Card } from '../Card'

// Every Training Report section (Phase 5) is a titled Card -- mirrors
// web's fixed "<h4>Section Title</h4>" per-section shape. Screens using
// this render nothing at all for a section whose data-building function
// returned null/empty (see training-report/index.tsx), matching web's
// own "empty sections hidden entirely, never rendered blank" rule.
export function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <AppText variant="subtitle" weight="semibold" color={colors.navy}>
        {title}
      </AppText>
      <View style={styles.body}>{children}</View>
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
})
