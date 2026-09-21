// Phase 3 (Ground School mobile): the catalog screen -- browsable
// without checkride_prep (entitlement is per-module), every one of the
// 20 curriculum modules is listed with its own locked/unlocked +
// has_authored_content state. Mirrors test/LibraryCatalog.test.tsx's
// shape.
import { render, screen, fireEvent } from '@testing-library/react-native'
import GroundSchoolTabScreen from '../app/(app)/ground-school/index'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}))

const mockUseBootstrapContext = jest.fn()
jest.mock('../contexts/BootstrapContext', () => ({
  useBootstrapContext: () => mockUseBootstrapContext(),
}))

const mockUseGroundSchoolCatalog = jest.fn()
jest.mock('../hooks/useGroundSchoolCatalog', () => ({
  useGroundSchoolCatalog: (...args: unknown[]) => mockUseGroundSchoolCatalog(...args),
}))

function bootstrapContext(overrides: Record<string, unknown> = {}) {
  return { loading: false, ready: true, ...overrides }
}

function catalogResult(overrides: Record<string, unknown> = {}) {
  return { data: null, loading: false, refreshing: false, error: null, refresh: jest.fn(), ...overrides }
}

describe('GroundSchoolTabScreen', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockUseBootstrapContext.mockReset().mockReturnValue(bootstrapContext())
    mockUseGroundSchoolCatalog.mockReset().mockReturnValue(catalogResult())
  })

  it('shows a loading state while bootstrap/catalog resolve', async () => {
    mockUseBootstrapContext.mockReturnValue(bootstrapContext({ ready: false, loading: true }))

    await render(<GroundSchoolTabScreen />)

    expect(screen.getByText('Loading Ground School…')).toBeTruthy()
  })

  it('shows a retryable error on catalog failure', async () => {
    const refresh = jest.fn()
    mockUseGroundSchoolCatalog.mockReturnValue(catalogResult({ error: { userMessage: 'Check your connection and try again.' }, refresh }))

    await render(<GroundSchoolTabScreen />)

    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renders every module the server returns, with its label from the local constants map', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(
      catalogResult({
        data: {
          modules: [
            { module_id: 'PPL-M01', has_authored_content: true, unlocked: true },
            { module_id: 'PPL-M05', has_authored_content: false, unlocked: false },
          ],
        },
      })
    )

    await render(<GroundSchoolTabScreen />)

    expect(screen.getByText('Module 01 · Becoming a Pilot')).toBeTruthy()
    expect(screen.getByText('Module 05 · Airspace Mastery')).toBeTruthy()
    expect(screen.getAllByText('UNLOCKED')).toHaveLength(1)
    expect(screen.getAllByText('LOCKED')).toHaveLength(1)
  })

  it('shows "Workbook content coming soon" for an unlocked module with no authored content, and disables Open', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(
      catalogResult({ data: { modules: [{ module_id: 'PPL-M18', has_authored_content: false, unlocked: true }] } })
    )

    await render(<GroundSchoolTabScreen />)

    expect(screen.getByText('Workbook content coming soon.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View Details' }).props.accessibilityState.disabled).toBe(true)
  })

  it('pressing Open on an unlocked, authored module navigates to its detail screen', async () => {
    mockUseGroundSchoolCatalog.mockReturnValue(
      catalogResult({ data: { modules: [{ module_id: 'PPL-M01', has_authored_content: true, unlocked: true }] } })
    )

    await render(<GroundSchoolTabScreen />)
    fireEvent.press(screen.getByRole('button', { name: 'Open' }))

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/ground-school/[moduleId]', params: { moduleId: 'PPL-M01' } })
  })
})
