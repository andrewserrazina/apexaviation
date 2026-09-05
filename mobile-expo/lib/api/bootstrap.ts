// Typed client for mobile-bootstrap -- the one call made right after
// sign-in (and on Home pull-to-refresh) to learn who the learner is, what
// they've unlocked, and what to show on Home. See
// portal/supabase/functions/mobile-bootstrap/index.ts for the server side
// of this exact contract.
import type { MobileBootstrapDTO } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isPlainObject } from './validate'

export async function fetchBootstrap(): Promise<MobileBootstrapDTO> {
  const data = await invokeMobileFunction<MobileBootstrapDTO>('mobile-bootstrap')
  // Home renders user/training/access/progress/home directly -- a
  // malformed response missing any of them must not reach the render
  // tree (Sprint 1A Rev2 section 9).
  assertShape(
    isPlainObject(data) &&
      isPlainObject(data.user) &&
      isPlainObject(data.training) &&
      isPlainObject(data.access) &&
      isPlainObject(data.progress) &&
      isPlainObject(data.home),
    'fetchBootstrap',
    data
  )
  return data
}
