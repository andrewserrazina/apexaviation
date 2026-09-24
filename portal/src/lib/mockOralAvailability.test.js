import { describe, it, expect } from 'vitest'
import { isPastDate, slotsOverlap, findConflicts, validateSingleSlotForm, generateRecurringDates } from './mockOralAvailability'

const TODAY = new Date('2026-09-24T12:00:00Z')

describe('isPastDate', () => {
  it('flags a date before today', () => {
    expect(isPastDate('2026-09-23', TODAY)).toBe(true)
  })
  it('does not flag today itself', () => {
    expect(isPastDate('2026-09-24', TODAY)).toBe(false)
  })
  it('does not flag a future date', () => {
    expect(isPastDate('2026-09-25', TODAY)).toBe(false)
  })
})

describe('slotsOverlap', () => {
  it('detects a real overlap', () => {
    expect(slotsOverlap('18:00', '20:00', '19:00', '21:00')).toBe(true)
  })
  it('treats back-to-back slots as non-overlapping', () => {
    expect(slotsOverlap('18:00', '20:00', '20:00', '22:00')).toBe(false)
  })
  it('detects one slot fully containing another', () => {
    expect(slotsOverlap('18:00', '22:00', '19:00', '20:00')).toBe(true)
  })
  it('returns false for clearly separate slots', () => {
    expect(slotsOverlap('09:00', '10:00', '18:00', '20:00')).toBe(false)
  })
})

describe('findConflicts', () => {
  const existing = [
    { id: 'a', instructor_id: 'inst-1', class_date: '2026-10-01', start_time: '18:00', end_time: '20:00' },
    { id: 'b', instructor_id: 'inst-1', class_date: '2026-10-02', start_time: '18:00', end_time: '20:00' },
    { id: 'c', instructor_id: 'inst-2', class_date: '2026-10-01', start_time: '18:00', end_time: '20:00' },
  ]

  it('finds an overlapping slot for the same instructor and date', () => {
    const conflicts = findConflicts({ instructor_id: 'inst-1', class_date: '2026-10-01', start_time: '19:00', end_time: '21:00' }, existing)
    expect(conflicts.map(c => c.id)).toEqual(['a'])
  })

  it('ignores a different instructor on the same date/time', () => {
    const conflicts = findConflicts({ instructor_id: 'inst-1', class_date: '2026-10-05', start_time: '18:00', end_time: '20:00' }, existing)
    expect(conflicts).toEqual([])
  })

  it('excludes the slot being edited so re-saving it unchanged never self-conflicts', () => {
    const conflicts = findConflicts({ instructor_id: 'inst-1', class_date: '2026-10-01', start_time: '18:00', end_time: '20:00' }, existing, 'a')
    expect(conflicts).toEqual([])
  })
})

describe('validateSingleSlotForm', () => {
  const eligibleInstructor = { mock_oral_instructor: true, mock_oral_certificate_types: ['private_pilot'] }
  const validForm = {
    instructor_id: 'inst-1',
    certificate_type: 'private_pilot',
    class_date: '2026-10-01',
    start_time: '18:00',
    end_time: '20:00',
    timezone: 'America/Chicago',
  }

  it('accepts a fully valid form', () => {
    expect(validateSingleSlotForm(validForm, eligibleInstructor, TODAY)).toEqual([])
  })

  it('requires every field', () => {
    const errors = validateSingleSlotForm({ ...validForm, class_date: '' }, eligibleInstructor, TODAY)
    expect(errors).toContain('Date is required.')
  })

  it('rejects end time not after start time', () => {
    const errors = validateSingleSlotForm({ ...validForm, end_time: '18:00' }, eligibleInstructor, TODAY)
    expect(errors).toContain('End time must be after start time.')
  })

  it('rejects a past date', () => {
    const errors = validateSingleSlotForm({ ...validForm, class_date: '2026-01-01' }, eligibleInstructor, TODAY)
    expect(errors).toContain('Date cannot be in the past.')
  })

  it('rejects an instructor who is not Mock Oral eligible', () => {
    const errors = validateSingleSlotForm(validForm, { mock_oral_instructor: false, mock_oral_certificate_types: [] }, TODAY)
    expect(errors).toContain('Selected profile is not a Mock Oral instructor.')
  })

  it('rejects a certificate type the instructor is not approved for', () => {
    const errors = validateSingleSlotForm(
      { ...validForm, certificate_type: 'instrument' },
      { mock_oral_instructor: true, mock_oral_certificate_types: ['private_pilot'] },
      TODAY,
    )
    expect(errors).toContain('Selected instructor is not eligible for this certificate type.')
  })
})

describe('generateRecurringDates', () => {
  it('generates every Mon/Wed/Fri across a 2-week range', () => {
    // 2026-09-28 is a Monday.
    const dates = generateRecurringDates({ startDate: '2026-09-28', endDate: '2026-10-11', weekdays: [1, 3, 5] })
    expect(dates).toEqual([
      '2026-09-28', '2026-09-30', '2026-10-02',
      '2026-10-05', '2026-10-07', '2026-10-09',
    ])
  })

  it('includes both endpoints when they match a selected weekday', () => {
    const dates = generateRecurringDates({ startDate: '2026-09-28', endDate: '2026-09-28', weekdays: [1] })
    expect(dates).toEqual(['2026-09-28'])
  })

  it('returns an empty list when no weekday is selected', () => {
    expect(generateRecurringDates({ startDate: '2026-09-28', endDate: '2026-10-11', weekdays: [] })).toEqual([])
  })

  it('returns an empty list when the range is backwards', () => {
    expect(generateRecurringDates({ startDate: '2026-10-11', endDate: '2026-09-28', weekdays: [1] })).toEqual([])
  })
})
