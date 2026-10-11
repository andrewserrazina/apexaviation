// Minimal App Store Server API client -- just the one call this app
// needs (GetTransactionInfo), built by hand instead of importing
// Apple's own @apple/app-store-server-library, which has a documented
// Deno incompatibility in exactly the JWT-signing code path this needs
// (see jwt.ts's header comment). Base URLs and the endpoint path below
// are copied verbatim from that library's own source
// (app_store_server_api.ts: PRODUCTION_URL, SANDBOX_URL, and
// getTransactionInfo()'s "/inApps/v1/transactions/" + transactionId) --
// not guessed.
import { signAppStoreServerApiJwt, type AppStoreServerApiJwtParams } from './jwt.ts'
import type { AppleTransactionInfoResponse } from './types.ts'

const PRODUCTION_URL = 'https://api.storekit.apple.com'
const SANDBOX_URL = 'https://api.storekit-sandbox.apple.com'

export class AppStoreServerApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type AppleApiEnvironment = 'Production' | 'Sandbox'

async function requestTransactionInfo(
  baseUrl: string,
  transactionId: string,
  credentials: AppStoreServerApiJwtParams
): Promise<AppleTransactionInfoResponse> {
  const token = await signAppStoreServerApiJwt(credentials)
  const res = await fetch(`${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    // Apple's error responses are small JSON bodies ({errorCode,
    // errorMessage}) that never echo back credentials -- capturing this
    // (bounded, in case of an unexpected non-JSON body from an
    // intermediary) is the difference between "401" and actually
    // knowing whether the Issuer ID, Key ID, or private key is wrong.
    const bodyText = await res.text().catch(() => '')
    throw new AppStoreServerApiError(
      `App Store Server API returned ${res.status} for transaction ${transactionId}: ${bodyText.slice(0, 500)}`,
      res.status
    )
  }
  return res.json()
}

// Apple's documented pattern: ask production first; a transaction that
// only exists in the sandbox (TestFlight, Xcode, sandbox App Store
// sign-in) comes back 404 from production, at which point you retry
// against the sandbox host. Returns which environment actually answered
// alongside the raw response, since the caller needs that to validate
// the decoded payload's own `environment` claim matches where we found
// it (a production call that comes back self-reporting Sandbox would be
// a sign of a replayed/misused sandbox transaction).
export async function getTransactionInfo(
  transactionId: string,
  credentials: AppStoreServerApiJwtParams
): Promise<{ environmentQueried: AppleApiEnvironment; response: AppleTransactionInfoResponse }> {
  try {
    const response = await requestTransactionInfo(PRODUCTION_URL, transactionId, credentials)
    return { environmentQueried: 'Production', response }
  } catch (err) {
    if (err instanceof AppStoreServerApiError && err.status === 404) {
      const response = await requestTransactionInfo(SANDBOX_URL, transactionId, credentials)
      return { environmentQueried: 'Sandbox', response }
    }
    throw err
  }
}
