import { type ReactNode } from 'react'
import { View, StyleSheet } from 'react-native'
import { colors, spacing } from '../constants/theme'
import { AppText } from './AppText'
import { Card } from './Card'

// Narrower than any one reveal response DTO on purpose -- both
// mobile-practice's MobilePracticeRevealResponse (session_id/question_id
// keyed) and mobile-review-queue's MobileReviewRevealResponse
// (review_item_id keyed) satisfy this structurally, so Phase 2 reuses
// this component completely unchanged rather than duplicating it.
export interface RevealableAnswerContent {
  model_answer: string
  common_mistakes: string | null
  dpe_evaluating: string | null
  real_world_application: string | null
}

interface RevealContentProps {
  content: RevealableAnswerContent
}

// Renders a reveal payload faithfully -- server content, not rewritten --
// in the fixed hierarchy Sprint 1A section 11 specifies: model answer
// always shown, the other three sections only when non-null.
export function RevealContent({ content }: RevealContentProps) {
  return (
    <Card style={styles.card}>
      <Section label="Model Answer">
        <AppText variant="body">{content.model_answer}</AppText>
      </Section>

      {content.common_mistakes ? (
        <Section label="Common Mistakes">
          <AppText variant="body" color={colors.mutedText}>
            {content.common_mistakes}
          </AppText>
        </Section>
      ) : null}

      {content.dpe_evaluating ? (
        <Section label="What the DPE Is Evaluating">
          <AppText variant="body" color={colors.mutedText}>
            {content.dpe_evaluating}
          </AppText>
        </Section>
      ) : null}

      {content.real_world_application ? (
        <Section label="Real-World Application">
          <AppText variant="body" color={colors.mutedText}>
            {content.real_world_application}
          </AppText>
        </Section>
      ) : null}
    </Card>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" weight="semibold" color={colors.goldDeep}>
        {label.toUpperCase()}
      </AppText>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  section: { gap: 4 },
})
