// Apple IAP implementation -- unit tests for the hand-rolled ES256 JWT
// signer/verifier in supabase/functions/_shared/appleIap/jwt.ts. This
// file exists specifically because the official @apple/app-store-
// server-library's ES256 signing (via the npm `jsonwebtoken` package)
// has a documented, unresolved Deno incompatibility (denoland/deno#22879:
// "alg" parameter "ES256" requires curve "prime256v1") -- these tests
// prove the Web-Crypto-based replacement actually produces and verifies
// valid ES256 JWS signatures, round-tripping through real crypto, not
// mocks. Runs directly under vitest/Node since this module only uses
// Web Crypto + base64url -- no Deno-only API, so unlike the Edge
// Function entrypoints (stripe-webhook, mobile-iap-verify-purchase)
// this needs no brace-extraction trick to test for real.
import { describe, it, expect } from 'vitest'
import { signAppStoreServerApiJwt, verifyEs256Jws, base64UrlDecodeToJson } from '../supabase/functions/_shared/appleIap/jwt.ts'

async function generateP256KeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
}

function derToPem(der, label) {
  const base64 = Buffer.from(der).toString('base64')
  const lines = base64.match(/.{1,64}/g).join('\n')
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}

describe('signAppStoreServerApiJwt', () => {
  it('produces a JWT whose header/payload claims match Apple’s own documented shape, signed with the given key', async () => {
    const keyPair = await generateP256KeyPair()
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    const privateKeyPem = derToPem(pkcs8, 'PRIVATE KEY')

    const jwt = await signAppStoreServerApiJwt({
      issuerId: 'issuer-123',
      keyId: 'key-abc',
      bundleId: 'com.apexaviationtx.advantage',
      privateKeyPem,
    })

    const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
    expect(encodedHeader).toBeTruthy()
    expect(encodedPayload).toBeTruthy()
    expect(encodedSignature).toBeTruthy()

    const header = base64UrlDecodeToJson(encodedHeader)
    expect(header).toEqual({ alg: 'ES256', kid: 'key-abc', typ: 'JWT' })

    const payload = base64UrlDecodeToJson(encodedPayload)
    expect(payload.iss).toBe('issuer-123')
    expect(payload.bid).toBe('com.apexaviationtx.advantage')
    expect(payload.aud).toBe('appstoreconnect-v1')
    expect(payload.exp - payload.iat).toBe(5 * 60)

    // The signature must actually verify against the SAME key pair's
    // public half -- proves this isn't just well-formed-looking JSON,
    // it's a real, verifiable ECDSA signature.
    const valid = await verifyEs256Jws(jwt, keyPair.publicKey)
    expect(valid).toBe(true)
  })

  it('a signature produced for one key never verifies against a different key', async () => {
    const signingKeyPair = await generateP256KeyPair()
    const otherKeyPair = await generateP256KeyPair()
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', signingKeyPair.privateKey)
    const privateKeyPem = derToPem(pkcs8, 'PRIVATE KEY')

    const jwt = await signAppStoreServerApiJwt({
      issuerId: 'issuer-123',
      keyId: 'key-abc',
      bundleId: 'com.apexaviationtx.advantage',
      privateKeyPem,
    })

    expect(await verifyEs256Jws(jwt, otherKeyPair.publicKey)).toBe(false)
  })
})

describe('verifyEs256Jws', () => {
  it('rejects a JWS whose header advertises an algorithm other than ES256', async () => {
    const keyPair = await generateP256KeyPair()
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url')
    const forged = `${header}.${payload}.`
    expect(await verifyEs256Jws(forged, keyPair.publicKey)).toBe(false)
  })

  it('rejects a malformed (non-3-part) compact JWS', async () => {
    const keyPair = await generateP256KeyPair()
    expect(await verifyEs256Jws('not-a-jws', keyPair.publicKey)).toBe(false)
  })
})
