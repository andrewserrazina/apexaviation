import {
  confidenceValueFor,
  evidenceContentIdForRating,
  evidenceContentTypeForRatingSection,
  evidenceSourceIdForRating,
} from '../lib/groundSchoolEvidence'

describe('confidenceValueFor', () => {
  it.each([
    ['confident', 1.0],
    ['needs_review', 0.5],
    ['not_yet', 0.0],
  ] as const)('%s maps to %s', (rating, expected) => {
    expect(confidenceValueFor(rating)).toBe(expected)
  })
})

describe('evidenceContentIdForRating', () => {
  it('checkride-corner strips the -rating suffix and namespaces by module', () => {
    expect(evidenceContentIdForRating('PPL-M01', 'checkride-corner', 'cc-1-rating')).toBe('PPL-M01:cc-1')
  })

  it('scenario-workshop is the module id alone', () => {
    expect(evidenceContentIdForRating('PPL-M01', 'scenario-workshop', 'scenario-workshop-rating')).toBe('PPL-M01')
  })
})

describe('evidenceSourceIdForRating', () => {
  it('encodes moduleId:sectionId:ratingId', () => {
    expect(evidenceSourceIdForRating('PPL-M01', 'checkride-corner', 'cc-1-rating')).toBe('PPL-M01:checkride-corner:cc-1-rating')
  })
})

describe('evidenceContentTypeForRatingSection', () => {
  it('maps checkride-corner to checkride_corner', () => {
    expect(evidenceContentTypeForRatingSection('checkride-corner')).toBe('checkride_corner')
  })

  it('maps scenario-workshop to scenario_workshop', () => {
    expect(evidenceContentTypeForRatingSection('scenario-workshop')).toBe('scenario_workshop')
  })
})
