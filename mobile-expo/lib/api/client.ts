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
//
// Rev3: `options.accessToken`, when given, overrides the Authorization
// header supabase-js would otherwise attach automatically from whatever
// session happens to be active in this client AT THE MOMENT this call
// actually executes -- which is not necessarily the session that
// initiated the call (see getPinnedAccessToken below). Omitting it keeps
// the exact prior behavior for every caller that doesn't need pinning.
export async function invokeMobileFunction<TResponse, TBody extends Record<string, unknown> | undefined = undefined>(
  name: EdgeFunctionName,
  body?: TBody,
  options?: { accessToken?: string }
): Promise<TResponse> {
  let result
  try {
    if (options?.accessToken) {
      const invokeOptions: { body?: TBody; headers: Record<string, string> } = {
        headers: { Authorization: `Bearer ${options.accessToken}` },
      }
      if (body !== undefined) invokeOptions.body = body
      result = await supabase.functions.invoke(name, invokeOptions)
    } else {
      result = await supabase.functions.invoke(name, body === undefined ? undefined : { body })
    }
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

// Rev3 (independent review): a mutation whose result determines whether
// another Apex account gets registered/revoked must never rely on
// "whichever session is active when the call finally executes" -- an
// async operation that started for one authenticated user can still be
// in flight after that user signs out and a different user signs in on
// the same device, and supabase-js's functions.invoke() always attaches
// the CURRENT session's token, not a snapshot from when the calling code
// began. This resolves the session that is actually active right now and
// verifies it still belongs to `expectedUserId` -- the user id the
// calling code captured when IT started -- before handing back a token
// to pin the mutation to. A caller-supplied id is never trusted as
// authorization by itself; this only ever returns a token for a session
// supabase-js itself currently recognizes as belonging to that id, and
// throws (never falling back to the ambient/current session) the moment
// that doesn't hold, so a stale caller can never have its mutation
// silently reattributed to whoever is signed in now.
export async function getPinnedAccessToken(expectedUserId: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session || data.session.user.id !== expectedUserId) {
    throw authError(error ?? new Error('The signed-in account changed before this action finished.'))
  }
  return data.session.access_token
}

export { ApiError }
