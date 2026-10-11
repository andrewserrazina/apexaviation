// Mobile parity (Phase 5, item 6): render-level coverage for
// CheckrideCountdownCard. Day-math/validation itself is covered directly
// and reliably in test/checkrideCountdown.test.ts -- this file only
// covers what's reliably testable without simulating typing (this
// project's jest-expo/@testing-library/react-native setup does not
// commit state updates from a controlled TextInput's fireEvent.changeText,
// see test/SignUpScreen.test.tsx's own comment on this environment
// limitation): initial render per state, and that Save works using the
// fields' own useState *initial* values (populated from props, not from
// simulated typing) when editing an already-set date.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { CheckrideCountdownCard } from '../components/CheckrideCountdownCard'

const mockUpsertCheckrideDate = jest.fn()
jest.mock('../lib/api/checkrideDateDirect', () => ({
  upsertCheckrideDate: (...args: unknown[]) => mockUpsertCheckrideDate(...args),
}))

function isoDateDaysFromNow(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('CheckrideCountdownCard', () => {
  beforeEach(() => {
    mockUpsertCheckrideDate.mockReset()
    mockUpsertCheckrideDate.mockResolvedValue(undefined)
  })

  it('shows the date-entry editor when no checkride date is set yet', async () => {
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={null} onSaved={jest.fn()} />)

    expect(screen.getByText('Add your expected checkride date to see a live countdown.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save Date' })).toBeTruthy()
    // No Cancel button when there's nothing to fall back to yet.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows "N Days Until Checkride" for a future date', async () => {
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={isoDateDaysFromNow(14)} onSaved={jest.fn()} />)

    expect(screen.getByText('14 Days Until Checkride')).toBeTruthy()
  })

  it('shows "Checkride is today!" when the date is today', async () => {
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={isoDateDaysFromNow(0)} onSaved={jest.fn()} />)

    expect(screen.getByText('Checkride is today!')).toBeTruthy()
  })

  it('shows "Checkride day has passed" for a past date', async () => {
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={isoDateDaysFromNow(-3)} onSaved={jest.fn()} />)

    expect(screen.getByText('Checkride day has passed')).toBeTruthy()
  })

  it('pressing Edit on a set date opens the editor pre-filled, and Cancel returns to the countdown unchanged', async () => {
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={isoDateDaysFromNow(14)} onSaved={jest.fn()} />)

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Edit' }))
    })
    expect(screen.getByRole('button', { name: 'Save Date' })).toBeTruthy()
    // Pre-filled from the existing date, so Save is immediately enabled.
    expect(screen.getByRole('button', { name: 'Save Date' })).not.toBeDisabled()

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(screen.getByText('14 Days Until Checkride')).toBeTruthy()
    expect(mockUpsertCheckrideDate).not.toHaveBeenCalled()
  })

  it('re-saving an already-set date (via the fields\' own pre-filled initial values) calls upsertCheckrideDate and onSaved', async () => {
    const onSaved = jest.fn()
    const date = isoDateDaysFromNow(14)
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={date} onSaved={onSaved} />)

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Edit' }))
    })
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save Date' }))
    })

    await waitFor(() => expect(mockUpsertCheckrideDate).toHaveBeenCalledWith('u1', date))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('shows an error and does not call onSaved when the save fails', async () => {
    mockUpsertCheckrideDate.mockRejectedValue(new Error('Could not save that date. Please try again.'))
    const onSaved = jest.fn()
    const date = isoDateDaysFromNow(14)
    await render(<CheckrideCountdownCard profileId="u1" checkrideDate={date} onSaved={onSaved} />)

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Edit' }))
    })
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save Date' }))
    })

    await waitFor(() => expect(screen.getByText('Could not save that date. Please try again.')).toBeTruthy())
    expect(onSaved).not.toHaveBeenCalled()
  })
})
