import { View, StyleSheet, ScrollView } from 'react-native'
import type { MobileStudyPackQuickReference } from '../../../shared/mobile-dto'
import { colors, spacing } from '../../constants/theme'
import { AppText } from '../AppText'
import { Card } from '../Card'
import { LibraryBackButton } from './LibraryBackButton'

function QuickReferenceTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null
  const [headerRow, ...bodyRows] = rows
  return (
    <ScrollView horizontal style={styles.tableScroll}>
      <View>
        <View style={styles.tableRow}>
          {headerRow.map((cell, i) => (
            <AppText key={i} variant="label" weight="semibold" color={colors.goldDeep} style={styles.tableHeaderCell}>
              {cell}
            </AppText>
          ))}
        </View>
        {bodyRows.map((row, ri) => (
          <View key={ri} style={styles.tableRow}>
            {row.map((cell, ci) => (
              <AppText key={ci} variant="caption" color={colors.mutedText} style={styles.tableCell}>
                {cell}
              </AppText>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

export function QuickReferenceView({ quickReference, onBack, packName }: { quickReference: MobileStudyPackQuickReference; onBack: () => void; packName: string }) {
  return (
    <View style={styles.wrap}>
      <LibraryBackButton label={packName} onPress={onBack} />
      <AppText variant="title" heading weight="bold">
        Quick Reference
      </AppText>
      <AppText variant="caption" color={colors.mutedText}>
        Always available
      </AppText>
      {quickReference.sections.map((section, i) => (
        <Card key={i}>
          <AppText variant="subtitle" weight="semibold">
            {section.title}
          </AppText>
          {section.tables.map((table, ti) => (
            <QuickReferenceTable key={ti} rows={table.rows} />
          ))}
          {section.paragraphs.map((p, pi) => (
            <AppText key={pi} variant="body" color={colors.mutedText}>
              {p}
            </AppText>
          ))}
        </Card>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  tableScroll: { marginVertical: spacing.xs },
  tableRow: { flexDirection: 'row' },
  tableHeaderCell: { minWidth: 100, paddingVertical: spacing.xs, paddingRight: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.navyBorder },
  tableCell: { minWidth: 100, paddingVertical: spacing.xs, paddingRight: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
})
