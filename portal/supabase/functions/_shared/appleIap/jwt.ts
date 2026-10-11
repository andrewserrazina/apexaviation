// Hand-rolled ES256 JWT signing, using Deno's native Web Crypto
// (crypto.subtle) instead of the npm `jsonwebtoken` package Apple's own
// app-store-server-library-node relies on.
//
// Why: `jsonwebtoken`'s ES256 signing path rejects Deno's node:crypto key
// objects with `"alg" parameter "ES256" requires curve "prime256v1"` --
// Deno's crypto shim reports the curve as "p256", which `jsonwebtoken`
// doesn't recognize as the same curve. This is a long-standing, still-
// open Deno/jsonwebtoken incompatibility (denoland/deno#22879); the
// reporters' own workarounds were standing up a separate Node service
// just to sign this one JWT. Web Crypto sidesteps the bug entirely: it
// never goes through jsonwebtoken's curve-name validation, and ECDSA
// P-256 signing/verifying is a first-class, spec-compliant Deno API.
//
// This file only builds the bearer token Apple's App Store Server API
// requires (https://developer.apple.com/documentation/appstoreserverapi/generating_json_web_tokens_for_api_requests);
// claim names/shape match Apple's own library's createBearerToken()
// (app_store_server_api.ts): header {alg, kid, typ}, payload {iss, iat,
// exp, aud: 'appstoreconnect-v1', bid}, signed with a 5-minute lifetime
// (Apple's documented maximum is 1 hour; 5 minutes mirrors Apple's own
// library and keeps a leaked/logged token short-lived).

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)))
}

export function base64UrlDecodeToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64UrlDecodeToJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(value))) as T
}

// Apple issues the private key as a PKCS#8 .p8 PEM file -- strip the PEM
// armor and base64-decode to the raw DER bytes Web Crypto's importKey
// wants.
function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface AppStoreServerApiJwtParams {
  issuerId: string
  keyId: string
  bundleId: string
  /** PKCS#8 PEM content of the .p8 private key downloaded from App Store Connect. */
  privateKeyPem: string
}

// Builds and signs the bearer token for one App Store Server API call.
// A fresh token is cheap to build (one ECDSA sign) and tokens are
// short-lived on purpose, so this is called per-request rather than
// cached across invocations.
export async function signAppStoreServerApiJwt(params: AppStoreServerApiJwtParams): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(params.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )

  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: params.keyId, typ: 'JWT' }
  const payload = {
    iss: params.issuerId,
    iat: nowSeconds,
    exp: nowSeconds + 5 * 60,
    aud: 'appstoreconnect-v1',
    bid: params.bundleId,
  }

  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`
  const signatureBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  )
  // Web Crypto's ECDSA signature output is already the raw r||s
  // concatenation (64 bytes for P-256) that JWS ES256 expects -- no DER
  // re-encoding needed, unlike some other ECDSA signature APIs.
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signatureBytes))}`
}

// Verifies one ES256 JWS signature given the signer's public key (as a
// Web Crypto CryptoKey, already extracted from the leaf certificate by
// certChain.ts). Deliberately rejects anything but ES256 up front --
// Apple's own library infers the algorithm from the key's type instead
// of pinning it, which is a weaker (though in practice safe, since only
// EC keys are involved) pattern than explicit algorithm pinning.
export async function verifyEs256Jws(compactJws: string, publicKey: CryptoKey): Promise<boolean> {
  const parts = compactJws.split('.')
  if (parts.length !== 3) return false
  const [encodedHeader, encodedPayload, encodedSignature] = parts

  let header: { alg?: string }
  try {
    header = base64UrlDecodeToJson<{ alg?: string }>(encodedHeader)
  } catch {
    return false
  }
  if (header.alg !== 'ES256') return false

  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  const signatureBytes = base64UrlDecodeToBytes(encodedSignature)

  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signatureBytes, signingInput)
}
