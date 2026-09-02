import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
// management surface. Instructors see only their assigned bookings
// (RLS on mock_oral_bookings already enforces this server-side; the
// instructor_id filter below is a UX convenience, not the real
// authorization boundary). Admins see everything plus assignment/
// cancellation/no-show controls. See supabase-portal-schema-v97.sql.
const TZ_OPTIONS = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles']

export default function MockOralDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'

  const [bookings, setBookings] = useState([])
  const [instructors, setInstructors] = useState([])
  const [allInstructorProfiles, setAllInstructorProfiles] = useState([])
  const [slots, setSlots] = useState([])
  const [showAvailability, setShowAvailability] = useState(false)
  const [slotForm, setSlotForm] = useState({ instructorId: isInstructor ? profile.id : '', date: '', startTime: '19:00', timezone: 'America/Chicago', bufferMinutes: 15 })
  const [slotError, setSlotError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [instructorFilter, setInstructorFilter] = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (isAdmin) loadInstructors() }, [isAdmin])
  useEffect(() => { if (isAdmin) loadAllInstructorProfiles() }, [isAdmin])
  useEffect(() => { loadSlots() }, [])

  async function loadAllInstructorProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name, role, mock_oral_instructor, mock_oral_rate_cents').eq('role', 'instructor').order('full_name')
    setAllInstructorProfiles(data ?? [])
  }

  async function toggleMockOralInstructor(id, value) {
    await supabase.from('profiles').update({ mock_oral_instructor: value, mock_oral_certificate_types: value ? ['private_pilot'] : [] }).eq('id', id)
    loadAllInstructorProfiles()
    loadInstructors()
  }

  async function updateInstructorRate(id, cents) {
    await supabase.from('profiles').update({ mock_oral_rate_cents: cents ? Number(cents) : null }).eq('id', id)
    loadAllInstructorProfiles()
  }

  async function loadSlots() {
    let query = supabase.from('mock_oral_availability').select('*, instructor:profiles!instructor_id(full_name)').gte('class_date', new Date().toISOString().slice(0, 10)).order('class_date').order('start_time')
    if (!isAdmin) query = query.eq('instructor_id', profile.id)
    const { data } = await query
    setSlots(data ?? [])
  }

  async function createSlot(e) {
    e.preventDefault()
    setSlotError('')
    if (!slotForm.instructorId || !slotForm.date || !slotForm.startTime) { setSlotError('Instructor, date, and start time are required.'); return }
    const [h, m] = slotForm.startTime.split(':').map(Number)
    const endMinutes = h * 60 + m + 120 // Mock Orals default to a 2-hour block
    const endTime = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
    const { error: insertError } = await supabase.from('mock_oral_availability').insert({
      instructor_id: slotForm.instructorId,
      certificate_type: 'private_pilot',
      class_date: slotForm.date,
      start_time: slotForm.startTime,
      end_time: endTime,
      timezone: slotForm.timezone,
      buffer_minutes: Number(slotForm.bufferMinutes) || 15,
    })
    if (insertError) { setSlotError(insertError.message); return }
    setSlotForm(prev => ({ ...prev, date: '' }))
    loadSlots()
  }

  async function deleteSlot(id) {
    if (!window.confirm('Remove this open time slot?')) return
    await supabase.from('mock_oral_availability').delete().eq('id', id)
    loadSlots()
  }

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
      </div>

      <div className="portal-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowAvailability(!showAvailability)}>
          <h3>Availability {showAvailability ? '▾' : '▸'}</h3>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{slots.filter(s => s.status === 'open').length} open slot{slots.filter(s => s.status === 'open').length === 1 ? '' : 's'} upcoming</span>
        </div>
        {showAvailability && (
          <div style={{ marginTop: 16 }}>
            {isAdmin && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 10 }}>Mock Oral instructors</summary>
                <table className="admin-table" style={{ marginTop: 10 }}>
                  <thead><tr><th>Instructor</th><th>Mock Oral Instructor</th><th>Rate per session ($)</th></tr></thead>
                  <tbody>
                    {allInstructorProfiles.map(i => (
                      <tr key={i.id}>
                        <td>{i.full_name}</td>
                        <td><input type="checkbox" checked={!!i.mock_oral_instructor} onChange={e => toggleMockOralInstructor(i.id, e.target.checked)} /></td>
                        <td><input type="number" defaultValue={i.mock_oral_rate_cents ? i.mock_oral_rate_cents / 100 : ''} placeholder="e.g. 65" style={{ width: 90 }} onBlur={e => updateInstructorRate(i.id, e.target.value ? Number(e.target.value) * 100 : null)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Only Private Pilot is enabled today; instrument/commercial/CFI are architected but not yet exposed.</p>
              </details>
            )}

            <form onSubmit={createSlot} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
              {isAdmin && (
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Instructor
                  <select value={slotForm.instructorId} onChange={e => setSlotForm({ ...slotForm, instructorId: e.target.value })}>
                    <option value="">Select…</option>
                    {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                  </select>
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Date
                <input type="date" value={slotForm.date} onChange={e => setSlotForm({ ...slotForm, date: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Start time
                <input type="time" value={slotForm.startTime} onChange={e => setSlotForm({ ...slotForm, startTime: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Time zone
                <select value={slotForm.timezone} onChange={e => setSlotForm({ ...slotForm, timezone: e.target.value })}>
                  {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Buffer after (min)
                <input type="number" value={slotForm.bufferMinutes} onChange={e => setSlotForm({ ...slotForm, bufferMinutes: e.target.value })} style={{ width: 80 }} />
              </label>
              <button type="submit" className="btn btn--primary">Add 2-hour slot</button>
            </form>
            {slotError && <div className="form-error" style={{ marginBottom: 12 }}>{slotError}</div>}

            <div className="table-scroll">
              <table className="admin-table">
                <thead><tr><th>Date / Time</th>{isAdmin && <th>Instructor</th>}<th>Status</th><th></th></tr></thead>
                <tbody>
                  {slots.map(s => (
                    <tr key={s.id}>
                      <td>{new Date(`${s.class_date}T${s.start_time}`).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – {s.end_time.slice(0, 5)} {s.timezone}</td>
                      {isAdmin && <td>{s.instructor?.full_name || '—'}</td>}
                      <td><span className={s.status === 'open' ? 'badge badge--green' : s.status === 'booked' ? 'badge badge--blue' : 'badge'}>{s.status}</span></td>
                      <td>{s.status === 'open' && <button className="btn-link" onClick={() => deleteSlot(s.id)}>Remove</button>}</td>
                    </tr>
                  ))}
                  {slots.length === 0 && <tr><td colSpan={isAdmin ? 4 : 3} style={{ color: 'var(--muted)' }}>No upcoming slots yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
