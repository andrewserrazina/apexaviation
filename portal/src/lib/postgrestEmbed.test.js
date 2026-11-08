import { describe, it, expect } from 'vitest'
import { toOne } from './postgrestEmbed'

// Mock Oral bookings show intake answers logged in Supabase as
// permanently "not started" in the portal -- the embed came back as a
// plain object (the correct shape for a to-one relationship, since
// mock_oral_intakes.booking_id is unique), and indexing it with [0]
// silently produced undefined instead of the real row.
describe('toOne()', () => {
  it('passes through a to-one embed already shaped as a plain object', () => {
    expect(toOne({ aircraft_make: 'Cessna', avionics_type: 'g1000' }))
      .toEqual({ aircraft_make: 'Cessna', avionics_type: 'g1000' })
  })

  it('unwraps a to-one embed PostgREST returns as a single-element array', () => {
    expect(toOne([{ aircraft_make: 'Cessna' }])).toEqual({ aircraft_make: 'Cessna' })
  })

  it('returns null for an empty array (no related row)', () => {
    expect(toOne([])).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(toOne(null)).toBeNull()
    expect(toOne(undefined)).toBeNull()
  })
})
