// Typed client for mobile-library. Prepared per this Sprint's spec
// ("Library/push may have clients prepared but no full UI requirement
// yet") -- the Library tab is a polished placeholder in Sprint 1A, not a
// functioning Study Pack browser.
import type { MobileLibraryCatalogResponse, MobileLibraryContentResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'

export function fetchLibraryCatalog(): Promise<MobileLibraryCatalogResponse> {
  return invokeMobileFunction<MobileLibraryCatalogResponse>('mobile-library')
}

export function fetchLibraryContent(packId: string): Promise<MobileLibraryContentResponse> {
  return invokeMobileFunction<MobileLibraryContentResponse, { action: 'content'; pack_id: string }>('mobile-library', {
    action: 'content',
    pack_id: packId,
  })
}
