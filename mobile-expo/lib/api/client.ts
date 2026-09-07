// Apex Advantage mobile API client -- the ONE place every screen goes
// through to call a mobile-* Edge Function. Screens must never call
// `supabase.functions.invoke` directly (see the per-domain files in this
// folder: bootstrap.ts, dailyDrill.ts, practice.ts, readiness.ts,
// library.ts, pushToken.ts) -- this file is what makes every one of those
// calls typed, uses the active session automatically (supabase-js attaches
// the current access token to every functions.invoke call), and turns any
// failure into the single normalized ApiError shape in errors.ts.
import { supabase } from '../supabase'
import { ApiError, authError, domainError, networkError, serverError, logDevError } from './errors'

type EdgeFunctionName =
  | 'mobile-bootstrap'
  | 'mobile-daily-drill'
  | 'mobile-practice'
  | 'mobile-readiness'
  | 'mobile-library'
  | 'mobile-push-token'

interface InvokeErrorLike {
  message?: string
  context?: { status?: number; json?: () => Promise<unknown> }
}

async function extractErrorBody(error: InvokeErrorLike): Promise<{ message: string; status: number | null; code: string | null }> {
  const status = typeof error.context?.status === 'number' ? error.context.status : null
  if (error.context && typeof error.context.json === 'function') {
    try {
      const body = (await error.context.json()) as { error?: string; code?: string }
      if (body && typeof body.error === 'string') {
        return { message: body.error, status, code: body.code ?? null }
      }
    } catch {
      // Body wasn't JSON (or the response was already consumed) -- fall
      // through to the generic message below rather than throw here.
    }
  }
  return { message: error.message || 'Request failed', status, code: null }
}

// Calls one mobile-* Edge Function with a typed body and typed response.
// Throws ApiError -- callers never see a raw supabase-js FunctionsError.
export async function invokeMobileFunction<TResponse, TBody extends Record<string, unknown> | undefined = undefined>(
  name: EdgeFunctionName,
  body?: TBody
): Promise<TResponse> {
  let result
  try {
    result = await supabase.functions.invoke(name, body === undefined ? undefined : { body })
  } catch (err) {
    logDevError(`${name} threw before responding`, err)
    throw networkError(err)
  }

  const { data, error } = result

  if (error) {
    const { message, status, code } = await extractErrorBody(error as InvokeErrorLike)
    logDevError(`${name} returned an error`, { message, status, code })

    if (status === 401) throw authError(error)
    if (status === null) {
      // supabase-js couldn't even reach the function / parse a response --
      // this is the network-failure case, not a domain error.
      throw networkError(error)
    }
    if (status >= 500) throw serverError(error, status, code)
    throw domainError(message, status, code, error)
  }

  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    // Defensive: our Edge Functions always return non-2xx on error, but
    // guard the 200-with-error-body shape too, matching the same
    // extraction pattern already used by the web portal
    // (portal/src/pages/GroundSchedule.jsx's extractInvokeError).
    const message = String((data as Record<string, unknown>).error)
    throw domainError(message, 200, null, data)
  }

  return data as TResponse
}

export { ApiError }
