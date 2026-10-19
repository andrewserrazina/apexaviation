// Pure helpers for the Private Instruction Availability Manager
// (pages/PrivateInstructionAvailability.jsx). Kept dependency-free (no
// supabase, no React) so the scheduling/validation logic is
// unit-testable without mocking the network -- mirrors
// lib/mockOralAvailability.js exactly, minus certificate_type (Private
// Instruction is a single flat-rate offering, not certificate-scoped).

export const TZ_OPTIONS = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles']

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS = WEEKDAY_LABELS.map((label, value) => ({ value, label }))

function timeToMinutes(time) {
  const [h, m] = (time || '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

export function isPastDate(dateStr, today = new Date()) {
  if (!dateStr) return false
  const todayStr = today.toISOString().slice(0, 10)
  return dateStr < todayStr
}

export function slotsOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd)
}

// existingSlots: rows already loaded for the instructor in question (any
// status represents real time the instructor is unavailable for a
// second slot). Returns the subset that overlaps the candidate on the
// same date, excluding the slot being edited (excludeId).
export function findConflicts(candidate, existingSlots, excludeId = null) {
  return (existingSlots || []).filter(slot => (
    slot.id !== excludeId &&
    slot.instructor_id === candidate.instructor_id &&
    slot.class_date === candidate.class_date &&
    slotsOverlap(candidate.start_time, candidate.end_time, slot.start_time, slot.end_time)
  ))
}

// Mirrors validateSingleSlotForm() in mockOralAvailability.js minus the
// certificate-type checks. `instructor` is the full profile row (or
// undefined/null if none selected yet).
export function validateSingleSlotForm(form, instructor, today = new Date()) {
  const errors = []
  if (!form.instructor_id) errors.push('Instructor is required.')
  if (!form.class_date) errors.push('Date is required.')
  if (!form.start_time) errors.push('Start time is required.')
  if (!form.end_time) errors.push('End time is required.')
  if (!form.timezone) errors.push('Time zone is required.')
  if (form.class_date && isPastDate(form.class_date, today)) errors.push('Date cannot be in the past.')
  if (form.start_time && form.end_time && timeToMinutes(form.end_time) <= timeToMinutes(form.start_time)) {
    errors.push('End time must be after start time.')
  }
  if (form.instructor_id && instructor && !instructor.private_instruction_instructor) {
    errors.push('Selected profile is not a Private Instruction instructor.')
  }
  return errors
}

// Bulk/recurring preview -- generates the list of ISO class_date strings
// between startDate and endDate (inclusive) whose weekday (0=Sun..6=Sat)
// is in `weekdays`. Identical to generateRecurringDates() in
// mockOralAvailability.js.
export function generateRecurringDates({ startDate, endDate, weekdays }) {
  if (!startDate || !endDate || !weekdays || weekdays.length === 0) return []
  const dates = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return []
  while (cursor <= end) {
    if (weekdays.includes(cursor.getUTCDay())) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}
