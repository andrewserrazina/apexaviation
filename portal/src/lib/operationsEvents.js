import { supabase } from './supabase'
import { toOne } from './postgrestEmbed'

// Normalizes the portal's four separate booking schemas (flight lessons,
// ground classes/sessions, private instruction, mock orals) into one
// shape so OperationsCalendar can render them on a single calendar
// without merging the underlying tables -- see the portal overhaul plan
// for why that merge is out of scope for this pass.
export const EVENT_TYPES = {
  LESSON: 'lesson',
  GROUND_CLASS: 'ground_class',
  GROUND_SESSION: 'ground_session',
  PRIVATE_INSTRUCTION: 'private_instruction',
  MOCK_ORAL: 'mock_oral',
}

export const EVENT_TYPE_LABELS = {
  [EVENT_TYPES.LESSON]: 'Flight Lesson',
  [EVENT_TYPES.GROUND_CLASS]: 'Ground Class',
  [EVENT_TYPES.GROUND_SESSION]: 'Ground Class',
  [EVENT_TYPES.PRIVATE_INSTRUCTION]: 'Private Instruction',
  [EVENT_TYPES.MOCK_ORAL]: 'Mock Oral',
}

// Visual tone per type -- '' keeps the calendar's default gold chip
// (flight lessons, the portal's primary product); the others get a
// cal-event--<tone> modifier so the four layers read as distinct colors
// on one calendar. Shared between the month/week chips and the day
// agenda list so both agree on which type is which color.
export const EVENT_TYPE_TONES = {
  [EVENT_TYPES.LESSON]: '',
  [EVENT_TYPES.GROUND_CLASS]: 'info',
  [EVENT_TYPES.GROUND_SESSION]: 'info',
  [EVENT_TYPES.PRIVATE_INSTRUCTION]: 'success',
  [EVENT_TYPES.MOCK_ORAL]: 'danger',
}

// Destination each event type's chip links to -- the specialized page
// that already owns real create/edit/cancel logic for that booking kind.
export const EVENT_TYPE_LINKS = {
  [EVENT_TYPES.LESSON]: '/schedule',
  [EVENT_TYPES.GROUND_CLASS]: '/admin/ground-school-schedule',
  [EVENT_TYPES.GROUND_SESSION]: '/ground-schedule',
  [EVENT_TYPES.PRIVATE_INSTRUCTION]: '/private-instruction',
  [EVENT_TYPES.MOCK_ORAL]: '/mock-orals',
}

function combineDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr ?? '00:00:00'}`)
}

export function normalizeLesson(row) {
  const student = toOne(row.student)
  const instructor = toOne(row.instructor)
  return {
    id: `lesson:${row.id}`,
    type: EVENT_TYPES.LESSON,
    date: new Date(row.starts_at),
    title: row.lesson_type || 'Flight Lesson',
    sub: [student?.full_name, instructor?.full_name].filter(Boolean).join(' · ') || 'Unassigned',
    status: 'scheduled',
    link: EVENT_TYPE_LINKS[EVENT_TYPES.LESSON],
  }
}

export function normalizeGroundClass(row) {
  return {
    id: `ground_class:${row.id}`,
    type: EVENT_TYPES.GROUND_CLASS,
    date: combineDateTime(row.class_date, row.start_time),
    title: row.title,
    sub: row.instructor_name || 'Unassigned',
    status: row.status,
    link: EVENT_TYPE_LINKS[EVENT_TYPES.GROUND_CLASS],
  }
}

export function normalizeGroundSession(row) {
  return {
    id: `ground_session:${row.id}`,
    type: EVENT_TYPES.GROUND_SESSION,
    date: new Date(row.scheduled_at),
    title: row.title,
    sub: row.location || 'Ground School',
    status: 'scheduled',
    link: EVENT_TYPE_LINKS[EVENT_TYPES.GROUND_SESSION],
  }
}

export function normalizePrivateInstruction(row) {
  const availability = toOne(row.availability)
  const instructor = toOne(row.instructor)
  if (!availability) return null
  return {
    id: `private_instruction:${row.id}`,
    type: EVENT_TYPES.PRIVATE_INSTRUCTION,
    date: combineDateTime(availability.class_date, availability.start_time),
    title: 'Private Instruction',
    sub: [row.full_name, instructor?.full_name].filter(Boolean).join(' · '),
    status: row.status,
    link: EVENT_TYPE_LINKS[EVENT_TYPES.PRIVATE_INSTRUCTION],
  }
}

export function normalizeMockOral(row) {
  const availability = toOne(row.availability)
  const instructor = toOne(row.instructor)
  if (!availability) return null
  return {
    id: `mock_oral:${row.id}`,
    type: EVENT_TYPES.MOCK_ORAL,
    date: combineDateTime(availability.class_date, availability.start_time),
    title: 'Mock Oral',
    sub: [row.full_name, instructor?.full_name].filter(Boolean).join(' · '),
    status: row.status,
    link: EVENT_TYPE_LINKS[EVENT_TYPES.MOCK_ORAL],
  }
}

// Fetches and normalizes every event type in [from, to) in parallel.
// `types` restricts which sources are queried, matching the calendar's
// layer-filter checkboxes so turning a layer off also skips its fetch.
export async function fetchOperationsEvents({ from, to, types }) {
  const want = new Set(types ?? Object.values(EVENT_TYPES))
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const fromDate = from.toISOString().slice(0, 10)
  const toDate = to.toISOString().slice(0, 10)

  const [lessons, groundClasses, groundSessions, privateInstruction, mockOrals] = await Promise.all([
    want.has(EVENT_TYPES.LESSON)
      ? supabase.from('lessons')
          .select('id, starts_at, lesson_type, student:profiles!student_id(full_name), instructor:profiles!instructor_id(full_name)')
          .gte('starts_at', fromIso).lt('starts_at', toIso)
      : Promise.resolve({ data: [] }),
    want.has(EVENT_TYPES.GROUND_CLASS)
      ? supabase.from('scheduled_ground_classes')
          .select('id, title, class_date, start_time, status, instructor_name')
          .gte('class_date', fromDate).lt('class_date', toDate).neq('status', 'canceled')
      : Promise.resolve({ data: [] }),
    want.has(EVENT_TYPES.GROUND_SESSION)
      ? supabase.from('ground_sessions')
          .select('id, title, scheduled_at, location')
          .gte('scheduled_at', fromIso).lt('scheduled_at', toIso)
      : Promise.resolve({ data: [] }),
    want.has(EVENT_TYPES.PRIVATE_INSTRUCTION)
      ? supabase.from('private_instruction_bookings')
          .select('id, full_name, status, availability:private_instruction_availability(class_date, start_time), instructor:profiles!instructor_id(full_name)')
          .is('canceled_at', null)
      : Promise.resolve({ data: [] }),
    want.has(EVENT_TYPES.MOCK_ORAL)
      ? supabase.from('mock_oral_bookings')
          .select('id, full_name, status, availability:mock_oral_availability(class_date, start_time), instructor:profiles!instructor_id(full_name)')
          .is('canceled_at', null)
      : Promise.resolve({ data: [] }),
  ])

  const events = [
    ...(lessons.data ?? []).map(normalizeLesson),
    ...(groundClasses.data ?? []).map(normalizeGroundClass),
    ...(groundSessions.data ?? []).map(normalizeGroundSession),
    ...(privateInstruction.data ?? []).map(normalizePrivateInstruction),
    ...(mockOrals.data ?? []).map(normalizeMockOral),
  ].filter(Boolean)

  // Private instruction/mock orals have no server-side date-range filter
  // (their date lives on the joined availability row, not a column
  // PostgREST can filter by) -- applied client-side instead.
  return events.filter(e => e.date >= from && e.date < to)
}
