// Typed client for mobile-ground-school -- Phase 3 (Ground School
// mobile). Mirrors lib/api/reviewQueue.ts's/practice.ts's shape.
import type { MobileGroundSchoolCatalogResponse, MobileGroundSchoolContentResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isValidGroundSchoolCatalogResponse, isValidGroundSchoolContentResponse } from './validate'

export async function fetchGroundSchoolCatalog(): Promise<MobileGroundSchoolCatalogResponse> {
  const data = await invokeMobileFunction<MobileGroundSchoolCatalogResponse, { action: 'catalog' }>('mobile-ground-school', {
    action: 'catalog',
  })
  assertShape(isValidGroundSchoolCatalogResponse(data), 'fetchGroundSchoolCatalog', data)
  return data
}

export async function fetchGroundSchoolContent(moduleId: string): Promise<MobileGroundSchoolContentResponse> {
  const data = await invokeMobileFunction<MobileGroundSchoolContentResponse, { action: 'content'; module_id: string }>(
    'mobile-ground-school',
    { action: 'content', module_id: moduleId }
  )
  assertShape(isValidGroundSchoolContentResponse(data), 'fetchGroundSchoolContent', data)
  return data
}
