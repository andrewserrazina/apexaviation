import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
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

// Apex Advantage Mock Orals ($129/2-hour) -- the instructor+admin
// booking-management surface. Instructors see only their assigned
// bookings (RLS on mock_oral_bookings already enforces this
// server-side; the instructor_id filter below is a UX convenience, not
// the real authorization boundary). Admins see everything plus
// assignment/cancellation/no-show controls. See
// supabase-portal-schema-v97.sql.
//
// Instructor eligibility and availability-slot creation used to live in
// an inline accordion on this page -- moved to the dedicated Mock Oral
// Availability page (pages/MockOralAvailability.jsx) so there's exactly
// one place that creates availability, with real bulk/recurring
// creation, overlap warnings, and a broader (not role='instructor'-only)
// profile picker. This page still links there rather than duplicating
// it.
export default function MockOralDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
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
      .from('mock_oral_bookings')
      .select(`
        *,
        product:mock_oral_products(name),
        availability:mock_oral_availability(class_date, start_time, end_time, timezone),
        instructor:profiles!instructor_id(full_name),
        intake:mock_oral_intakes(aircraft_make, aircraft_model, avionics_type, checkride_date),
        assessment:mock_oral_assessments(status, overall_readiness)
      `)
      .order('created_at', { ascending: false })
    if (!isAdmin) query = query.eq('instructor_id', profile.id)
    const { data, error: loadError } = await query
    if (loadError) setError(loadError.message)
    else setBookings((data ?? []).map(b => ({ ...b, intake: b.intake?.[0] ?? null, assessment: b.assessment?.[0] ?? null })))
    setLoading(false)
  }

  async function loadInstructors() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('mock_oral_instructor', true).order('full_name')
    setInstructors(data ?? [])
  }

  async function assignInstructor(bookingId, instructorId) {
    const { error: updateError } = await supabase.from('mock_oral_bookings').update({ instructor_id: instructorId || null }).eq('id', bookingId)
    if (updateError) { alert(updateError.message); return }
    load()
  }

  async function markNoShow(booking) {
    if (!window.confirm(`Mark ${booking.full_name}'s Mock Oral as a no-show?`)) return
    const { error: updateError } = await supabase.from('mock_oral_bookings').update({ status: 'no_show' }).eq('id', booking.id)
    if (updateError) { alert(updateError.message); return }
    load()
  }

  async function adminCancel(booking) {
    if (!window.confirm(`Cancel ${booking.full_name}'s Mock Oral? The time slot will be released. This does not issue a refund.`)) return
    const { error: rpcError } = await supabase.rpc('cancel_mock_oral_booking', { p_booking_id: booking.id, p_reason: 'Canceled by admin' })
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
          <h2 className="page-title">Mock Orals</h2>
          <p className="page-sub">{isAdmin ? 'All Private Pilot Mock Oral bookings — the $129/2-hour ACS-based product.' : 'Your assigned Mock Oral bookings.'}</p>
        </div>
        <Link className="btn-secondary" to="/mock-oral-availability">Manage Instructors & Availability</Link>
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
          <h3>No Mock Orals here yet</h3>
          <p>Bookings will show up here as students book and pay from the portal.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th><th>Date / Time</th><th>Product</th><th>Aircraft</th><th>Avionics</th>
                <th>Checkride</th><th>Intake</th><th>Instructor</th><th>Status</th><th>Result</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.full_name}</strong>{b.original_booking_id ? ' (Recheck)' : ''}
                    <br /><span style={{ fontSize: 12, color: 'var(--muted)' }}>{b.email}</span>
                  </td>
                  <td>{fmtWhen(b.availability)}</td>
                  <td>{b.product?.name || b.product_id}</td>
                  <td>{[b.intake?.aircraft_make, b.intake?.aircraft_model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{b.intake?.avionics_type || '—'}</td>
                  <td>{b.intake?.checkride_date ? new Date(b.intake.checkride_date).toLocaleDateString() : '—'}</td>
                  <td>{b.intake ? '✓ Complete' : 'Not started'}</td>
                  <td>
                    {isAdmin ? (
                      <select value={b.instructor_id || ''} onChange={e => assignInstructor(b.id, e.target.value)}>
                        <option value="">Unassigned</option>
                        {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                      </select>
                    ) : (b.instructor?.full_name || 'Unassigned')}
                  </td>
                  <td><span className={statusBadgeClass(b.status)}>{b.status}</span></td>
                  <td>{b.assessment?.status === 'completed' ? (b.assessment.overall_readiness || 'Completed').replace(/_/g, ' ') : (b.assessment?.status ? b.assessment.status.replace(/_/g, ' ') : '—')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn-link" onClick={() => navigate(`/mock-orals/${b.id}`)}>
                        {b.assessment?.status === 'completed' ? 'View' : 'Open Applicant'}
                      </button>
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
