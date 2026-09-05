// Typed client for mobile-bootstrap -- the one call made right after
// sign-in (and on Home pull-to-refresh) to learn who the learner is, what
// they've unlocked, and what to show on Home. See
// portal/supabase/functions/mobile-bootstrap/index.ts for the server side
// of this exact contract.
import type { MobileBootstrapDTO } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'

export function fetchBootstrap(): Promise<MobileBootstrapDTO> {
  return invokeMobileFunction<MobileBootstrapDTO>('mobile-bootstrap')
}
