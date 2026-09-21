// Phase 4 (offline content download): a per-user, per-content-item cache
// of already-fetched static content (Library Study Packs, Ground School
// modules) so a learner with a downloaded item can keep reading it with
// no connection. AI DPE and Review Queue are explicitly out of scope --
// both are live, stateful, server-authoritative flows, not static
// content (see the roadmap's own note).
//
// Split the same way every other *Storage.ts module in this codebase
// splits metadata from payload: a small AsyncStorage manifest (fast to
// read, safe to keep in memory-sized JSON) versus the actual content
// blob, which lives on the filesystem via expo-file-system's new
// (SDK 53+) synchronous File/Directory API. Scoped per user
// (apex-offline/<userId>/...), matching every other *Storage.ts module's
// per-user-key convention, so a device-shared sign-out/sign-in can never
// surface a different learner's downloaded content.
//
// Best-effort writes (a failed download just means "Download for
// Offline" silently didn't persist -- the in-memory content the learner
// is already looking at is unaffected), fail-closed reads (a missing,
// corrupt, or malformed-shape cached file is treated exactly like "never
// downloaded," never partially rendered) -- the same contract every
// other *Storage.ts module in this codebase already uses.
import { Directory, File, Paths } from 'expo-file-system'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type OfflineContentType = 'library' | 'ground-school'

interface ManifestEntry {
  contentVersion: string
  downloadedAt: string
}

type Manifest = Record<string, ManifestEntry>

export interface OfflineContentEntry<T> {
  contentVersion: string
  downloadedAt: string
  payload: T
}

const MANIFEST_KEY_PREFIX = 'apex-advantage-offline-manifest:'

function manifestKey(userId: string): string {
  return MANIFEST_KEY_PREFIX + userId
}

function entryKey(contentType: OfflineContentType, contentId: string): string {
  return `${contentType}:${contentId}`
}

async function loadManifest(userId: string): Promise<Manifest> {
  try {
    const raw = await AsyncStorage.getItem(manifestKey(userId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Manifest
  } catch {
    return {}
  }
}

async function saveManifest(userId: string, manifest: Manifest): Promise<void> {
  try {
    await AsyncStorage.setItem(manifestKey(userId), JSON.stringify(manifest))
  } catch {
    // Best-effort, matching every other *Storage.ts module.
  }
}

function contentDirectory(userId: string): Directory {
  return new Directory(Paths.document, 'apex-offline', userId)
}

function contentFile(userId: string, contentType: OfflineContentType, contentId: string): File {
  // contentId (a UUID pack id, or a 'PPL-M01'-shaped module id) never
  // contains path separators in practice, but the filename is still
  // constructed from a fixed prefix + a sanitized id so a malformed id
  // can never be interpreted as a relative path escape.
  const safeId = contentId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return new File(contentDirectory(userId), `${contentType}-${safeId}.json`)
}

// Never treated as stale if the current version is unknown (offline, or
// the fetch simply hasn't resolved yet) -- staleness is only ever a
// POSITIVE comparison against a real, freshly-fetched version, never an
// absence-implies-stale rule that would force a redownload the learner
// has no connectivity to actually perform.
export function isOfflineContentStale(localVersion: string, currentVersion: string | null): boolean {
  if (currentVersion === null) return false
  return currentVersion !== localVersion
}

export async function saveOfflineContent<T>(
  userId: string,
  contentType: OfflineContentType,
  contentId: string,
  contentVersion: string,
  payload: T
): Promise<void> {
  try {
    const dir = contentDirectory(userId)
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
    const file = contentFile(userId, contentType, contentId)
    file.write(JSON.stringify(payload))

    const manifest = await loadManifest(userId)
    manifest[entryKey(contentType, contentId)] = { contentVersion, downloadedAt: new Date().toISOString() }
    await saveManifest(userId, manifest)
  } catch {
    // Best-effort -- see this module's own top comment.
  }
}

// Returns null (never throws) for anything not cleanly resolvable: no
// manifest entry, no file, a corrupt file, or a payload that fails the
// caller's own shape guard. The manifest and the file are two separate
// stores that can disagree (a save that wrote the manifest entry but
// failed partway through the file write, an app killed mid-write) -- an
// entry missing its file is exactly as "not downloaded" as no entry at
// all, never a crash reading `null.payload`.
export async function loadOfflineContent<T>(
  userId: string,
  contentType: OfflineContentType,
  contentId: string,
  isValidPayload: (value: unknown) => value is T
): Promise<OfflineContentEntry<T> | null> {
  try {
    const manifest = await loadManifest(userId)
    const manifestEntry = manifest[entryKey(contentType, contentId)]
    if (!manifestEntry) return null

    const file = contentFile(userId, contentType, contentId)
    if (!file.exists) return null

    const raw = await file.text()
    const parsed: unknown = JSON.parse(raw)
    if (!isValidPayload(parsed)) return null

    return { contentVersion: manifestEntry.contentVersion, downloadedAt: manifestEntry.downloadedAt, payload: parsed }
  } catch {
    return null
  }
}

export async function clearOfflineContent(userId: string, contentType: OfflineContentType, contentId: string): Promise<void> {
  try {
    const file = contentFile(userId, contentType, contentId)
    if (file.exists) file.delete()

    const manifest = await loadManifest(userId)
    delete manifest[entryKey(contentType, contentId)]
    await saveManifest(userId, manifest)
  } catch {
    // No-op, matching clearActivePracticeSession's existing failure mode.
  }
}
