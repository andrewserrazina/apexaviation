// Apex Advantage mobile API client -- normalized, user-safe error shape.
//
// Every screen renders `.userMessage`, never `.raw`/`.status`/`.code` --
// those exist for development logging only (see logDevError below). This
// is what keeps a raw Postgres/PostgREST/Supabase error message
// ("PGRST116...", a raw Postgres exception body, etc.) from ever reaching
// a learner's screen.
export type ApiErrorKind = 'auth' | 'network' | 'validation' | 'forbidden' | 'not_found' | 'server'

export class ApiError extends Error {
  kind: ApiErrorKind
  userMessage: string
  status: number | null
  code: string | null
  raw: unknown

  constructor(params: { kind: ApiErrorKind; userMessage: string; status?: number | null; code?: string | null; raw?: unknown }) {
    super(params.userMessage)
    this.name = 'ApiError'
    this.kind = params.kind
    this.userMessage = params.userMessage
    this.status = params.status ?? null
    this.code = params.code ?? null
    this.raw = params.raw
  }
}

const GENERIC_NETWORK_MESSAGE = 'Check your connection and try again.'
const GENERIC_SERVER_MESSAGE = 'Something went wrong on our end. Please try again in a moment.'
const GENERIC_AUTH_MESSAGE = 'Your session has expired. Please sign in again.'

export function networkError(raw?: unknown): ApiError {
  return new ApiError({ kind: 'network', userMessage: GENERIC_NETWORK_MESSAGE, raw })
}

export function authError(raw?: unknown): ApiError {
  return new ApiError({ kind: 'auth', userMessage: GENERIC_AUTH_MESSAGE, status: 401, raw })
}

export function serverError(raw?: unknown, status: number | null = 500): ApiError {
  return new ApiError({ kind: 'server', userMessage: GENERIC_SERVER_MESSAGE, status, raw })
}

// For a validation/domain error the server already phrased for a human
// (e.g. mobile-practice's "That question is not part of this session," or
// the v118 bridge's "Checkride Prep is not unlocked on this account.") --
// these are already learner-safe, so they pass through as the user
// message rather than being replaced with a generic one.
export function domainError(message: string, status: number | null, code?: string | null, raw?: unknown): ApiError {
  const kind: ApiErrorKind = status === 401 ? 'auth' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'validation'
  return new ApiError({ kind, userMessage: message, status, code: code ?? null, raw })
}

// Development-only logging -- never rendered to the learner, but useful
// in Metro's console while building/debugging.
export function logDevError(context: string, error: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error(`[apex-advantage-mobile] ${context}:`, error)
  }
}
