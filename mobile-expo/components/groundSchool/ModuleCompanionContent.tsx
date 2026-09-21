import { View, StyleSheet } from 'react-native'
import type { MobileModuleCompanionContent, MobileModuleQuizQuestion } from '../../../shared/mobile-dto'
import type { GuidedNoteEntry } from '../../hooks/useGuidedNotes'
import type { ConfidenceRating } from '../../lib/groundSchoolEvidence'
import { confidenceValueFor, evidenceContentIdForRating, evidenceContentTypeForRatingSection, evidenceSourceIdForRating } from '../../lib/groundSchoolEvidence'
import { recordGroundSchoolEvidence } from '../../lib/api/groundSchoolDirect'
import { logDevError } from '../../lib/api/errors'
import { AppText } from '../AppText'
import { Card } from '../Card'
import { SectionHeader } from '../SectionHeader'
import { ObjectiveCheckbox } from './ObjectiveCheckbox'
import { GuidedNoteField } from './GuidedNoteField'
import { ConfidenceRatingGroup } from './ConfidenceRatingGroup'
import { ModuleQuizView } from './ModuleQuizView'
import { colors, spacing } from '../../constants/theme'

interface ModuleCompanionContentProps {
  content: MobileModuleCompanionContent | null
  quiz: MobileModuleQuizQuestion[]
  moduleId: string
  profileId: string | null
  existingByPrompt: Record<string, GuidedNoteEntry>
  savingPrompts: Record<string, boolean>
  saveErrors: Record<string, { userMessage: string } | null>
  saveNow: (sectionId: string, promptId: string, value: string) => void
  saveDebounced: (sectionId: string, promptId: string, value: string) => void
  quizAnswers: Record<string, string>
  onQuizAnswer: (questionId: string, value: string) => void
  quizSubmitted: boolean
  quizResults: Record<string, boolean>
  quizScore: number
  quizTotal: number
  quizSubmitting: boolean
  quizSubmitError: string | null
  onQuizSubmit: () => void
}

// Renders every authored section of one module's companion content, in
// the same fixed order site/portal-stable.js's renderModuleCompanionRich()
// uses, as one continuous scrollable workbook -- Ground School's web
// experience is a single long page per module, not a multi-screen hub
// like Library's Lessons/Scenarios/Checkride Corner. Every section is
// optional and rendered only when present (see MobileModuleCompanionContent's
// own comment); nothing is fabricated for a module missing a section.
export function ModuleCompanionContent({
  content,
  quiz,
  moduleId,
  profileId,
  existingByPrompt,
  savingPrompts,
  saveErrors,
  saveNow,
  saveDebounced,
  quizAnswers,
  onQuizAnswer,
  quizSubmitted,
  quizResults,
  quizScore,
  quizTotal,
  quizSubmitting,
  quizSubmitError,
  onQuizSubmit,
}: ModuleCompanionContentProps) {
  function handleRatingChange(sectionId: 'checkride-corner' | 'scenario-workshop', ratingId: string, rating: ConfidenceRating) {
    saveNow(sectionId, ratingId, rating)
    if (!profileId) return
    recordGroundSchoolEvidence(
      profileId,
      evidenceContentTypeForRatingSection(sectionId),
      evidenceContentIdForRating(moduleId, sectionId, ratingId),
      evidenceSourceIdForRating(moduleId, sectionId, ratingId),
      null,
      confidenceValueFor(rating)
    ).catch((err) => logDevError('ModuleCompanionContent.recordGroundSchoolEvidence', err))
  }

  if (!content) {
    return (
      <Card>
        <AppText variant="body" color={colors.mutedText}>
          This module’s workbook content isn’t published yet. Check back soon.
        </AppText>
      </Card>
    )
  }

  return (
    <View style={styles.wrap}>
      {content.modulePurpose ? (
        <Card>
          <AppText variant="label" weight="semibold" color={colors.goldDeep}>
            MODULE PURPOSE
          </AppText>
          <AppText variant="body" color={colors.mutedText}>
            {content.modulePurpose}
          </AppText>
        </Card>
      ) : null}

      {content.objectives?.length ? (
        <Card>
          <SectionHeader title="Learning Objectives" subtitle="Check each box as you build confidence in that objective." />
          {content.objectives.map((o) => (
            <ObjectiveCheckbox
              key={o.id}
              label={o.label}
              checked={existingByPrompt[o.id]?.responseText === 'checked'}
              onToggle={() => saveNow('objectives', o.id, existingByPrompt[o.id]?.responseText === 'checked' ? '' : 'checked')}
            />
          ))}
        </Card>
      ) : null}

      {content.guidedNotes?.length ? (
        <>
          <SectionHeader title="Guided Notes" />
          {content.guidedNotes.map((gn) => (
            <GuidedNoteField
              key={gn.id}
              sectionLabel={gn.section}
              prompt={gn.prompt}
              initialValue={existingByPrompt[gn.id]?.responseText ?? ''}
              saving={!!savingPrompts[gn.id]}
              saveError={saveErrors[gn.id]?.userMessage ?? null}
              onChangeDebounced={(value) => saveDebounced(gn.section, gn.id, value)}
              onSaveNow={(value) => saveNow(gn.section, gn.id, value)}
            />
          ))}
        </>
      ) : null}

      {content.keyConcepts?.length ? (
        <>
          <SectionHeader title="Key Concepts & Definitions" />
          {content.keyConcepts.map((kc) => {
            const promptId = `keyconcept-${kc.id}`
            return (
              <Card key={kc.id}>
                <AppText variant="body" weight="semibold">
                  {kc.term}
                </AppText>
                <AppText variant="caption" color={colors.mutedText}>
                  {kc.definition}
                </AppText>
                <GuidedNoteField
                  prompt="In my own words…"
                  singleLine
                  initialValue={existingByPrompt[promptId]?.responseText ?? ''}
                  saving={!!savingPrompts[promptId]}
                  saveError={saveErrors[promptId]?.userMessage ?? null}
                  onChangeDebounced={(value) => saveDebounced('key-concepts', promptId, value)}
                  onSaveNow={(value) => saveNow('key-concepts', promptId, value)}
                />
              </Card>
            )
          })}
        </>
      ) : null}

      {content.scenario ? (
        <>
          <Card>
            <SectionHeader title="Scenario Workshop Worksheet" />
            <AppText variant="body" color={colors.mutedText}>
              {content.scenario.narrative}
            </AppText>
            <AppText variant="caption" color={colors.mutedText}>
              How confident are you handling this scenario overall?
            </AppText>
            <ConfidenceRatingGroup
              value={(existingByPrompt['scenario-workshop-rating']?.responseText as ConfidenceRating) || null}
              onChange={(rating) => handleRatingChange('scenario-workshop', 'scenario-workshop-rating', rating)}
            />
          </Card>
          {content.scenario.prompts.map((sp) => (
            <GuidedNoteField
              key={sp.id}
              prompt={sp.prompt}
              initialValue={existingByPrompt[sp.id]?.responseText ?? ''}
              saving={!!savingPrompts[sp.id]}
              saveError={saveErrors[sp.id]?.userMessage ?? null}
              onChangeDebounced={(value) => saveDebounced('scenario-workshop', sp.id, value)}
              onSaveNow={(value) => saveNow('scenario-workshop', sp.id, value)}
            />
          ))}
        </>
      ) : null}

      {content.checkrideCorner?.length ? (
        <>
          <SectionHeader title="Checkride Corner Notes" subtitle="Fill this in live during or right after class, then self-rate." />
          {content.checkrideCorner.map((cc, i) => {
            const answerId = `${cc.id}-answer`
            const ratingId = `${cc.id}-rating`
            return (
              <Card key={cc.id}>
                <AppText variant="body" weight="semibold">
                  {i + 1}. {cc.question}
                </AppText>
                <GuidedNoteField
                  prompt="Your answer…"
                  initialValue={existingByPrompt[answerId]?.responseText ?? ''}
                  saving={!!savingPrompts[answerId]}
                  saveError={saveErrors[answerId]?.userMessage ?? null}
                  onChangeDebounced={(value) => saveDebounced('checkride-corner', answerId, value)}
                  onSaveNow={(value) => saveNow('checkride-corner', answerId, value)}
                />
                <ConfidenceRatingGroup
                  value={(existingByPrompt[ratingId]?.responseText as ConfidenceRating) || null}
                  onChange={(rating) => handleRatingChange('checkride-corner', ratingId, rating)}
                />
              </Card>
            )
          })}
        </>
      ) : null}

      {content.knowledgeCheckQuestions?.length ? (
        <>
          <SectionHeader title="Knowledge Check Questions" />
          {content.knowledgeCheckQuestions.map((kcq) => (
            <GuidedNoteField
              key={kcq.id}
              prompt={kcq.prompt}
              initialValue={existingByPrompt[kcq.id]?.responseText ?? ''}
              saving={!!savingPrompts[kcq.id]}
              saveError={saveErrors[kcq.id]?.userMessage ?? null}
              onChangeDebounced={(value) => saveDebounced('knowledge-check', kcq.id, value)}
              onSaveNow={(value) => saveNow('knowledge-check', kcq.id, value)}
            />
          ))}
        </>
      ) : null}

      {content.reflectionQuestions?.length ? (
        <>
          <SectionHeader title="Reflection Questions" />
          {content.reflectionQuestions.map((r) => (
            <GuidedNoteField
              key={r.id}
              prompt={r.prompt}
              initialValue={existingByPrompt[r.id]?.responseText ?? ''}
              saving={!!savingPrompts[r.id]}
              saveError={saveErrors[r.id]?.userMessage ?? null}
              onChangeDebounced={(value) => saveDebounced('reflection', r.id, value)}
              onSaveNow={(value) => saveNow('reflection', r.id, value)}
            />
          ))}
        </>
      ) : null}

      {content.apexChallenge ? (
        <>
          <Card>
            <SectionHeader title="Apex Challenge" />
            <AppText variant="caption" color={colors.mutedText}>
              {content.apexChallenge.instructions}
            </AppText>
          </Card>
          {content.apexChallenge.fields.map((f) => (
            <GuidedNoteField
              key={f.id}
              prompt={f.label}
              singleLine={f.type !== 'textarea'}
              initialValue={existingByPrompt[f.id]?.responseText ?? ''}
              saving={!!savingPrompts[f.id]}
              saveError={saveErrors[f.id]?.userMessage ?? null}
              onChangeDebounced={(value) => saveDebounced('apex-challenge', f.id, value)}
              onSaveNow={(value) => saveNow('apex-challenge', f.id, value)}
            />
          ))}
        </>
      ) : null}

      <ModuleQuizView
        quiz={quiz}
        answers={quizAnswers}
        onAnswer={onQuizAnswer}
        submitted={quizSubmitted}
        results={quizResults}
        score={quizScore}
        total={quizTotal}
        submitting={quizSubmitting}
        submitError={quizSubmitError}
        onSubmit={onQuizSubmit}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
})
