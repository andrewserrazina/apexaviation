// Typed client for mobile-review-queue -- Phase 2 (Review Queue mobile).
// Mirrors lib/api/practice.ts's shape: one thin wrapper function per
// action, each validated immediately with assertShape before the caller
// ever sees the data.
import type {
  MobileReviewOutcomeResponse,
  MobileReviewQueueListResponse,
  MobileReviewRevealResponse,
  ReviewOutcomeValue,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isValidReviewOutcomeResponse, isValidReviewQueueListResponse, isValidReviewRevealResponse } from './validate'

export async function fetchReviewQueue(): Promise<MobileReviewQueueListResponse> {
  const data = await invokeMobileFunction<MobileReviewQueueListResponse, { action: 'list' }>('mobile-review-queue', { action: 'list' })
  assertShape(isValidReviewQueueListResponse(data), 'fetchReviewQueue', data)
  return data
}

export async function revealReviewItem(reviewItemId: string): Promise<MobileReviewRevealResponse> {
  const data = await invokeMobileFunction<MobileReviewRevealResponse, { action: 'reveal'; review_item_id: string }>('mobile-review-queue', {
    action: 'reveal',
    review_item_id: reviewItemId,
  })
  assertShape(isValidReviewRevealResponse(data), 'revealReviewItem', data)
  return data
}

export async function submitReviewOutcome(
  reviewItemId: string,
  outcome: ReviewOutcomeValue,
  idempotencyKey: string
): Promise<MobileReviewOutcomeResponse> {
  const data = await invokeMobileFunction<
    MobileReviewOutcomeResponse,
    { action: 'outcome'; review_item_id: string; outcome: ReviewOutcomeValue; idempotency_key: string }
  >('mobile-review-queue', { action: 'outcome', review_item_id: reviewItemId, outcome, idempotency_key: idempotencyKey })
  assertShape(isValidReviewOutcomeResponse(data), 'submitReviewOutcome', data)
  return data
}
