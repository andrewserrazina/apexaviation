import type { MobileBootstrapDTO, MobileReadinessSummary } from '../../shared/mobile-dto'
import { Screen } from './Screen'
import { AppText } from './AppText'
import { Button } from './Button'
import { Card } from './Card'
import { ReadinessCard } from './ReadinessCard'
import { LoadingState } from './StateViews'
import { colors } from '../constants/theme'

interface PracticeCompletionViewProps {
  title: string
  scoreLine: string
  loading: boolean
  progress: MobileBootstrapDTO['progress'] | null
  readiness: MobileReadinessSummary | null
  ctaLabel: string
  onCta: () => void
}

// Sprint 1B.1: the completion experience Daily Drill's physical-device
// pass already verified, extracted so ad-hoc practice completion (Quick /
// Standard / Weak Area) shows the identical XP/readiness/self-rated-score
// treatment rather than a second, parallel implementation -- there is
// still only ONE completion screen, ONE readiness display, ONE XP
// display, parameterized only by title/score-line/CTA. Daily Drill's own
// CompletionScreen (app/(app)/practice/[drillId].tsx) is now a thin
// wrapper around this component with `title="Drill Complete"` and
// `ctaLabel="Back to Home"` -- its physically-verified rendered output
// (see test/DrillCompletion.test.tsx) is unchanged byte-for-byte.
export function PracticeCompletionView({ title, scoreLine, loading, progress, readiness, ctaLabel, onCta }: PracticeCompletionViewProps) {
  return (
    <Screen>
      <AppText variant="display" heading weight="bold" center>
        {title}
      </AppText>
      <AppText variant="subtitle" color={colors.mutedText} center>
        {scoreLine}
      </AppText>

      {loading ? (
        <LoadingState label="Updating your progress…" />
      ) : (
        <>
          {progress ? (
            <Card>
              <AppText variant="body" center>
                {progress.xp} XP • {progress.current_streak} day streak
              </AppText>
            </Card>
          ) : null}
          {readiness ? (
            <ReadinessCard
              overallScore={readiness.overall_score}
              evidenceLevel={readiness.evidence_level}
              reasonCodes={readiness.reason_codes}
            />
          ) : null}
        </>
      )}

      <Button label={ctaLabel} onPress={onCta} />
    </Screen>
  )
}
