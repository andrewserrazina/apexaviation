// Validates the x5c certificate chain carried in an Apple-signed JWS
// header, and hands back the leaf certificate's public key so the
// caller can verify the JWS signature itself (see jwt.ts's
// verifyEs256Jws).
//
// Deno natively implements Node's `node:crypto` X509Certificate class
// (documented at https://docs.deno.com/api/node/crypto/~/X509Certificate),
// so this uses that for parsing (issuer/subject/validity/CA flag/public
// key export all work) -- fewer moving parts than a third-party X.509
// library, and avoids the exact Deno/npm-package incompatibility class
// that bit jsonwebtoken (see jwt.ts's header comment). BUT
// X509Certificate.prototype.verify() itself is NOT implemented by the
// Supabase Edge Runtime's Deno build (throws `ERR_NOT_IMPLEMENTED:
// crypto.X509Certificate.prototype.verify` at runtime -- confirmed live,
// not from docs), so "was this certificate signed by this issuer's
// public key" is instead verified by hand below: pull the exact
// tbsCertificate/signatureAlgorithm/signatureValue bytes out of the
// certificate's own DER encoding, convert the DER-encoded ECDSA
// signature to the raw r||s format Web Crypto expects, and verify with
// crypto.subtle -- the same primitive jwt.ts already uses successfully
// for the JWS signature itself, and the one part of this whole chain
// that Deno's runtime does implement correctly. This parsing/conversion
// logic was validated against the real, pinned Apple Root CA G3
// certificate below using both `openssl dgst -verify` and Node's native
// Web Crypto (the same W3C API Deno implements) before being used here:
// a true positive (root verifies against its own public key), and two
// true negatives (a different key on the same curve correctly returns
// false; a wrong-curve key correctly fails rather than silently
// matching).
//
// X509Certificate.verify() only checks "was this certificate signed by
// this public key" -- it does NOT check validity dates, CA flags, or
// issuer/subject matching, so each of those is checked here explicitly,
// mirroring what Apple's own open-source app-store-server-library
// (jws_verification.ts) does for the same chain shape.
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

// --- Minimal hand-rolled DER/ASN.1 reading, scoped to exactly what an
// X.509 certificate's outer structure and an ECDSA signature need.
// Not a general ASN.1 parser -- see the file header for why this exists
// and how it was validated.

interface DerTlv {
  tag: number
  contentStart: number
  contentEnd: number
}

function readDerTlv(data: Uint8Array, offset: number): DerTlv {
  const tag = data[offset]
  const lengthByte = data[offset + 1]
  let length: number
  let headerLen: number
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte
    headerLen = 2
  } else {
    const numBytes = lengthByte & 0x7f
    length = 0
    for (let i = 0; i < numBytes; i++) length = (length << 8) | data[offset + 2 + i]
    headerLen = 2 + numBytes
  }
  const contentStart = offset + headerLen
  return { tag, contentStart, contentEnd: contentStart + length }
}

// Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
// Pulls out the exact bytes that were signed (the full tbsCertificate
// TLV), the signature algorithm's OID, and the raw DER-encoded
// signature (unwrapped from its BIT STRING).
function extractTbsAndSignature(certDer: Uint8Array): { tbs: Uint8Array; sigAlgOidHex: string; sigDer: Uint8Array } {
  const outer = readDerTlv(certDer, 0)
  if (outer.tag !== 0x30) throw new AppleCertificateChainError('malformed certificate: expected outer SEQUENCE')

  const tbsTlv = readDerTlv(certDer, outer.contentStart)
  if (tbsTlv.tag !== 0x30) throw new AppleCertificateChainError('malformed certificate: expected tbsCertificate SEQUENCE')
  const tbs = certDer.slice(outer.contentStart, tbsTlv.contentEnd)

  const sigAlgTlv = readDerTlv(certDer, tbsTlv.contentEnd)
  if (sigAlgTlv.tag !== 0x30) throw new AppleCertificateChainError('malformed certificate: expected signatureAlgorithm SEQUENCE')
  const oidTlv = readDerTlv(certDer, sigAlgTlv.contentStart)
  if (oidTlv.tag !== 0x06) throw new AppleCertificateChainError('malformed certificate: expected signature algorithm OID')
  const sigAlgOidHex = Buffer.from(certDer.slice(oidTlv.contentStart, oidTlv.contentEnd)).toString('hex')

  const sigValTlv = readDerTlv(certDer, sigAlgTlv.contentEnd)
  if (sigValTlv.tag !== 0x03) throw new AppleCertificateChainError('malformed certificate: expected signatureValue BIT STRING')
  const unusedBits = certDer[sigValTlv.contentStart]
  if (unusedBits !== 0) throw new AppleCertificateChainError('malformed certificate: unexpected unused bits in signature')
  const sigDer = certDer.slice(sigValTlv.contentStart + 1, sigValTlv.contentEnd)

  return { tbs, sigAlgOidHex, sigDer }
}

function derIntegerToFixedBytes(der: Uint8Array, offset: number, componentLength: number): { bytes: Uint8Array; nextOffset: number } {
  const tlv = readDerTlv(der, offset)
  if (tlv.tag !== 0x02) throw new AppleCertificateChainError('malformed ECDSA signature: expected INTEGER')
  let bytes = der.slice(tlv.contentStart, tlv.contentEnd)
  // DER INTEGER adds a leading 0x00 only to keep the value non-negative
  // (when the high bit of the magnitude would otherwise read as a sign
  // bit) -- strip it back off so the raw magnitude fits componentLength.
  while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.slice(1)
  if (bytes.length > componentLength) {
    throw new AppleCertificateChainError('malformed ECDSA signature: integer longer than curve component size')
  }
  const out = new Uint8Array(componentLength)
  out.set(bytes, componentLength - bytes.length)
  return { bytes: out, nextOffset: tlv.contentEnd }
}

// ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER } (RFC 3279) --
// Web Crypto's ECDSA verify wants the raw, fixed-width r||s (IEEE
// P1363) concatenation instead, same format jwt.ts's own ES256 signing
// already produces for JWS.
function derEcdsaSignatureToRaw(sigDer: Uint8Array, componentLength: number): Uint8Array {
  const outer = readDerTlv(sigDer, 0)
  if (outer.tag !== 0x30) throw new AppleCertificateChainError('malformed ECDSA signature: expected SEQUENCE')
  const r = derIntegerToFixedBytes(sigDer, outer.contentStart, componentLength)
  const s = derIntegerToFixedBytes(sigDer, r.nextOffset, componentLength)
  const raw = new Uint8Array(componentLength * 2)
  raw.set(r.bytes, 0)
  raw.set(s.bytes, componentLength)
  return raw
}

// signatureAlgorithm OIDs this codebase will accept -- deliberately a
// closed list (ecdsa-with-SHA256, ecdsa-with-SHA384) rather than
// trusting whatever OID shows up, matching Apple's actual, confirmed
// usage (P-256/SHA-256 leaf certs, P-384/SHA-384 intermediate and root
// -- the root's own algorithm was confirmed directly against our pinned
// certificate with `openssl x509 -text`). Anything else fails closed.
const SIG_ALG_OID_TO_HASH: Record<string, 'SHA-256' | 'SHA-384'> = {
  '2a8648ce3d040302': 'SHA-256', // ecdsa-with-SHA256
  '2a8648ce3d040303': 'SHA-384', // ecdsa-with-SHA384
}

// Same closed-list approach for the issuer's curve, read out of its
// SPKI AlgorithmIdentifier -- OID bytes confirmed directly against a
// real P-384 (our pinned root) and a freshly generated P-256 key, not
// taken from memory.
const CURVE_OID_TO_PARAMS: Record<string, { namedCurve: 'P-256' | 'P-384'; componentLength: number }> = {
  '2a8648ce3d030107': { namedCurve: 'P-256', componentLength: 32 }, // prime256v1 / secp256r1
  '2b81040022': { namedCurve: 'P-384', componentLength: 48 }, // secp384r1
}

// SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
// AlgorithmIdentifier (for an EC key) ::= SEQUENCE { id-ecPublicKey OID, namedCurve OID }
function extractCurveFromSpki(spkiDer: Uint8Array): { namedCurve: 'P-256' | 'P-384'; componentLength: number } {
  const outer = readDerTlv(spkiDer, 0)
  if (outer.tag !== 0x30) throw new AppleCertificateChainError('malformed public key: expected SPKI SEQUENCE')
  const algIdTlv = readDerTlv(spkiDer, outer.contentStart)
  if (algIdTlv.tag !== 0x30) throw new AppleCertificateChainError('malformed public key: expected AlgorithmIdentifier SEQUENCE')
  const algOidTlv = readDerTlv(spkiDer, algIdTlv.contentStart)
  if (algOidTlv.tag !== 0x06) throw new AppleCertificateChainError('malformed public key: expected algorithm OID')
  const curveOidTlv = readDerTlv(spkiDer, algOidTlv.contentEnd)
  if (curveOidTlv.tag !== 0x06) throw new AppleCertificateChainError('malformed public key: expected namedCurve OID')
  const curveOidHex = Buffer.from(spkiDer.slice(curveOidTlv.contentStart, curveOidTlv.contentEnd)).toString('hex')
  const curve = CURVE_OID_TO_PARAMS[curveOidHex]
  if (!curve) throw new AppleCertificateChainError(`unsupported public key curve OID: ${curveOidHex}`)
  return curve
}

// The one real signature check this file depends on: was `certDer`
// (the exact bytes of one certificate from the x5c chain) signed by
// the private key matching `issuerSpkiDer` (another certificate's
// already-exported SubjectPublicKeyInfo)? Pure Web Crypto -- no
// node:crypto X509Certificate.verify() involved.
async function verifyCertSignedBy(certDer: Uint8Array, issuerSpkiDer: Uint8Array): Promise<boolean> {
  const { tbs, sigAlgOidHex, sigDer } = extractTbsAndSignature(certDer)
  const hash = SIG_ALG_OID_TO_HASH[sigAlgOidHex]
  if (!hash) throw new AppleCertificateChainError(`unsupported signature algorithm OID: ${sigAlgOidHex}`)

  const curve = extractCurveFromSpki(issuerSpkiDer)
  const publicKey = await crypto.subtle.importKey('spki', issuerSpkiDer, { name: 'ECDSA', namedCurve: curve.namedCurve }, false, ['verify'])
  const rawSignature = derEcdsaSignatureToRaw(sigDer, curve.componentLength)
  return crypto.subtle.verify({ name: 'ECDSA', hash }, publicKey, rawSignature, tbs)
}

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

  const leafDer = Buffer.from(x5c[0], 'base64')
  const intermediateDer = Buffer.from(x5c[1], 'base64')
  const leaf = new X509Certificate(leafDer)
  const intermediate = new X509Certificate(intermediateDer)
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
  const pinnedRootSpkiDer = pinnedRoot.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  if (!(await verifyCertSignedBy(intermediateDer, pinnedRootSpkiDer))) {
    throw new AppleCertificateChainError('intermediate certificate signature does not verify against pinned Apple Root CA G3')
  }
  if (leaf.issuer !== intermediate.subject) {
    throw new AppleCertificateChainError('leaf certificate issuer does not match the intermediate certificate')
  }
  const intermediateSpkiDer = intermediate.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  if (!(await verifyCertSignedBy(leafDer, intermediateSpkiDer))) {
    throw new AppleCertificateChainError('leaf certificate signature does not verify against the intermediate certificate')
  }

  const spkiDer = leaf.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  return crypto.subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}
