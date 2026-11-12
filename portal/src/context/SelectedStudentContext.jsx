import { createContext, useContext, useEffect, useState } from 'react'

const SelectedStudentContext = createContext(null)

const STORAGE_KEY = 'apex_ops_selected_student_id'

// A day-to-day ops task is almost always "look at one student across
// several tools" -- pull their Training Records, check Syllabi progress,
// confirm an Endorsement, pull up Billing -- not one tool at a time. Before
// this, every page that offered a student picker (Training Records,
// Syllabi, Logbook, Endorsements, Billing, Documents) kept its own local
// `studentId` state, so switching tabs silently dropped whoever you were
// looking at and made you re-pick them on every page. This context is
// shared app-wide (provided once in App.jsx, inside AuthProvider) so
// picking a student anywhere keeps them selected everywhere else, and
// persists to sessionStorage so an accidental refresh mid-task doesn't
// lose it either.
export function SelectedStudentProvider({ children }) {
  const [selectedStudentId, setSelectedStudentIdState] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' }
  })

  useEffect(() => {
    try {
      if (selectedStudentId) sessionStorage.setItem(STORAGE_KEY, selectedStudentId)
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch { /* storage unavailable (private mode, etc.) -- state still works for this tab */ }
  }, [selectedStudentId])

  function setSelectedStudentId(id) { setSelectedStudentIdState(id ?? '') }

  return (
    <SelectedStudentContext.Provider value={{ selectedStudentId, setSelectedStudentId }}>
      {children}
    </SelectedStudentContext.Provider>
  )
}

export function useSelectedStudent() {
  const ctx = useContext(SelectedStudentContext)
  if (!ctx) throw new Error('useSelectedStudent must be used within a SelectedStudentProvider')
  return ctx
}
