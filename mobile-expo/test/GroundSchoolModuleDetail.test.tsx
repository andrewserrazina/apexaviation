// Phase 3 (Ground School mobile): the module detail screen -- moduleId
// is the only trusted route param, unlocked status is resolved from the
// authenticated catalog (mirrors test/LibraryPackDetail.test.tsx's own
// untrusted-route-params shape).
import { render, screen } from '@testing-library/react-native'
import ModuleDetailScreen from '../app/(app)/ground-school/[moduleId]'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ moduleId: 'PPL-M01' }),
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseGroundSchoolCatalog = jest.fn()
jest.mock('../hooks/useGroundSchoolCatalog', () => ({
  useGroundSchoolCatalog: (...args: unknown[]) => mockUseGroundSchoolCatalog(...args),
}))

const mockUseGroundSchoolContent = jest.fn()
jest.mock('../hooks/useGroundSchoolContent', () => ({
  useGroundSchoolContent: (...args: unknown[]) => mockUseGroundSchoolContent(...args),
}))

const mockUseGuidedNotes = jest.fn()
jest.mock('../hooks/useGuidedNotes', () => ({
  useGuidedNotes: (...args: unknown[]) => mockUseGuidedNotes(...args),
}))

const mockUseModuleQuiz = jest.fn()
jest.mock('../hooks/useModuleQuiz', () => ({
  useModuleQuiz: (...args: unknown[]) => mockUseModuleQuiz(...args),
}))

// Phase 4 (offline content download): this screen now also consults
// connectivity + a local cache alongside the online content fetch.
// Defaulted to "online, nothing cached" so every pre-existing test above
// keeps exercising the exact same online-path behavior it always has.
const mockUseIsOnline = jest.fn()
jest.mock('../hooks/useIsOnline', () => ({
  useIsOnline: () => mockUseIsOnline(),
}))

const mockUseOfflineContentCache = jest.fn()
jest.mock('../hooks/useOfflineContentCache', () => ({
  useOfflineContentCache: (...args: unknown[]) => mockUseOfflineContentCache(...args),
}))

// lib/offlineContent.ts itself pulls in AsyncStorage/expo-file-system --
// this screen's own gating/rendering is what's under test here, not
// offline caching mechanics (covered in test/offlineContent.test.ts).
jest.mock('../lib/offlineContent', () => ({
  isOfflineContentStale: jest.fn(() => false),
}))

function offlineCacheFixture(overrides: Record<string, unknown> = {}) {
  return { cached: null, loaded: true, downloading: false, downloadError: null, download: jest.fn(), clear: jest.fn(), refreshCache: jest.fn(), ...overrides }
}

// ModuleCompanionContent imports lib/api/groundSchoolDirect.ts directly
// (Phase 3's deliberate direct-write exception), which otherwise pulls in
// the real supabase.ts -> largeSecureStore.ts -> AsyncStorage chain, same
// AsyncStorage-avoidance reasoning as every other screen test's mocks.
// This screen's own gating/rendering is what's under test here, not
// evidence-recording behavior (covered in useModuleQuiz.test.tsx).
jest.mock('../lib/api/groundSchoolDirect', () => ({
  fetchGuidedNotes: jest.fn(),
  upsertGuidedNote: jest.fn(),
  recordGroundSchoolEvidence: jest.fn(),
  fetchLatestModuleQuizAttempt: jest.fn(),
  submitModuleQuizAttempt: jest.fn(),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return { ready: true, data: { user: { id: 'u1' } }, ...overrides }
}

function catalogResult(overrides: Record<string, unknown> = {}) {
  return { data: { modules: [{ module_id: 'PPL-M01', has_authored_content: true, unlocked: true }] }, loading: false, error: null, refresh: jest.fn(), ...overrides }
}

function contentResult(overrides: Record<string, unknown> = {}) {
  return { content: { modulePurpose: 'Orient the student.' }, quiz: [], contentVersion: '2026-01-01T00:00:00Z', loading: false, error: null, refetch: jest.fn(), ...overrides }
}

function guidedNotesResult(overrides: Record<string, unknown> = {}) {
  return {
    existingByPrompt: {},
    loading: false,
    loadError: null,
    retryLoad: jest.fn(),
    saveNow: jest.fn(),
    saveDebounced: jest.fn(),
    savingPrompts: {},
    saveErrors: {},
    ...overrides,
  }
}

function moduleQuizResult(overrides: Record<string, unknown> = {}) {
  return {
    answers: {},
    setAnswer: jest.fn(),
    submitted: false,
    results: {},
    score: 0,
    total: 0,
    submitting: false,
    submitError: null,
    submit: jest.fn(),
    ...overrides,
  }
}

describe('ModuleDetailScreen', () => {
  beforeEach(() => {
    mockUseBootstrapContext.mockReset().mockReturnValue(bootstrapContext())
    mockUseGroundSchoolCatalog.mockReset().mockReturnValue(catalogResult())
    mockUseGroundSchoolContent.mockReset().mockReturnValue(contentResult())
    mockUseGuidedNotes.mockReset().mockReturnValue(guidedNotesResult())
    mockUseModuleQuiz.mockReset().mockReturnValue(moduleQuizResult())
    mockUseIsOnline.mockReset().mockReturnValue(true)
    mockUseOfflineContentCache.mockReset().mockReturnValue(offlineCacheFixture())
  })

  it('shows a loading state while the catalog resolves', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(catalogResult({ loading: true, data: null }))

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('Loading module…')).toBeTruthy()
  })

  it('shows "Module not found" when the catalog has no matching module id', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(catalogResult({ data: { modules: [] } }))

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('Module not found')).toBeTruthy()
    expect(mockUseGroundSchoolContent).toHaveBeenCalledWith({ moduleId: 'PPL-M01', enabled: false })
  })

  it('shows a locked message and never fetches content when the module is not unlocked', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(
      catalogResult({ data: { modules: [{ module_id: 'PPL-M01', has_authored_content: true, unlocked: false }] } })
    )

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('This Ground School module isn’t currently available on this account.')).toBeTruthy()
    expect(mockUseGroundSchoolContent).toHaveBeenCalledWith({ moduleId: 'PPL-M01', enabled: false })
  })

  it('shows a loading state while content/guided notes resolve', async () => {
    mockUseGroundSchoolContent.mockReturnValue(contentResult({ loading: true, content: null }))

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('Loading module…')).toBeTruthy()
  })

  it('shows a retryable error when content fails to load', async () => {
    mockUseGroundSchoolContent.mockReturnValue(contentResult({ error: { userMessage: 'We couldn’t load this module.' }, content: null }))

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('We couldn’t load this module.')).toBeTruthy()
  })

  it('renders the module label and its companion content once everything resolves', async () => {
    await render(<ModuleDetailScreen />)

    expect(screen.getByText('Module 01 · Becoming a Pilot')).toBeTruthy()
    expect(screen.getByText('Orient the student.')).toBeTruthy()
  })

  it('renders an honest "not yet published" message when content is null but the module is unlocked', async () => {
    mockUseGroundSchoolContent.mockReturnValue(contentResult({ content: null }))

    await render(<ModuleDetailScreen />)

    expect(screen.getByText('This module’s workbook content isn’t published yet. Check back soon.')).toBeTruthy()
  })
})
