// Pure encoding helpers for confidence-rating ACS evidence, ported
// verbatim from site/portal-stable.js's wireModuleCompanionRich() rating
// click handler -- content_id/source_id must match EXACTLY how v126's
// content_acs_mappings rows are keyed, or record_ground_school_evidence()
// silently finds no mapping and records nothing.
export type ConfidenceRating = 'confident' | 'needs_review' | 'not_yet'
export type RatingSectionId = 'checkride-corner' | 'scenario-workshop'

export function confidenceValueFor(rating: ConfidenceRating): number {
  return rating === 'confident' ? 1.0 : rating === 'needs_review' ? 0.5 : 0.0
}

// checkride_corner is module-namespaced ("PPL-M01:cc-1", stripping the
// "-rating" suffix ratingId carries); scenario_workshop is the module id
// alone (one scenario per module).
export function evidenceContentIdForRating(moduleId: string, sectionId: RatingSectionId, ratingId: string): string {
  return sectionId === 'scenario-workshop' ? moduleId : `${moduleId}:${ratingId.replace(/-rating$/, '')}`
}

export function evidenceSourceIdForRating(moduleId: string, sectionId: RatingSectionId, ratingId: string): string {
  return `${moduleId}:${sectionId}:${ratingId}`
}

export function evidenceContentTypeForRatingSection(sectionId: RatingSectionId): 'checkride_corner' | 'scenario_workshop' {
  return sectionId === 'scenario-workshop' ? 'scenario_workshop' : 'checkride_corner'
}
