// Validates the x5c certificate chain carried in an Apple-signed JWS
// header, and hands back the leaf certificate's public key so the
// caller can verify the JWS signature itself (see jwt.ts's
// verifyEs256Jws).
//
// Deno natively implements Node's `node:crypto` X509Certificate class
// (documented at https://docs.deno.com/api/node/crypto/~/X509Certificate),
// so this uses that rather than a third-party X.509/ASN.1 library --
// fewer moving parts, and avoids the exact Deno/npm-package
// incompatibility class that bit jsonwebtoken (see jwt.ts's header
// comment). X509Certificate.verify() only checks "was this certificate
// signed by this public key" -- it does NOT check validity dates, CA
// flags, or issuer/subject matching, so each of those is checked here
// explicitly, mirroring what Apple's own open-source
// app-store-server-library (jws_verification.ts) does for the same
// chain shape.
//
// Known, deliberate scope limit (see this project's IAP implementation
// report): this does NOT perform OCSP revocation checking of the
// signing certificates themselves, and does NOT check Apple's private
// extension OIDs (1.2.840.113635.100.6.11.1 on the leaf,
// 1.2.840.113635.100.6.2.1 on the intermediate) that Apple's own library
// checks -- Node/Deno's X509Certificate has no built-in accessor for
// arbitrary non-standard extensions, and hand-parsing raw DER for two
// extra checks on top of full chain-of-trust validation was judged not
// worth the added parsing-correctness risk for a first implementation.
// The chain-of-trust check below (leaf signed by intermediate,
// intermediate signed by OUR pinned Apple Root CA G3, correct issuer/
// subject linkage, CA flag, and validity windows) is still the real
// security boundary: nobody without Apple's actual CA private keys can
// produce a chain that passes it.
import { X509Certificate } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { APPLE_ROOT_CA_G3_PEM } from './appleRootCertificate.ts'

const MAX_CLOCK_SKEW_MS = 60_000

export class AppleCertificateChainError extends Error {}

function assertValidNow(cert: X509Certificate, label: string) {
  const now = Date.now()
  const validFrom = new Date(cert.validFrom).getTime()
  const validTo = new Date(cert.validTo).getTime()
  if (now + MAX_CLOCK_SKEW_MS < validFrom) {
    throw new AppleCertificateChainError(`${label} certificate is not yet valid`)
  }
  if (now - MAX_CLOCK_SKEW_MS > validTo) {
    throw new AppleCertificateChainError(`${label} certificate has expired`)
  }
}

// `x5c` is the JWS header's array of base64-encoded DER certificates.
// Apple's JWS headers always carry exactly 3: [leaf, intermediate,
// root] -- the embedded root is never trusted on its own (that would
// let anyone embed their own self-signed "root"); only OUR pinned copy
// of Apple Root CA G3 is used as the trust anchor.
export async function verifyAppleCertificateChain(x5c: string[]): Promise<CryptoKey> {
  if (!Array.isArray(x5c) || x5c.length !== 3) {
    throw new AppleCertificateChainError(`expected exactly 3 certificates in x5c, got ${x5c?.length ?? 0}`)
  }

  const leaf = new X509Certificate(Buffer.from(x5c[0], 'base64'))
  const intermediate = new X509Certificate(Buffer.from(x5c[1], 'base64'))
  const pinnedRoot = new X509Certificate(APPLE_ROOT_CA_G3_PEM)

  assertValidNow(leaf, 'leaf')
  assertValidNow(intermediate, 'intermediate')
  assertValidNow(pinnedRoot, 'root')

  if (!intermediate.ca) {
    throw new AppleCertificateChainError('intermediate certificate is not a CA certificate')
  }
  if (intermediate.issuer !== pinnedRoot.subject) {
    throw new AppleCertificateChainError('intermediate certificate issuer does not match pinned Apple Root CA G3')
  }
  if (!intermediate.verify(pinnedRoot.publicKey)) {
    throw new AppleCertificateChainError('intermediate certificate signature does not verify against pinned Apple Root CA G3')
  }
  if (leaf.issuer !== intermediate.subject) {
    throw new AppleCertificateChainError('leaf certificate issuer does not match the intermediate certificate')
  }
  if (!leaf.verify(intermediate.publicKey)) {
    throw new AppleCertificateChainError('leaf certificate signature does not verify against the intermediate certificate')
  }

  const spkiDer = leaf.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  return crypto.subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}
