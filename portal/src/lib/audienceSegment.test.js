import { describe, it, expect } from 'vitest'
import {
  buildSegmentDefinition, isSegmentEmpty, describeAudience,
  isBroadAudience, isPreviewStale, BROAD_AUDIENCE_WARNING_THRESHOLD,
} from './audienceSegment'

describe('buildSegmentDefinition', () => {
  it('produces an empty object when no filters are set', () => {
    expect(buildSegmentDefinition({})).toEqual({})
    expect(buildSegmentDefinition({ checkride: null, products: {} })).toEqual({})
  })

  it('prunes empty strings, nulls, and empty arrays but keeps real values', () => {
    const state = {
      checkride: { mode: 'within_days', within_days: 45, from: '' },
      acquisition: { signup_utm_source: [], last_touch_source: ['instagram', 'tiktok'] },
      products: { checkride_prep: 'owns', mock_oral: null },
    }
    expect(buildSegmentDefinition(state)).toEqual({
      checkride: { mode: 'within_days', within_days: 45 },
      acquisition: { last_touch_source: ['instagram', 'tiktok'] },
      products: { checkride_prep: 'owns' },
    })
  })

  it('combines multiple filter groups with AND semantics implied by presence', () => {
    const segment = buildSegmentDefinition({
      checkride: { mode: 'within_days', within_days: 45 },
      products: { checkride_prep: 'owns', mock_oral: 'none' },
      engagement: { active_within_days: 30 },
    })
    expect(Object.keys(segment)).toEqual(['checkride', 'products', 'engagement'])
  })

  it('keeps boolean false values (does not treat false as empty)', () => {
    const segment = buildSegmentDefinition({ engagement: { activated: false } })
    expect(segment).toEqual({ engagement: { activated: false } })
  })
})

describe('isSegmentEmpty', () => {
  it('is true for an empty or missing segment', () => {
    expect(isSegmentEmpty({})).toBe(true)
    expect(isSegmentEmpty(null)).toBe(true)
    expect(isSegmentEmpty(undefined)).toBe(true)
  })
  it('is false once any group is present', () => {
    expect(isSegmentEmpty({ checkride: { mode: 'past' } })).toBe(false)
  })
})

describe('describeAudience', () => {
  it('explicitly calls out an unfiltered audience', () => {
    expect(describeAudience({})).toBe('All marketing-eligible members')
  })

  it('describes the Mock Oral launch use case', () => {
    const segment = {
      checkride: { mode: 'within_days', within_days: 45 },
      products: { checkride_prep: 'owns', mock_oral: 'none' },
    }
    const label = describeAudience(segment)
    expect(label).toContain('Checkride within 45 days')
    expect(label).toContain('Checkride Prep: owns')
    expect(label).toContain('Mock Oral: none')
  })

  it('describes the readiness -> Mock Oral use case', () => {
    const label = describeAudience({
      readiness: { completed: true },
      checkride: { mode: 'within_days', within_days: 60 },
      products: { mock_oral: 'none' },
    })
    expect(label).toContain('Readiness completed')
    expect(label).toContain('Checkride within 60 days')
  })

  it('describes multi-select acquisition filters joined by comma', () => {
    const label = describeAudience({ acquisition: { signup_utm_source: ['instagram', 'tiktok', 'facebook'] } })
    expect(label).toBe('Signup source: instagram, tiktok, facebook')
  })
})

describe('isBroadAudience', () => {
  it('flags an audience at or above the warning threshold', () => {
    expect(isBroadAudience(BROAD_AUDIENCE_WARNING_THRESHOLD)).toBe(true)
    expect(isBroadAudience(BROAD_AUDIENCE_WARNING_THRESHOLD + 50)).toBe(true)
  })
  it('does not flag a small audience', () => {
    expect(isBroadAudience(36)).toBe(false)
  })
  it('is false for a non-numeric/unknown count', () => {
    expect(isBroadAudience(null)).toBe(false)
    expect(isBroadAudience(undefined)).toBe(false)
  })
})

describe('isPreviewStale', () => {
  it('is stale before any preview has run', () => {
    expect(isPreviewStale(null, { checkride: { mode: 'past' } })).toBe(true)
  })
  it('is not stale when the segment is unchanged since the last preview', () => {
    const segment = { products: { checkride_prep: 'owns' } }
    expect(isPreviewStale({ products: { checkride_prep: 'owns' } }, segment)).toBe(false)
  })
  it('becomes stale the moment a filter changes', () => {
    const previewed = { products: { checkride_prep: 'owns' } }
    const current = { products: { checkride_prep: 'not_owns' } }
    expect(isPreviewStale(previewed, current)).toBe(true)
  })
})
