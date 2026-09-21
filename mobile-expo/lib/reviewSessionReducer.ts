// Pure, framework-free state machine for one Review Queue session --
// mirrors drillSessionReducer.ts's separation (kept out of any React hook
// so it's directly unit-testable, see test/reviewSessionReducer.test.ts)
// but with a different vocabulary and shape: review items are worked
// through linearly (reveal -> reinforced/needs another pass -> next),
// never re-rated, and there is no resume-from-storage concept (see
// useReviewSession.ts's own comment on why review sessions aren't
// persisted server entities).
import type { MobileReviewItem } from '../../shared/mobile-dto'

export interface ReviewSessionItem {
  reviewItemId: string
  title: string
  prompt: string
  // Minted once, the first time this item enters a session (see
  // buildReviewSessionItems below), and never regenerated afterward --
  // reviewIdempotencyKey.ts's ported web convention. A retry after a
  // failed submitReviewOutcome call reuses this exact same item object.
  submissionKey: string
  processed: boolean
}

export interface ReviewSessionState {
  items: ReviewSessionItem[]
  index: number
  revealed: boolean
  reinforcedCount: number
  needsPassCount: number
}

export type ReviewSessionAction =
  | { type: 'initialize'; items: ReviewSessionItem[] }
  | { type: 'reveal' }
  | { type: 'outcomeApplied'; outcome: 'reinforced' | 'needs_another_pass' }

export function createReviewSessionState(items: ReviewSessionItem[]): ReviewSessionState {
  return { items, index: 0, revealed: false, reinforcedCount: 0, needsPassCount: 0 }
}

export function reviewSessionReducer(state: ReviewSessionState, action: ReviewSessionAction): ReviewSessionState {
  switch (action.type) {
    case 'initialize':
      return createReviewSessionState(action.items)

    case 'reveal':
      return state.revealed ? state : { ...state, revealed: true }

    case 'outcomeApplied': {
      // Mirrors web's `if (!item.processed)` gate at the reducer level:
      // the hook must only ever dispatch this once per successful
      // submitReviewOutcome call, but this is the second half of that
      // guarantee -- a stray duplicate dispatch for an already-processed
      // item (or once the session is already complete) can never
      // double-count the tally.
      if (isReviewSessionComplete(state)) return state
      const current = state.items[state.index]
      if (current.processed) return state
      const items = state.items.slice()
      items[state.index] = { ...current, processed: true }
      return {
        ...state,
        items,
        index: state.index + 1,
        revealed: false,
        reinforcedCount: state.reinforcedCount + (action.outcome === 'reinforced' ? 1 : 0),
        needsPassCount: state.needsPassCount + (action.outcome === 'needs_another_pass' ? 1 : 0),
      }
    }

    default:
      return state
  }
}

export function currentReviewItem(state: ReviewSessionState): ReviewSessionItem | null {
  return state.items[state.index] ?? null
}

export function isReviewSessionComplete(state: ReviewSessionState): boolean {
  return state.index >= state.items.length
}

// Human-readable label for a portal_review_items.acs_category code
// ('crosscountry', 'aircraft-systems', ...) without porting web's full
// CATEGORY_META table (out of scope for this phase -- see
// components/ReadinessCard.tsx / acs.tsx for the richer, ACS-Explorer-
// specific category presentation this deliberately doesn't duplicate).
export function formatReviewCategoryLabel(acsCategory: string | null): string | null {
  if (!acsCategory) return null
  return acsCategory
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

// Builds this session's linear item list from the mobile client's due,
// dpe_question-sourced candidates (Phase 2 v1 scope -- see
// shared/mobile-dto's MobileReviewItem comment). Mirrors web's
// openReviewSession() cap-at-7 behavior; web's backfill-to-3-from-
// myReviewQueue step has no effect here since the mobile client only has
// one candidate pool today (there is no separate "eligible for this
// launch" vs. "everything due" distinction yet -- that arrives once
// Ground-School-sourced items are real candidates too, Phase 3+), so it's
// intentionally omitted rather than implemented as a guaranteed no-op.
const MAX_REVIEW_SESSION_ITEMS = 7

export function buildReviewSessionItems(dueItems: MobileReviewItem[], mintKey: () => string): ReviewSessionItem[] {
  return dueItems
    .filter((it) => it.source_type === 'dpe_question' && !!it.question)
    .slice(0, MAX_REVIEW_SESSION_ITEMS)
    .map((it) => ({
      reviewItemId: it.id,
      title: formatReviewCategoryLabel(it.acs_category) ?? 'DPE Question',
      prompt: it.question as string,
      submissionKey: mintKey(),
      processed: false,
    }))
}
