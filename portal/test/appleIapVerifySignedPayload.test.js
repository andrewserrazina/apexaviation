// Apple IAP implementation -- end-to-end test of
// verifyAndDecodeAppleSignedPayload against a REAL compact JWS, built
// and signed in this test using the same throwaway PKI as
// appleIapCertChain.test.js's fixtures (leaf signed by intermediate,
// signed by a root substituted in place of the real Apple Root CA G3).
// This is the exact function mobile-iap-verify-purchase and
// apple-app-store-notifications both call on every Apple-signed
// payload they receive -- proving it end-to-end here is the closest
// this environment can get to a real Apple JWS without live sandbox
// access (see this project's IAP implementation report for what still
// needs a real device/sandbox test).
import { describe, it, expect, vi } from 'vitest'

const ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIIBkjCCATmgAwIBAgIUdpH2bjj8yIar+z0n9RA1OUofyp4wCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAxMTAzMDMxN1oXDTM2MTAw
ODAzMDMxN1owFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEuYG2MfvOSOQRH1hIFzGcWyyLsY2OuKk+PwzKGxmJLMTCO/YJ
4qcF0jymzS/EoHjuE8WO07/T7OJjLrmNA9EttaNjMGEwHQYDVR0OBBYEFJAA0kgk
/YT/gJvGIksaEmbrr7B8MB8GA1UdIwQYMBaAFJAA0kgk/YT/gJvGIksaEmbrr7B8
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0cA
MEQCICla8jpOJ1bxArsaLE5vyU0g7amkIgdoOfgSi5zW/FDHAiAd2lVmlliqw1I2
nzysDL7nnuOqhb1yAj7wnYM0dn773g==
-----END CERTIFICATE-----
`

const ROOT_DER_B64 =
  'MIIBkjCCATmgAwIBAgIUdpH2bjj8yIar+z0n9RA1OUofyp4wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAxMTAzMDMxN1oXDTM2MTAwODAzMDMxN1owFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEuYG2MfvOSOQRH1hIFzGcWyyLsY2OuKk+PwzKGxmJLMTCO/YJ4qcF0jymzS/EoHjuE8WO07/T7OJjLrmNA9EttaNjMGEwHQYDVR0OBBYEFJAA0kgk/YT/gJvGIksaEmbrr7B8MB8GA1UdIwQYMBaAFJAA0kgk/YT/gJvGIksaEmbrr7B8MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0cAMEQCICla8jpOJ1bxArsaLE5vyU0g7amkIgdoOfgSi5zW/FDHAiAd2lVmlliqw1I2nzysDL7nnuOqhb1yAj7wnYM0dn773g=='

const INTERMEDIATE_DER_B64 =
  'MIIBmzCCAUGgAwIBAgIUU/54YjwNv2wOpibuMYehpLDgMMcwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAxMTAzMDMxN1oXDTM2MTAwODAzMDMxN1owHzEdMBsGA1UEAwwUVGVzdCBJbnRlcm1lZGlhdGUgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQnDT6BWtSvISmHhqEcUvmN50hDmEbLRHYuM7atPO4rwTeXFW4oR5lxSlhwxRn+OwXgOKFxgNI/Zjpw4FKT3qzro2MwYTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUN4dqBfu6+KyJ8iWqpObOqkgiDpUwHwYDVR0jBBgwFoAUkADSSCT9hP+Am8YiSxoSZuuvsHwwCgYIKoZIzj0EAwIDSAAwRQIgMJXjByN/tvoaW4+W93fN7/k3z4/xpwAcDqXSuvBJDBgCIQCZj9+aJmtUTntCfni4z1xJ35yXQCkojSiWZxsz7Yvetg=='

const LEAF_DER_B64 =
  'MIIBlTCCATugAwIBAgIUd8sDjbbjS2nUlHFD6UyYrlqQrvswCgYIKoZIzj0EAwIwHzEdMBsGA1UEAwwUVGVzdCBJbnRlcm1lZGlhdGUgQ0EwHhcNMjYxMDExMDMwMzE3WhcNMzYxMDA4MDMwMzE3WjAUMRIwEAYDVQQDDAlUZXN0IExlYWYwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATgX1zkKNRDlMng24zoQ0Q9v+UjmieGAIjEwF1rAVhjbz7V2+mqjh4BfX8eU1dcSTcOEH8/fEE3/s/br9ZlRLUlo2AwXjAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDAdBgNVHQ4EFgQUGaKJg/wgg+VRlnPZkciUcNR5RiwwHwYDVR0jBBgwFoAUN4dqBfu6+KyJ8iWqpObOqkgiDpUwCgYIKoZIzj0EAwIDSAAwRQIgGswuVm2DKsblh9ZbGbyv90QIA1WblpYnhUV0s1JiSbUCIQDVTe0aGjpYU7ITqrNUakrjqRMqHIZDOyacgcEwxxC7Vg=='

const LEAF_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAmUqfY9fVe4bAnhR
GyVEBKnlEL04yxgAFJQzV6Gir4mhRANCAATgX1zkKNRDlMng24zoQ0Q9v+UjmieG
AIjEwF1rAVhjbz7V2+mqjh4BfX8eU1dcSTcOEH8/fEE3/s/br9ZlRLUl
-----END PRIVATE KEY-----
`

vi.mock('../supabase/functions/_shared/appleIap/appleRootCertificate.ts', () => ({
  APPLE_ROOT_CA_G3_PEM: ROOT_PEM,
}))

const { verifyAndDecodeAppleSignedPayload, AppleSignedPayloadError } = await import(
  '../supabase/functions/_shared/appleIap/verifySignedPayload.ts'
)

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function pemToDer(pem) {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '')
  return Buffer.from(base64, 'base64')
}

async function signWithLeafKey(header, payload) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(LEAF_PRIVATE_KEY_PEM), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)))
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

const VALID_HEADER = { alg: 'ES256', x5c: [LEAF_DER_B64, INTERMEDIATE_DER_B64, ROOT_DER_B64] }
const SAMPLE_PAYLOAD = { transactionId: 'txn-1', productId: 'com.apexaviationtx.advantage.checkride_prep', bundleId: 'com.apexaviationtx.advantage' }

// A second, entirely separate throwaway PKI (its own root/intermediate/
// leaf, none of them signed by, or related to, the Test Root CA above)
// -- used to prove a chain that is internally consistent (leaf really
// is signed by this intermediate) but doesn't terminate at OUR pinned
// root is still correctly rejected, not just "whatever's in x5c[2]".
const UNTRUSTED_INTERMEDIATE_DER_B64 =
  'MIIBpTCCAUugAwIBAgIUZ0KPV4qz25+IgPxOmb0vsH1WwPcwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRVW50cnVzdGVkIFJvb3QgQ0EwHhcNMjYxMDExMDMwNTM0WhcNMzYxMDA4MDMwNTM0WjAkMSIwIAYDVQQDDBlVbnRydXN0ZWQgSW50ZXJtZWRpYXRlIENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXMOBoFRH+qJsihoW4+UCKhB6h2OOYOiJ+egub2ga5En8YNwCZUUgdQMjnBOcMjjHLNnHHNwtGfzt9SKIUbCJ/aNjMGEwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFCtb8qNb9iMYr3ZS4++XoRtp2i76MB8GA1UdIwQYMBaAFO8fX2AQYDClnn9R0gsqKgKX3YlBMAoGCCqGSM49BAMCA0gAMEUCIHppUIK8UvAWJk9Ks6iF0WP3dBttrLi90W3Cll9D1vZyAiEAjW3Wt+qQaU4m/Rc/VYRofkUlgyp0niXhBmnesKeWJMU='
const UNTRUSTED_LEAF_DER_B64 =
  'MIIBnzCCAUWgAwIBAgIUc9jjTlNoQL3cj3WDl63B13qLm24wCgYIKoZIzj0EAwIwJDEiMCAGA1UEAwwZVW50cnVzdGVkIEludGVybWVkaWF0ZSBDQTAeFw0yNjEwMTEwMzA1MzRaFw0zNjEwMDgwMzA1MzRaMBkxFzAVBgNVBAMMDlVudHJ1c3RlZCBMZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4eRiflv5rYIN9FrRHKZaOXB4CEBys4zvODCdLJCXMwwvA+w+s36cHashMdlfjuaY3RJGrRRgjmbY2RQJqCPFC6NgMF4wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwHQYDVR0OBBYEFHcvn+zJ/FoZ9fRPcY/0zDyLv2t+MB8GA1UdIwQYMBaAFCtb8qNb9iMYr3ZS4++XoRtp2i76MAoGCCqGSM49BAMCA0gAMEUCIQCNFGHEl1W9pWPK73+xQRAqoOPsMt1CqQNi61olr1CXnQIgDpRquAUkRg8azlKF95FaNKDCBYg49rRW0rdUf+oXjfY='
const UNTRUSTED_LEAF_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgGCOLRvQoIswKc4qu
dTdPxj8b+s+93Mp+QvPnNf3RJ9yhRANCAATh5GJ+W/mtgg30WtEcplo5cHgIQHKz
jO84MJ0skJczDC8D7D6zfpwdqyEx2V+O5pjdEkatFGCOZtjZFAmoI8UL
-----END PRIVATE KEY-----
`

async function signWithUntrustedLeafKey(header, payload) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(UNTRUSTED_LEAF_PRIVATE_KEY_PEM),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)))
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

describe('verifyAndDecodeAppleSignedPayload', () => {
  it('verifies a real, correctly-chained-and-signed JWS and returns its decoded payload', async () => {
    const jws = await signWithLeafKey(VALID_HEADER, SAMPLE_PAYLOAD)
    const decoded = await verifyAndDecodeAppleSignedPayload(jws)
    expect(decoded).toEqual(SAMPLE_PAYLOAD)
  })

  it('rejects a JWS whose payload was tampered with after signing', async () => {
    const jws = await signWithLeafKey(VALID_HEADER, SAMPLE_PAYLOAD)
    const [header, , signature] = jws.split('.')
    const tamperedPayload = base64UrlEncode(Buffer.from(JSON.stringify({ ...SAMPLE_PAYLOAD, productId: 'something-else' })))
    const tampered = `${header}.${tamperedPayload}.${signature}`
    await expect(verifyAndDecodeAppleSignedPayload(tampered)).rejects.toThrow(AppleSignedPayloadError)
  })

  it('rejects a JWS that is internally consistent (really signed by its own intermediate) but does not chain to the pinned root', async () => {
    // A completely separate, self-consistent PKI -- the untrusted leaf
    // really is signed by the untrusted intermediate, which really is
    // CA:true, but neither has anything to do with our pinned Test Root
    // CA. certChain.ts ignores x5c[2] entirely (same as Apple's own
    // library) and verifies the intermediate against the PINNED root
    // only, so this must fail there regardless of what's in slot 2.
    const header = { alg: 'ES256', x5c: [UNTRUSTED_LEAF_DER_B64, UNTRUSTED_INTERMEDIATE_DER_B64, UNTRUSTED_INTERMEDIATE_DER_B64] }
    const jws = await signWithUntrustedLeafKey(header, SAMPLE_PAYLOAD)
    await expect(verifyAndDecodeAppleSignedPayload(jws)).rejects.toThrow(AppleSignedPayloadError)
  })

  it('rejects a JWS with no x5c header at all', async () => {
    const jws = await signWithLeafKey({ alg: 'ES256' }, SAMPLE_PAYLOAD)
    await expect(verifyAndDecodeAppleSignedPayload(jws)).rejects.toThrow(AppleSignedPayloadError)
  })

  it('rejects a malformed (non-JWS) string outright', async () => {
    await expect(verifyAndDecodeAppleSignedPayload('not-a-real-jws')).rejects.toThrow(AppleSignedPayloadError)
  })
})
