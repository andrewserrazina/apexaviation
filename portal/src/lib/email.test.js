import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable/thenable query-builder stub matching supabase-js's shape --
// same pattern AuthContext.test.jsx already uses for this codebase's
// supabase mock. Every filter method returns the same object so calls
// can be chained in any order/count. Built as a real Promise (rather
// than a plain object with a hand-written `then`) so the chain itself
// resolves correctly when awaited directly, without tripping the
// no-thenable lint rule. `onInsert` (optional) records whatever row(s)
// .insert() is called with, so a test can assert on exactly what would
// have been written.
function chainable(result, onInsert) {
  const obj = Promise.resolve(result)
  obj.select = () => obj
  obj.eq = () => obj
  obj.in = () => obj
  obj.not = () => obj
  obj.neq = () => obj
  obj.insert = (row) => { onInsert?.(row); return obj }
  obj.single = () => Promise.resolve(result)
  return obj
}

const invokeMock = vi.fn()
let tableResults = {}
let insertedRows = {}

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...args) => invokeMock(...args) },
    from: (table) => chainable(tableResults[table], (row) => { insertedRows[table] = row }),
  },
}))

// Imported after the mock so email.js's own `import { supabase } from
// './supabase'` resolves to the mocked module above.
const { sendAdminEmail } = await import('./email')

const ELIGIBLE_A = { id: 'p1', email: 'a@example.com' }
const ELIGIBLE_B = { id: 'p2', email: 'b@example.com' }

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ error: null })
  insertedRows = {}
  tableResults = {
    profiles: { data: [ELIGIBLE_A], error: null },
    admin_broadcasts: { data: { id: 'broadcast-1' }, error: null },
    admin_broadcast_recipients: { data: null, error: null },
  }
})

describe('sendAdminEmail marketing eligibility', () => {
  it('sends only to profiles the server-side query returns as eligible, even if the caller passed more candidates', async () => {
    // Caller (Simple mode or the Students.jsx per-student action) passes
    // two candidate ids, but the profiles re-query -- the real
    // eligibility source of truth -- only returns one (the other is
    // opted out or missing an email, simulated by the mock only
    // returning ELIGIBLE_A regardless of what candidateIds were).
    const result = await sendAdminEmail({
      recipients: [ELIGIBLE_A, { id: 'opted-out-id', email: 'attacker-supplied@example.com' }],
      subject: 'Test', message: 'Hello', senderId: 'admin-1',
    })

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('send-email', expect.objectContaining({
      body: expect.objectContaining({ to: 'a@example.com' }),
    }))
    expect(result.sent).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('never sends to the email string a caller supplies for an id the eligibility query does not return', async () => {
    // Even though the caller's candidate object carries a fabricated
    // email, only the DB-fetched eligible row's own email is ever used.
    await sendAdminEmail({
      recipients: [{ id: 'p1', email: 'attacker-controlled@example.com' }],
      subject: 'Test', message: 'Hello', senderId: 'admin-1',
    })
    const sentTo = invokeMock.mock.calls.map(c => c[1].body.to)
    expect(sentTo).toEqual(['a@example.com'])
    expect(sentTo).not.toContain('attacker-controlled@example.com')
  })

  it('throws and sends nothing when every candidate is opted out or has no email', async () => {
    tableResults.profiles = { data: [], error: null }
    await expect(sendAdminEmail({
      recipients: [{ id: 'opted-out' }],
      subject: 'Test', message: 'Hello', senderId: 'admin-1',
    })).rejects.toThrow(/opted out|no email/i)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('records recipient_count as the eligible count, not the original candidate count', async () => {
    tableResults.profiles = { data: [ELIGIBLE_A], error: null }

    await sendAdminEmail({
      recipients: [ELIGIBLE_A, { id: 'opted-out' }],
      subject: 'Test', message: 'Hello', senderId: 'admin-1',
    })

    expect(insertedRows.admin_broadcasts.recipient_count).toBe(1)
    expect(insertedRows.admin_broadcast_recipients).toHaveLength(1)
    expect(insertedRows.admin_broadcast_recipients[0].email).toBe('a@example.com')
  })

  it('sends every remaining eligible recipient when multiple pass eligibility', async () => {
    tableResults.profiles = { data: [ELIGIBLE_A, ELIGIBLE_B], error: null }
    const result = await sendAdminEmail({
      recipients: [ELIGIBLE_A, ELIGIBLE_B],
      subject: 'Test', message: 'Hello', senderId: 'admin-1',
    })
    expect(result.sent).toBe(2)
    expect(result.skipped).toBe(0)
  }, 10000)
})
