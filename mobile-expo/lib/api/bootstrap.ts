// Typed client for mobile-bootstrap -- the one call made right after
// sign-in (and on Home pull-to-refresh) to learn who the learner is, what
// they've unlocked, and what to show on Home. See
// portal/supabase/functions/mobile-bootstrap/index.ts for the server side
// of this exact contract.
import type { MobileBootstrapDTO } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isNullableString, isPlainObject, isValidReadinessSummaryOrNull, isValidTodaysDrillOrNull, isValidWeakArea } from './validate'

// Sprint 1A Rev3 section 3: checks the exact nested fields Home actually
// reads -- not the full DTO shape, and not a schema-validation
// dependency, just enough that a malformed 200 can't crash Home's render
// or misrender a boolean/number as something else.
function isValidBootstrap(data: unknown): data is MobileBootstrapDTO {
  if (!isPlainObject(data)) return false
  const { user, training, access, progress, home } = data

  if (!isPlainObject(user) || typeof user.id !== 'string' || !isNullableString(user.full_name)) return false

  if (
    !isPlainObject(training) ||
    !isNullableString(training.certificate_type) ||
    !isNullableString(training.aircraft_class) ||
    !isNullableString(training.acs_version)
  ) {
    return false
  }

  if (!isPlainObject(access) || typeof access.checkride_prep !== 'boolean') return false

  if (
    !isPlainObject(progress) ||
    typeof progress.xp !== 'number' ||
    typeof progress.current_streak !== 'number' ||
    typeof progress.longest_streak !== 'number' ||
    !isNullableString(progress.current_rank) ||
    !isValidReadinessSummaryOrNull(progress.readiness_summary)
  ) {
    return false
  }

  if (
    !isPlainObject(home) ||
    !isValidTodaysDrillOrNull(home.todays_drill) ||
    !Array.isArray(home.weak_areas) ||
    !home.weak_areas.every(isValidWeakArea)
  ) {
    return false
  }

  return true
}

export async function fetchBootstrap(): Promise<MobileBootstrapDTO> {
  const data = await invokeMobileFunction<MobileBootstrapDTO>('mobile-bootstrap')
  assertShape(isValidBootstrap(data), 'fetchBootstrap', data)
  return data
}
