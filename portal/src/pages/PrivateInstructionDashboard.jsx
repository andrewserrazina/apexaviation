import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS_OPTIONS = ['confirmed', 'completed', 'canceled', 'no_show']

function statusBadgeClass(status) {
  if (status === 'completed') return 'status-badge status-badge--success'
  if (status === 'canceled' || status === 'no_show') return 'status-badge status-badge--warning'
  return 'status-badge'
}

function fmtWhen(availability) {
  if (!availability) return '—'
  return new Date(`${availability.class_date}T${availability.start_time}`).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// Apex Advantage Private Instruction ($55/hour, flat rate, all
// certificate levels) -- the instructor+admin booking-management
// surface. Mirrors MockOralDashboard.jsx: instructors see only their
// assigned bookings (RLS on private_instruction_bookings already
// enforces this server-side; the instructor_id filter below is a UX
// convenience, not the real authorization boundary). Admins see
// everything plus assignment/cancellation/no-show controls. No
// intake/assessment flow here -- unlike Mock Oral, Private Instruction
// has no fixed curriculum to assess against, it's whatever the student
// wants to work on that hour.
export default function PrivateInstructionDashboard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [bookings, setBookings] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [instructorFilter, setInstructorFilter] = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (isAdmin) loadInstructors() }, [isAdmin])

  async function load() {
    setLoading(true)
    setError('')
    let query = supabase
      .from('private_instruction_bookings')
      .select(`
        *,
        availability:private_instruction_availability(class_date, start_time, end_time, timezone),
        instructor:profiles!instructor_id(full_name)
      `)
      .order('created_at', { ascending: false })
    if (!isAdmin) query = query.eq('instructor_id', profile.id)
    const { data, error: loadError } = await query
    if (loadError) setError(loadError.message)
    else setBookings(data ?? [])
    setLoading(false)
  }

  async function loadInstructors() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('private_instruction_instructor', true).order('full_name')
    setInstructors(data ?? [])
  }

  async function assignInstructor(bookingId, instructorId) {
    const { error: updateError } = await supabase.from('private_instruction_bookings').update({ instructor_id: instructorId || null }).eq('id', bookingId)
    if (updateError) { alert(updateError.message); return }
    load()
  }

  async function markNoShow(booking) {
    if (!window.confirm(`Mark ${booking.full_name}'s Private Instruction session as a no-show?`)) return
    const { error: updateError } = await supabase.from('private_instruction_bookings').update({ status: 'no_show' }).eq('id', booking.id)
    if (updateError) { alert(updateError.message); return }
    load()
  }

  async function markCompleted(booking) {
    const { error: updateError } = await supabase.from('private_instruction_bookings').update({ status: 'completed' }).eq('id', booking.id)
    if (updateError) { alert(updateError.message); return }
    load()
  }

  async function adminCancel(booking) {
    if (!window.confirm(`Cancel ${booking.full_name}'s Private Instruction session? The time slot will be released. This does not issue a refund.`)) return
    const { error: rpcError } = await supabase.rpc('cancel_private_instruction_booking', { p_booking_id: booking.id, p_reason: 'Canceled by admin' })
    if (rpcError) { alert(rpcError.message); return }
    load()
  }

  const filtered = bookings.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false
    if (instructorFilter === '__unassigned' && b.instructor_id) return false
    if (instructorFilter && instructorFilter !== '__unassigned' && b.instructor_id !== instructorFilter) return false
    return true
  })

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Apex Advantage</p>
          <h2 className="page-title">Private Instruction</h2>
          <p className="page-sub">{isAdmin ? 'All Private Instruction bookings — $55/hour, all certificate levels.' : 'Your assigned Private Instruction bookings.'}</p>
        </div>
        <Link className="btn-secondary" to="/private-instruction-availability">Manage Instructors & Availability</Link>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={instructorFilter} onChange={e => setInstructorFilter(e.target.value)}>
            <option value="">All instructors</option>
            <option value="__unassigned">Needs instructor</option>
            {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </select>
        </div>
      )}

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state-block">
          <h3>No Private Instruction bookings here yet</h3>
          <p>Bookings will show up here as students book and pay from the portal.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th><th>Date / Time</th><th>Instructor</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.full_name}</strong>
                    <br /><span style={{ fontSize: 12, color: 'var(--muted)' }}>{b.email}</span>
                  </td>
                  <td>{fmtWhen(b.availability)}</td>
                  <td>
                    {isAdmin ? (
                      <select value={b.instructor_id || ''} onChange={e => assignInstructor(b.id, e.target.value)}>
                        <option value="">Unassigned</option>
                        {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                      </select>
                    ) : (b.instructor?.full_name || 'Unassigned')}
                  </td>
                  <td><span className={statusBadgeClass(b.status)}>{b.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {b.status === 'confirmed' && <button className="btn-link" onClick={() => markCompleted(b)}>Mark Completed</button>}
                      {isAdmin && b.status === 'confirmed' && <button className="btn-link" onClick={() => markNoShow(b)}>No-Show</button>}
                      {isAdmin && b.status === 'confirmed' && <button className="btn-link" onClick={() => adminCancel(b)}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
