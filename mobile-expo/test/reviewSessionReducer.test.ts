import type { MobileReviewItem } from '../../shared/mobile-dto'
import {
  buildReviewSessionItems,
  createReviewSessionState,
  currentReviewItem,
  formatReviewCategoryLabel,
  isReviewSessionComplete,
  reviewSessionReducer,
} from '../lib/reviewSessionReducer'

function dueItem(overrides: Partial<MobileReviewItem> = {}): MobileReviewItem {
  return {
    id: 'item-1',
    source_type: 'dpe_question',
    source_id: 'q1',
    module_id: null,
    acs_category: 'airspace',
    reason: 'incorrect',
    priority: 3,
    review_count: 1,
    next_review_at: '2026-01-01T00:00:00Z',
    question: 'What class of airspace surrounds a Class B primary airport?',
    ...overrides,
  }
}

describe('buildReviewSessionItems', () => {
  it('filters out non-dpe_question items (Phase 2 v1 scope)', () => {
    const items = buildReviewSessionItems(
      [dueItem({ id: 'a' }), dueItem({ id: 'b', source_type: 'module_quiz_question', question: null })],
      () => 'key'
    )
    expect(items).toHaveLength(1)
    expect(items[0].reviewItemId).toBe('a')
  })

  it('caps a session at 7 items', () => {
    const many = Array.from({ length: 10 }, (_, i) => dueItem({ id: `item-${i}` }))
    const items = buildReviewSessionItems(many, () => 'key')
    expect(items).toHaveLength(7)
  })

  it('mints a fresh submission key per item via the provided key generator', () => {
    let n = 0
    const items = buildReviewSessionItems([dueItem({ id: 'a' }), dueItem({ id: 'b' })], () => `key-${n++}`)
    expect(items[0].submissionKey).toBe('key-0')
    expect(items[1].submissionKey).toBe('key-1')
  })

  it('never builds an item for a dpe_question row with a null question', () => {
    const items = buildReviewSessionItems([dueItem({ question: null })], () => 'key')
    expect(items).toHaveLength(0)
  })
})

describe('formatReviewCategoryLabel', () => {
  it('title-cases a hyphenated category code', () => {
    expect(formatReviewCategoryLabel('aircraft-systems')).toBe('Aircraft Systems')
  })

  it('returns null for a null category', () => {
    expect(formatReviewCategoryLabel(null)).toBeNull()
  })
})

describe('reviewSessionReducer', () => {
  function initialized() {
    const items = buildReviewSessionItems(
      [dueItem({ id: 'a', question: 'Q1' }), dueItem({ id: 'b', question: 'Q2' })],
      (() => {
        let n = 0
        return () => `key-${n++}`
      })()
    )
    return reviewSessionReducer(createReviewSessionState([]), { type: 'initialize', items })
  }

  it('starts on the first item, unrevealed', () => {
    const state = initialized()
    expect(currentReviewItem(state)?.reviewItemId).toBe('a')
    expect(state.revealed).toBe(false)
  })

  it('reveal sets revealed true and is idempotent', () => {
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'reveal' })
    expect(state.revealed).toBe(true)
    const again = reviewSessionReducer(state, { type: 'reveal' })
    expect(again).toBe(state)
  })

  it('outcomeApplied is ignored before reveal is irrelevant -- it always requires the hook to have revealed first, but the reducer itself does not gate on revealed (the screen gates the button)', () => {
    // The reducer's own contract only gates on `processed`/session-complete
    // (see below) -- reveal-before-outcome is enforced by the screen
    // disabling the outcome buttons until reveal, mirroring
    // drillSessionReducer's split of responsibility between reducer-level
    // invariants and screen-level gating.
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    expect(state.index).toBe(1)
  })

  it('outcomeApplied advances to the next item, resets revealed, and tallies the outcome', () => {
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'reveal' })
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    expect(state.index).toBe(1)
    expect(state.revealed).toBe(false)
    expect(state.reinforcedCount).toBe(1)
    expect(state.needsPassCount).toBe(0)
    expect(currentReviewItem(state)?.reviewItemId).toBe('b')
  })

  it('tallies needs_another_pass separately from reinforced', () => {
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'needs_another_pass' })
    expect(state.needsPassCount).toBe(1)
    expect(state.reinforcedCount).toBe(0)
  })

  it('marks the item processed=true after outcomeApplied, and never double-counts a stray duplicate dispatch for the same index', () => {
    let state = initialized()
    const before = state.items[0]
    expect(before.processed).toBe(false)
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    expect(state.items[0].processed).toBe(true)
    expect(state.reinforcedCount).toBe(1)

    // A stray duplicate for the SAME item (simulated by rewinding index
    // back to 0 -- the reducer must still refuse to re-tally an
    // already-processed item).
    const rewound = { ...state, index: 0 }
    const after = reviewSessionReducer(rewound, { type: 'outcomeApplied', outcome: 'reinforced' })
    expect(after).toBe(rewound)
    expect(after.reinforcedCount).toBe(1)
  })

  it('never advances past the end of the session', () => {
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'needs_another_pass' })
    expect(isReviewSessionComplete(state)).toBe(true)
    expect(currentReviewItem(state)).toBeNull()

    const after = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    expect(after).toBe(state)
    expect(after.reinforcedCount).toBe(1)
    expect(after.needsPassCount).toBe(1)
  })

  it('initialize replaces the whole session state, resetting index/tallies', () => {
    let state = initialized()
    state = reviewSessionReducer(state, { type: 'outcomeApplied', outcome: 'reinforced' })
    const items = buildReviewSessionItems([dueItem({ id: 'c', question: 'Q3' })], () => 'key-c')
    state = reviewSessionReducer(state, { type: 'initialize', items })
    expect(state.index).toBe(0)
    expect(state.reinforcedCount).toBe(0)
    expect(currentReviewItem(state)?.reviewItemId).toBe('c')
  })
})
