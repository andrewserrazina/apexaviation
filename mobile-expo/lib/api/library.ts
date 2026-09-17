// Typed client for mobile-library. Catalog is browsable without
// entitlement (see portal/supabase/functions/mobile-library/index.ts) --
// `owned` is the one server-authoritative ownership signal; content is
// separately, independently re-gated server-side when requested. The
// client must never infer pack ownership itself.
import type { MobileLibraryCatalogResponse, MobileLibraryContentResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isNonEmptyString, isPlainObject, isValidStudyPackContent, isValidStudyPackSummary } from './validate'

function validateCatalogResponse(data: unknown, context: string): MobileLibraryCatalogResponse {
  assertShape(isPlainObject(data) && Array.isArray(data.packs) && data.packs.every(isValidStudyPackSummary), context, data)
  return data as MobileLibraryCatalogResponse
}

// The outer contract (version/content-is-an-object) is always validated.
// The inner content shape is validated against the narrowest truthful
// model Sprint 1C Phase 0 established (see shared/mobile-dto's
// MobileStudyPackContent) -- a pack whose content doesn't match that
// shape fails closed here rather than reaching the renderer partially
// populated.
function validateContentResponse(data: unknown, context: string): MobileLibraryContentResponse {
  assertShape(isPlainObject(data) && isNonEmptyString(data.version) && isValidStudyPackContent(data.content), context, data)
  return data as unknown as MobileLibraryContentResponse
}

export async function fetchLibraryCatalog(): Promise<MobileLibraryCatalogResponse> {
  const data = await invokeMobileFunction<MobileLibraryCatalogResponse>('mobile-library')
  return validateCatalogResponse(data, 'fetchLibraryCatalog')
}

export async function fetchLibraryContent(packId: string): Promise<MobileLibraryContentResponse> {
  const data = await invokeMobileFunction<MobileLibraryContentResponse, { action: 'content'; pack_id: string }>('mobile-library', {
    action: 'content',
    pack_id: packId,
  })
  return validateContentResponse(data, 'fetchLibraryContent')
}
