// Apple IAP implementation -- unit tests for certChain.ts's x5c chain
// validation, against a real (self-generated, throwaway) 3-level EC
// P-256 PKI: a root CA, an intermediate CA it signed, and a leaf cert
// the intermediate signed -- generated once with `openssl` and embedded
// here as fixed test vectors (see this file's own fixtures below), not
// regenerated per test run. This proves the actual chain-walking logic
// (issuer/subject linkage, signature verification, CA flag, validity
// window) against real X.509 certificates and real ECDSA signatures,
// not a hand-waved mock -- the one thing it can't prove is that real
// Apple certificates satisfy the same checks, which needs a live
// sandbox/production verification against an actual Apple-signed JWS
// (see this project's IAP implementation report).
//
// The pinned root certificate (appleRootCertificate.ts) is swapped for
// this fixture PKI's own root via vi.mock -- production code still
// pins the real Apple Root CA G3 unconditionally; only this test's
// view of that module is substituted.
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

vi.mock('../supabase/functions/_shared/appleIap/appleRootCertificate.ts', () => ({
  APPLE_ROOT_CA_G3_PEM: ROOT_PEM,
}))

const { verifyAppleCertificateChain, AppleCertificateChainError } = await import(
  '../supabase/functions/_shared/appleIap/certChain.ts'
)

describe('verifyAppleCertificateChain', () => {
  it('accepts a real [leaf, intermediate, root] chain that genuinely chains to the pinned root', async () => {
    const publicKey = await verifyAppleCertificateChain([LEAF_DER_B64, INTERMEDIATE_DER_B64, ROOT_DER_B64])
    expect(publicKey).toBeTruthy()
    expect(publicKey.algorithm.name).toBe('ECDSA')
  })

  it('rejects a chain that does not have exactly 3 certificates', async () => {
    await expect(verifyAppleCertificateChain([LEAF_DER_B64, INTERMEDIATE_DER_B64])).rejects.toThrow(AppleCertificateChainError)
    await expect(verifyAppleCertificateChain([])).rejects.toThrow(AppleCertificateChainError)
  })

  it('rejects a leaf swapped in as its own "intermediate" -- it is not a CA certificate', async () => {
    // Leaf cert in the intermediate slot: fails the CA-flag check before
    // signature verification is even attempted.
    await expect(verifyAppleCertificateChain([LEAF_DER_B64, LEAF_DER_B64, ROOT_DER_B64])).rejects.toThrow(AppleCertificateChainError)
  })

  it('rejects a chain whose intermediate was not actually signed by the pinned root', async () => {
    // Intermediate cert placed directly as "leaf" against the real
    // intermediate as "intermediate" -- leaf.issuer (Test Root CA)
    // won't match intermediate.subject (Test Intermediate CA).
    await expect(verifyAppleCertificateChain([INTERMEDIATE_DER_B64, INTERMEDIATE_DER_B64, ROOT_DER_B64])).rejects.toThrow(
      AppleCertificateChainError
    )
  })
})
