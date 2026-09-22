// Account deletion -- required for App Store submission (Guideline
// 5.1.1(v): any app with account creation/sign-in must offer in-app
// account deletion, not just deactivation or a website-only path).
//
// Deliberately bypasses invokeMobileFunction/EdgeFunctionName (see
// lib/api/client.ts's own header comment): `delete-account` is not a
// mobile-* function -- it's the same Edge Function the web portal already
// calls (site/portal-stable.js), returns a plain `{ success: true }`
// rather than a mobile DTO, and needs no request body. Reuses client.ts's
// exported extractErrorBody so a failure here is normalized into the
// exact same ApiError shape every other screen already handles.
import { supabase } from '../supabase'
import { extractErrorBody, type InvokeErrorLike } from './client'
import { ApiError, authError, domainError, networkError, serverError, logDevError } from './errors'

export async function deleteAccount(): Promise<void> {
  let result
  try {
    result = await supabase.functions.invoke('delete-account')
  } catch (err) {
    logDevError('deleteAccount threw before responding', err)
    throw networkError(err)
  }

  const { data, error } = result

  if (error) {
    const { message, status, code } = await extractErrorBody(error as InvokeErrorLike)
    logDevError('deleteAccount returned an error', { message, status, code })

    if (status === 401) throw authError(error)
    if (status === null) throw networkError(error)
    if (status >= 500) throw serverError(error, status, code)
    throw domainError(message, status, code, error)
  }

  if (!data || typeof data !== 'object' || !(data as Record<string, unknown>).success) {
    logDevError('deleteAccount: malformed response shape', data)
    throw new ApiError({ kind: 'server', userMessage: 'Something went wrong. Please try again or contact info@apexaviationtx.com.', raw: data })
  }
}
