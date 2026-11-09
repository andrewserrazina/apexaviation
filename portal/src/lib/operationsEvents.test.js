import { describe, it, expect, vi } from 'vitest'

// Only the pure normalizers below are under test; mocked so importing
// this module doesn't require real Supabase env vars (same pattern as
// AuthContext.test.jsx).
vi.mock('./supabase', () => ({ supabase: {} }))

import {
  normalizeLesson, normalizeGroundClass, normalizeGroundSession,
  normalizePrivateInstruction, normalizeMockOral, EVENT_TYPES,
} from './operationsEvents'

describe('normalizeLesson()', () => {
  it('combines student and instructor names, falling back to the lesson type', () => {
    const event = normalizeLesson({
      id: '1', starts_at: '2026-11-10T14:00:00Z', lesson_type: 'Stage Check',
      student: { full_name: 'Jamie Lee' }, instructor: { full_name: 'Pat Rivera' },
    })
    expect(event).toMatchObject({ type: EVENT_TYPES.LESSON, title: 'Stage Check', sub: 'Jamie Lee · Pat Rivera' })
  })

  it('falls back to "Flight Lesson" and "Unassigned" when fields are missing', () => {
    const event = normalizeLesson({ id: '1', starts_at: '2026-11-10T14:00:00Z', lesson_type: null, student: null, instructor: null })
    expect(event.title).toBe('Flight Lesson')
    expect(event.sub).toBe('Unassigned')
  })

  it('unwraps a to-one embed PostgREST returns as a single-element array', () => {
    const event = normalizeLesson({ id: '1', starts_at: '2026-11-10T14:00:00Z', lesson_type: 'Solo', student: [{ full_name: 'Jamie Lee' }], instructor: [] })
    expect(event.sub).toBe('Jamie Lee')
  })
})

describe('normalizeGroundClass()', () => {
  it('combines class_date and start_time into one Date', () => {
    const event = normalizeGroundClass({ id: '1', title: 'PPL Ground 3', class_date: '2026-11-12', start_time: '18:00:00', status: 'published', instructor_name: 'Pat Rivera' })
    expect(event.date.toISOString()).toBe(new Date('2026-11-12T18:00:00').toISOString())
    expect(event.type).toBe(EVENT_TYPES.GROUND_CLASS)
  })
})

describe('normalizeGroundSession()', () => {
  it('maps the legacy ground_sessions shape', () => {
    const event = normalizeGroundSession({ id: '1', title: 'Weather Theory', scheduled_at: '2026-11-11T19:00:00Z', location: 'Hangar B' })
    expect(event).toMatchObject({ type: EVENT_TYPES.GROUND_SESSION, title: 'Weather Theory', sub: 'Hangar B' })
  })
})

describe('normalizePrivateInstruction()', () => {
  it('reads its date off the joined availability row', () => {
    const event = normalizePrivateInstruction({
      id: '1', full_name: 'Jamie Lee', status: 'confirmed',
      availability: { class_date: '2026-11-13', start_time: '09:00:00' },
      instructor: { full_name: 'Pat Rivera' },
    })
    expect(event.date.toISOString()).toBe(new Date('2026-11-13T09:00:00').toISOString())
    expect(event.sub).toBe('Jamie Lee · Pat Rivera')
  })

  it('returns null when the availability row is missing (orphaned booking)', () => {
    expect(normalizePrivateInstruction({ id: '1', full_name: 'Jamie Lee', availability: null, instructor: null })).toBeNull()
  })
})

describe('normalizeMockOral()', () => {
  it('reads its date off the joined availability row', () => {
    const event = normalizeMockOral({
      id: '1', full_name: 'Jamie Lee', status: 'confirmed',
      availability: { class_date: '2026-11-14', start_time: '13:00:00' },
      instructor: { full_name: 'Pat Rivera' },
    })
    expect(event.date.toISOString()).toBe(new Date('2026-11-14T13:00:00').toISOString())
    expect(event.type).toBe(EVENT_TYPES.MOCK_ORAL)
  })

  it('returns null when the availability row is missing (orphaned booking)', () => {
    expect(normalizeMockOral({ id: '1', full_name: 'Jamie Lee', availability: null, instructor: null })).toBeNull()
  })
})
