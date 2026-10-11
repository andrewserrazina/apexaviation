// The one function every Apple-signed payload this app receives goes
// through -- a client-submitted transaction JWS, an App Store Server
// API response's signedTransactionInfo, or a Server Notifications V2
// signedPayload. All three are plain compact JWS strings with the same
// x5c-chained-to-Apple-Root-CA-G3 trust model, so they share this one
// verify-then-decode path rather than three near-duplicate
// implementations.
import { base64UrlDecodeToJson, verifyEs256Jws } from './jwt.ts'
import { verifyAppleCertificateChain, AppleCertificateChainError } from './certChain.ts'

export class AppleSignedPayloadError extends Error {}

interface JwsHeader {
  alg?: string
  x5c?: string[]
}

// Returns the decoded JSON payload only after the certificate chain AND
// the signature both verify -- callers never see a payload from a JWS
// that failed either check, so there is no way to accidentally trust an
// unverified value by forgetting to check a boolean return.
export async function verifyAndDecodeAppleSignedPayload<T>(compactJws: string): Promise<T> {
  const parts = compactJws.split('.')
  if (parts.length !== 3) {
    throw new AppleSignedPayloadError('malformed JWS: expected 3 dot-separated parts')
  }
  const [encodedHeader, encodedPayload] = parts

  let header: JwsHeader
  try {
    header = base64UrlDecodeToJson<JwsHeader>(encodedHeader)
  } catch {
    throw new AppleSignedPayloadError('malformed JWS header')
  }
  if (header.alg !== 'ES256') {
    throw new AppleSignedPayloadError(`unexpected JWS algorithm: ${header.alg}`)
  }
  if (!header.x5c) {
    throw new AppleSignedPayloadError('JWS header has no x5c certificate chain')
  }

  let leafPublicKey: CryptoKey
  try {
    leafPublicKey = await verifyAppleCertificateChain(header.x5c)
  } catch (err) {
    if (err instanceof AppleCertificateChainError) {
      throw new AppleSignedPayloadError(`certificate chain verification failed: ${err.message}`)
    }
    throw err
  }

  const signatureValid = await verifyEs256Jws(compactJws, leafPublicKey)
  if (!signatureValid) {
    throw new AppleSignedPayloadError('JWS signature verification failed')
  }

  try {
    return base64UrlDecodeToJson<T>(encodedPayload)
  } catch {
    throw new AppleSignedPayloadError('malformed JWS payload')
  }
}
