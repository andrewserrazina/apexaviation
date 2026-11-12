import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SelectedStudentProvider, useSelectedStudent } from './SelectedStudentContext'

const STORAGE_KEY = 'apex_ops_selected_student_id'

function TestConsumer() {
  const { selectedStudentId, setSelectedStudentId } = useSelectedStudent()
  return (
    <div>
      <div data-testid="value">{selectedStudentId}</div>
      <button onClick={() => setSelectedStudentId('student-123')}>pick</button>
      <button onClick={() => setSelectedStudentId('')}>clear</button>
    </div>
  )
}

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('SelectedStudentContext', () => {
  it('starts empty with nothing in sessionStorage', () => {
    render(<SelectedStudentProvider><TestConsumer /></SelectedStudentProvider>)
    expect(screen.getByTestId('value').textContent).toBe('')
  })

  it('shares the selected student across every consumer under one provider', () => {
    render(
      <SelectedStudentProvider>
        <TestConsumer />
        <TestConsumer />
      </SelectedStudentProvider>
    )
    const [valueA, valueB] = screen.getAllByTestId('value')
    const [pickA] = screen.getAllByText('pick')

    fireEvent.click(pickA)

    expect(valueA.textContent).toBe('student-123')
    expect(valueB.textContent).toBe('student-123')
  })

  it('persists the selection to sessionStorage and restores it on remount', () => {
    const { unmount } = render(<SelectedStudentProvider><TestConsumer /></SelectedStudentProvider>)
    fireEvent.click(screen.getByText('pick'))
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('student-123')
    unmount()

    render(<SelectedStudentProvider><TestConsumer /></SelectedStudentProvider>)
    expect(screen.getByTestId('value').textContent).toBe('student-123')
  })

  it('clears sessionStorage when the selection is cleared', () => {
    render(<SelectedStudentProvider><TestConsumer /></SelectedStudentProvider>)
    fireEvent.click(screen.getByText('pick'))
    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(null)
  })
})
