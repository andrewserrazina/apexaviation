// Pure helpers for the Mock Oral Availability Manager
// (pages/MockOralAvailability.jsx). Kept dependency-free (no supabase, no
// React) so the actual scheduling/validation logic is unit-testable
// without mocking the network -- see mockOralAvailability.test.js.

// Mirrors profiles.mock_oral_certificate_types' documented domain
// (supabase-portal-schema-v97.sql): "Subset of {private_pilot,
// instrument, commercial, cfi} ... only private_pilot is exposed
// publicly today." All four are offered here so an instructor's
// eligibility can be recorded ahead of the other certificate types going
// live, matching how mock_oral_products already has an inactive future
// product (pp_checkride_ready) sitting alongside the active ones.
export const CERTIFICATE_TYPES = [
  { value: 'private_pilot', label: 'Private Pilot' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'cfi', label: 'CFI' },
]

// Same set already used by MockOralDashboard.jsx and
// AdminGroundSchoolSchedule.jsx -- kept identical rather than
// centralized, since neither of those files imports shared constants
// today and this feature isn't the place to start that refactor.
export const TZ_OPTIONS = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles']

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS = WEEKDAY_LABELS.map((label, value) => ({ value, label }))

function timeToMinutes(time) {
  const [h, m] = (time || '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// today defaults to a real Date but takes an override so tests are not
// wall-clock-dependent.
export function isPastDate(dateStr, today = new Date()) {
  if (!dateStr) return false
  const todayStr = today.toISOString().slice(0, 10)
  return dateStr < todayStr
}

export function slotsOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd)
}

// existingSlots: rows already loaded for the instructor in question
// (any status -- open, booked, or blocked all represent real time the
// instructor is unavailable for a second slot). Returns the subset that
// overlaps the candidate on the same date, excluding the slot being
// edited (excludeId) so re-saving a slot unchanged never flags itself.
export function findConflicts(candidate, existingSlots, excludeId = null) {
  return (existingSlots || []).filter(slot => (
    slot.id !== excludeId &&
    slot.instructor_id === candidate.instructor_id &&
    slot.class_date === candidate.class_date &&
    slotsOverlap(candidate.start_time, candidate.end_time, slot.start_time, slot.end_time)
  ))
}

// Mirrors AdminGroundSchoolSchedule.jsx's validateClass(): returns an
// array of error strings, empty when the form is valid. `instructor` is
// the full profile row (or undefined/null if none selected yet) so
// eligibility/certificate-type checks use the same data the picker was
// built from, not a second fetch.
export function validateSingleSlotForm(form, instructor, today = new Date()) {
  const errors = []
  if (!form.instructor_id) errors.push('Instructor is required.')
  if (!form.certificate_type) errors.push('Certificate type is required.')
  if (!form.class_date) errors.push('Date is required.')
  if (!form.start_time) errors.push('Start time is required.')
  if (!form.end_time) errors.push('End time is required.')
  if (!form.timezone) errors.push('Time zone is required.')
  if (form.class_date && isPastDate(form.class_date, today)) errors.push('Date cannot be in the past.')
  if (form.start_time && form.end_time && timeToMinutes(form.end_time) <= timeToMinutes(form.start_time)) {
    errors.push('End time must be after start time.')
  }
  if (form.instructor_id && instructor && !instructor.mock_oral_instructor) {
    errors.push('Selected profile is not a Mock Oral instructor.')
  }
  if (form.certificate_type && instructor && !(instructor.mock_oral_certificate_types || []).includes(form.certificate_type)) {
    errors.push('Selected instructor is not eligible for this certificate type.')
  }
  return errors
}

// Bulk/recurring preview -- generates the list of ISO class_date strings
// between startDate and endDate (inclusive) whose weekday (0=Sun..6=Sat)
// is in `weekdays`. Deliberately just date generation, not a recurrence
// *engine*: the caller pairs each date with the same instructor/
// certificate/time/timezone/buffer to build plain mock_oral_availability
// rows, then inserts them with one batched .insert([...]) call -- no new
// table or server-side recurrence concept.
export function generateRecurringDates({ startDate, endDate, weekdays }) {
  if (!startDate || !endDate || !weekdays || weekdays.length === 0) return []
  const dates = []
  // Parsed as UTC-midnight on purpose: only the calendar date and its
  // weekday matter here, never a time-of-day, so there is nothing for a
  // local-timezone shift to get wrong.
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
