// Apex Advantage Private Instruction ($55/hour, flat rate, every
// certificate level) -- replaces the discontinued $25/class group
// Ground School. Covers: the pure scheduling/validation helpers (real
// imports -- these are plain ES modules, not a Deno Edge Function, so
// no extraction/AsyncFunction trick needed), structural assertions on
// the new checkout-session/webhook wiring (same "read the real source
// text, assert on its shape" convention this repo uses for its Deno
// Edge Functions elsewhere, since those files carry top-level remote
// imports that can't be imported directly under Node/vitest), and a
// static sweep confirming no stale group-Ground-School language
// survived in the rewritten marketing pages.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  slotsOverlap, findConflicts, validateSingleSlotForm, generateRecurringDates, isPastDate,
} from '../src/lib/privateInstructionAvailability.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CHECKOUT_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/create-checkout-session/index.ts')
const WEBHOOK_PATH = path.join(REPO_ROOT, 'portal/supabase/functions/stripe-webhook/index.ts')
const checkoutSource = readFileSync(CHECKOUT_PATH, 'utf8')
const webhookSource = readFileSync(WEBHOOK_PATH, 'utf8')

describe('privateInstructionAvailability.js: pure helpers', () => {
  describe('isPastDate', () => {
    it('flags a date before today', () => {
      expect(isPastDate('2026-01-01', new Date('2026-06-01'))).toBe(true)
    })
    it('does not flag today or a future date', () => {
      expect(isPastDate('2026-06-01', new Date('2026-06-01'))).toBe(false)
      expect(isPastDate('2026-12-01', new Date('2026-06-01'))).toBe(false)
    })
    it('treats a missing date as not past', () => {
      expect(isPastDate('', new Date('2026-06-01'))).toBe(false)
    })
  })

  describe('slotsOverlap', () => {
    it('detects a real overlap', () => {
      expect(slotsOverlap('18:00', '19:00', '18:30', '19:30')).toBe(true)
    })
    it('treats back-to-back slots as non-overlapping', () => {
      expect(slotsOverlap('18:00', '19:00', '19:00', '20:00')).toBe(false)
    })
    it('treats fully disjoint slots as non-overlapping', () => {
      expect(slotsOverlap('09:00', '10:00', '18:00', '19:00')).toBe(false)
    })
  })

  describe('findConflicts', () => {
    const existing = [
      { id: 'a', instructor_id: 'andrew', class_date: '2026-06-01', start_time: '18:00', end_time: '19:00' },
      { id: 'b', instructor_id: 'andrew', class_date: '2026-06-01', start_time: '20:00', end_time: '21:00' },
      { id: 'c', instructor_id: 'other-instructor', class_date: '2026-06-01', start_time: '18:30', end_time: '19:30' },
    ]
    it('finds an overlapping slot for the same instructor and date', () => {
      const candidate = { instructor_id: 'andrew', class_date: '2026-06-01', start_time: '18:30', end_time: '19:30' }
      const conflicts = findConflicts(candidate, existing)
      expect(conflicts.map(c => c.id)).toEqual(['a'])
    })
    it('ignores a different instructor even at the same overlapping time', () => {
      const candidate = { instructor_id: 'andrew', class_date: '2026-06-01', start_time: '18:30', end_time: '19:30' }
      const conflicts = findConflicts(candidate, existing)
      expect(conflicts.some(c => c.id === 'c')).toBe(false)
    })
    it('excludes the slot being edited via excludeId', () => {
      const candidate = { instructor_id: 'andrew', class_date: '2026-06-01', start_time: '18:00', end_time: '19:00' }
      expect(findConflicts(candidate, existing, 'a')).toEqual([])
    })
    it('finds no conflicts on a different date', () => {
      const candidate = { instructor_id: 'andrew', class_date: '2026-06-02', start_time: '18:00', end_time: '19:00' }
      expect(findConflicts(candidate, existing)).toEqual([])
    })
  })

  describe('validateSingleSlotForm', () => {
    const today = new Date('2026-06-01')
    const eligibleInstructor = { private_instruction_instructor: true }
    const validForm = { instructor_id: 'andrew', class_date: '2026-06-05', start_time: '18:00', end_time: '19:00', timezone: 'America/Chicago' }

    it('accepts a fully valid form for an eligible instructor', () => {
      expect(validateSingleSlotForm(validForm, eligibleInstructor, today)).toEqual([])
    })
    it('rejects a missing instructor', () => {
      const errors = validateSingleSlotForm({ ...validForm, instructor_id: '' }, null, today)
      expect(errors).toContain('Instructor is required.')
    })
    it('rejects a past date', () => {
      const errors = validateSingleSlotForm({ ...validForm, class_date: '2026-01-01' }, eligibleInstructor, today)
      expect(errors).toContain('Date cannot be in the past.')
    })
    it('rejects an end time at or before the start time', () => {
      const errors = validateSingleSlotForm({ ...validForm, start_time: '19:00', end_time: '19:00' }, eligibleInstructor, today)
      expect(errors).toContain('End time must be after start time.')
    })
    it('rejects an instructor who is not flagged eligible', () => {
      const errors = validateSingleSlotForm(validForm, { private_instruction_instructor: false }, today)
      expect(errors).toContain('Selected profile is not a Private Instruction instructor.')
    })
    it('has no certificate-type check (Private Instruction is not certificate-scoped)', () => {
      // Deliberate contrast with mockOralAvailability.js's validateSingleSlotForm,
      // which does require a certificate_type -- Private Instruction has no
      // such field at all, so there is nothing to validate here.
      expect(validateSingleSlotForm(validForm, eligibleInstructor, today).join(' ')).not.toMatch(/certificate/i)
    })
  })

  describe('generateRecurringDates', () => {
    it('generates only the matching weekdays in range, inclusive', () => {
      // 2026-06-01 is a Monday; Mon(1) and Wed(3) through 2026-06-05 (Friday)
      const dates = generateRecurringDates({ startDate: '2026-06-01', endDate: '2026-06-05', weekdays: [1, 3] })
      expect(dates).toEqual(['2026-06-01', '2026-06-03'])
    })
    it('returns empty for a backwards range', () => {
      expect(generateRecurringDates({ startDate: '2026-06-05', endDate: '2026-06-01', weekdays: [1] })).toEqual([])
    })
    it('returns empty when no weekdays are selected', () => {
      expect(generateRecurringDates({ startDate: '2026-06-01', endDate: '2026-06-05', weekdays: [] })).toEqual([])
    })
  })
})

describe('create-checkout-session: Private Instruction purposes', () => {
  it('defines a single flat rate, not a product catalog', () => {
    expect(checkoutSource).toMatch(/const PRIVATE_INSTRUCTION_RATE_CENTS = 5500/)
  })
  it('handles book-private-instruction for an already-signed-in member', () => {
    expect(checkoutSource).toMatch(/purpose === 'book-private-instruction'/)
  })
  it('handles signup-and-book-private-instruction for a guest', () => {
    expect(checkoutSource).toMatch(/purpose === 'signup-and-book-private-instruction'/)
  })
  it('both purposes require availabilityId, not productId (no catalog to select from)', () => {
    const bookIdx = checkoutSource.indexOf("purpose === 'book-private-instruction'")
    const signupIdx = checkoutSource.indexOf("purpose === 'signup-and-book-private-instruction'")
    expect(bookIdx).toBeGreaterThan(-1)
    expect(signupIdx).toBeGreaterThan(-1)
    const bookBlock = checkoutSource.slice(bookIdx, bookIdx + 1500)
    const signupBlock = checkoutSource.slice(signupIdx, signupIdx + 2500)
    expect(bookBlock).toMatch(/availabilityId/)
    expect(bookBlock).not.toMatch(/productId/)
    expect(signupBlock).toMatch(/availabilityId/)
    expect(signupBlock).not.toMatch(/productId/)
  })
  it('both purposes set metadata.purpose to the same book-private-instruction value', () => {
    // Same pattern as signup-and-book-mock-oral-v2 -- the webhook only
    // ever needs one purpose branch regardless of which checkout path
    // created the session.
    const signupIdx = checkoutSource.indexOf("purpose === 'signup-and-book-private-instruction'")
    const signupBlock = checkoutSource.slice(signupIdx, signupIdx + 6000)
    expect(signupBlock).toMatch(/purpose:\s*'book-private-instruction'/)
  })
})

describe('stripe-webhook: handlePrivateInstructionBooking', () => {
  it('is dispatched from the book-private-instruction purpose', () => {
    expect(webhookSource).toMatch(/purpose === 'book-private-instruction'\)\s*\{\s*\n\s*await handlePrivateInstructionBooking/)
  })
  it('checks for an already-fulfilled session before claiming a slot (idempotency)', () => {
    const fnIdx = webhookSource.indexOf('async function handlePrivateInstructionBooking')
    expect(fnIdx).toBeGreaterThan(-1)
    const claimIdx = webhookSource.indexOf("update({ status: 'booked'", fnIdx)
    const existingCheckIdx = webhookSource.indexOf('existingBooking', fnIdx)
    expect(existingCheckIdx).toBeGreaterThan(-1)
    expect(claimIdx).toBeGreaterThan(existingCheckIdx)
  })
  it('claims the slot with a single conditional update (atomic double-booking guard)', () => {
    const fnIdx = webhookSource.indexOf('async function handlePrivateInstructionBooking')
    const fnBlock = webhookSource.slice(fnIdx, fnIdx + 3000)
    expect(fnBlock).toMatch(/\.from\('private_instruction_availability'\)\s*\n\s*\.update\(\{ status: 'booked'/)
    expect(fnBlock).toMatch(/\.eq\('status', 'open'\)/)
  })
  it('releases the slot back to open if the booking insert fails', () => {
    const fnIdx = webhookSource.indexOf('async function handlePrivateInstructionBooking')
    const fnBlock = webhookSource.slice(fnIdx, fnIdx + 4000)
    expect(fnBlock).toMatch(/private_instruction_availability'\)\.update\(\{ status: 'open'/)
  })
})

describe('Rewritten marketing pages: no stale group Ground School language', () => {
  const SITE_ROOT = path.join(REPO_ROOT, 'site')
  const flagshipPages = ['home.html', 'apex-advantage.html', 'programs.html', 'pricing.html']
  const staleTerms = [/\$25\s*\/?\s*(per\s+)?class/i, /\$400/, /group class/i, /scheduled class/i]

  for (const page of flagshipPages) {
    it(`${page} carries no stale $25/class or $400 group-class pricing`, () => {
      const source = readFileSync(path.join(SITE_ROOT, page), 'utf8')
      for (const term of staleTerms) {
        expect(source).not.toMatch(term)
      }
    })
  }

  it('the new Private Instruction page exists and wires both checkout purposes', () => {
    const source = readFileSync(path.join(SITE_ROOT, 'apex-advantage-private-instruction.html'), 'utf8')
    expect(source).toMatch(/signup-and-book-private-instruction/)
    expect(source).toMatch(/get_private_instruction_availability/)
  })

  it('the old group registration page now redirects instead of accepting new signups', () => {
    const source = readFileSync(path.join(SITE_ROOT, 'apex-advantage-private-pilot.html'), 'utf8')
    expect(source).toMatch(/meta http-equiv="refresh"/)
    expect(source).toMatch(/apex-advantage-private-instruction\.html/)
    // 'ground-school-registration' may still appear inside the explanatory
    // HTML comment documenting *why* this page was converted to a redirect
    // -- strip comments first so this only checks for the purpose string
    // being live/functional again (a regression back to a real form/script).
    const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '')
    expect(withoutComments).not.toMatch(/ground-school-registration/)
  })
})
