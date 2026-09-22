// App Store submission requirement (Guideline 5.1.1(v)): deleteAccount()
// is the one place in the client that calls a non-mobile-* Edge Function
// directly (see lib/api/account.ts's own header comment) -- these tests
// exercise the real client.ts/account.ts code through the same
// functions.invoke mock seam apiClient.test.ts already uses, confirming
// it reuses the exact same error-normalization contract every other API
// call gets, plus its own malformed-success-body guard.
const mockInvoke = jest.fn()

jest.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}))

import { deleteAccount } from '../lib/api/account'
import { ApiError } from '../lib/api/errors'

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected promise to reject, but it resolved')
}

beforeEach(() => mockInvoke.mockReset())

describe('deleteAccount', () => {
  it('calls the delete-account function with no body and resolves on { success: true }', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null })
    await expect(deleteAccount()).resolves.toBeUndefined()
    expect(mockInvoke).toHaveBeenCalledWith('delete-account')
  })

  it('normalizes a 401 into an auth ApiError', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 401, json: async () => ({ error: 'Invalid or expired session' }) } },
    })
    const err = await captureError(deleteAccount())
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('auth')
  })

  it('normalizes a 5xx into a generic server ApiError, never echoing the raw body', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 500, json: async () => ({ error: 'ERROR: 42703: column "foo" does not exist' }) } },
    })
    const err = await captureError(deleteAccount())
    expect(err.kind).toBe('server')
    expect(err.userMessage).not.toMatch(/42703|column/i)
  })

  it('normalizes a domain error (e.g. a Stripe cancellation failure surfaced as 400) to the server-provided message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { status: 400, json: async () => ({ error: 'Failed to anonymize profile: constraint violation' }) } },
    })
    const err = await captureError(deleteAccount())
    expect(err.userMessage).toBe('Failed to anonymize profile: constraint violation')
  })

  it('normalizes a thrown/unreachable failure into a network ApiError', async () => {
    mockInvoke.mockRejectedValue(new TypeError('Network request failed'))
    const err = await captureError(deleteAccount())
    expect(err.kind).toBe('network')
  })

  it('rejects a 200 response missing success:true, never treating it as a silent success', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null })
    const err = await captureError(deleteAccount())
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('server')
  })

  it('rejects a null data body', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null })
    const err = await captureError(deleteAccount())
    expect(err.kind).toBe('server')
  })
})
