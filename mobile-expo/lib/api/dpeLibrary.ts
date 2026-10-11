// Typed client for mobile-dpe-library -- Phase 5 (mobile parity) item 1.
import type { MobileDpeLibraryResponse } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isValidDpeLibraryResponse } from './validate'

export async function fetchDpeLibrary(): Promise<MobileDpeLibraryResponse> {
  const data = await invokeMobileFunction<MobileDpeLibraryResponse, Record<string, never>>('mobile-dpe-library', {})
  assertShape(isValidDpeLibraryResponse(data), 'fetchDpeLibrary', data)
  return data
}
