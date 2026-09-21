// Phase 4 (offline content download): save/load roundtrip, malformed-
// file rejection, per-user isolation, and isOfflineContentStale()'s pure
// staleness rule. AsyncStorage uses its own official Jest mock (a real
// in-memory implementation), matching activePracticeStorage.test.ts's own
// convention; expo-file-system's new synchronous File/Directory API has
// no official Jest mock, so this test provides a minimal in-memory fake
// of just the surface offlineContent.ts actually calls.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

// The entire fake lives INSIDE the factory -- a jest.mock() factory is
// hoisted above every other statement in this file (including class/const
// declarations that textually precede it), so any class defined outside
// the factory and merely referenced by name inside it is still undefined
// at the time the factory actually runs. The in-memory stores are
// exposed back out as extra properties on the mocked module itself so
// the tests below can reset/inspect/corrupt them directly.
jest.mock('expo-file-system', () => {
  const fileStore = new Map<string, string>()
  const dirStore = new Set<string>()

  function uriOf(part: string | { uri: string }): string {
    return typeof part === 'string' ? part : part.uri
  }

  class MockDirectory {
    uri: string
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(uriOf).join('/')
    }
    get exists() {
      return dirStore.has(this.uri)
    }
    create() {
      dirStore.add(this.uri)
    }
  }

  class MockFile {
    uri: string
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(uriOf).join('/')
    }
    get exists() {
      return fileStore.has(this.uri)
    }
    write(content: string) {
      fileStore.set(this.uri, content)
    }
    async text() {
      if (!fileStore.has(this.uri)) throw new Error('ENOENT')
      return fileStore.get(this.uri) as string
    }
    delete() {
      fileStore.delete(this.uri)
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: { uri: 'file:///document' } },
    __fileStore: fileStore,
    __dirStore: dirStore,
  }
})

import {
  clearOfflineContent,
  isOfflineContentStale,
  loadOfflineContent,
  saveOfflineContent,
} from '../lib/offlineContent'

const expoFileSystemMock = jest.requireMock('expo-file-system') as { __fileStore: Map<string, string>; __dirStore: Set<string> }
const fileStore = expoFileSystemMock.__fileStore
const dirStore = expoFileSystemMock.__dirStore

interface Payload {
  title: string
}

function isValidPayload(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && typeof (value as Payload).title === 'string'
}

beforeEach(() => {
  fileStore.clear()
  dirStore.clear()
})

describe('isOfflineContentStale', () => {
  it('is never stale when the current version is unknown (null)', () => {
    expect(isOfflineContentStale('v1', null)).toBe(false)
  })

  it('is stale when the current version differs from the local version', () => {
    expect(isOfflineContentStale('v1', 'v2')).toBe(true)
  })

  it('is not stale when the current version matches the local version', () => {
    expect(isOfflineContentStale('v1', 'v1')).toBe(false)
  })
})

describe('saveOfflineContent / loadOfflineContent roundtrip', () => {
  it('returns null when nothing has been downloaded', async () => {
    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).toBeNull()
  })

  it('saves and loads back the exact payload and version', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Airspace Mastery' })

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).not.toBeNull()
    expect(result?.contentVersion).toBe('v1')
    expect(result?.payload).toEqual({ title: 'Airspace Mastery' })
    expect(typeof result?.downloadedAt).toBe('string')
  })

  it('a later save overwrites the earlier one for the same content id', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Old' })
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v2', { title: 'New' })

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result?.contentVersion).toBe('v2')
    expect(result?.payload).toEqual({ title: 'New' })
  })

  it('clearOfflineContent removes both the manifest entry and the file', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Airspace Mastery' })
    await clearOfflineContent('user-a', 'library', 'pack-1')

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).toBeNull()
  })
})

describe('malformed-file / manifest-mismatch rejection (fail-closed)', () => {
  it('returns null when the cached file contains invalid JSON', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Airspace Mastery' })
    // Corrupt the underlying file directly, bypassing the module's own
    // write path -- simulates a partial write or on-disk corruption.
    for (const key of fileStore.keys()) {
      if (key.includes('user-a') && key.includes('library-pack-1')) fileStore.set(key, 'not valid json{{{')
    }

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).toBeNull()
  })

  it('returns null when the cached payload fails the caller-supplied shape guard', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Airspace Mastery' })
    for (const key of fileStore.keys()) {
      if (key.includes('user-a') && key.includes('library-pack-1')) fileStore.set(key, JSON.stringify({ wrongField: 'oops' }))
    }

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).toBeNull()
  })

  it('returns null when the manifest has an entry but the file is missing (partial-write recovery)', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'Airspace Mastery' })
    // Delete only the file, leaving the manifest entry stale.
    for (const key of Array.from(fileStore.keys())) {
      if (key.includes('user-a') && key.includes('library-pack-1')) fileStore.delete(key)
    }

    const result = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    expect(result).toBeNull()
  })
})

describe('per-user isolation', () => {
  it('never returns one user’s downloaded content for a different user id, even for the same content id', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'User A’s copy' })
    await saveOfflineContent('user-b', 'library', 'pack-1', 'v1', { title: 'User B’s copy' })

    const resultA = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    const resultB = await loadOfflineContent('user-b', 'library', 'pack-1', isValidPayload)

    expect(resultA?.payload).toEqual({ title: 'User A’s copy' })
    expect(resultB?.payload).toEqual({ title: 'User B’s copy' })
  })

  it('clearing one user’s content never affects another user’s copy of the same content id', async () => {
    await saveOfflineContent('user-a', 'library', 'pack-1', 'v1', { title: 'User A’s copy' })
    await saveOfflineContent('user-b', 'library', 'pack-1', 'v1', { title: 'User B’s copy' })

    await clearOfflineContent('user-a', 'library', 'pack-1')

    const resultA = await loadOfflineContent('user-a', 'library', 'pack-1', isValidPayload)
    const resultB = await loadOfflineContent('user-b', 'library', 'pack-1', isValidPayload)
    expect(resultA).toBeNull()
    expect(resultB?.payload).toEqual({ title: 'User B’s copy' })
  })
})

describe('content type / content id isolation', () => {
  it('never crosses a library pack and a ground-school module with the same content id', async () => {
    await saveOfflineContent('user-a', 'library', 'PPL-M01', 'v1', { title: 'Library entry' })
    await saveOfflineContent('user-a', 'ground-school', 'PPL-M01', 'v1', { title: 'Ground School entry' })

    const libraryResult = await loadOfflineContent('user-a', 'library', 'PPL-M01', isValidPayload)
    const groundSchoolResult = await loadOfflineContent('user-a', 'ground-school', 'PPL-M01', isValidPayload)

    expect(libraryResult?.payload).toEqual({ title: 'Library entry' })
    expect(groundSchoolResult?.payload).toEqual({ title: 'Ground School entry' })
  })
})
