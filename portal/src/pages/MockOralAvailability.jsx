import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  CERTIFICATE_TYPES, TZ_OPTIONS, WEEKDAYS,
  findConflicts, validateSingleSlotForm, generateRecurringDates,
} from '../lib/mockOralAvailability'

const STATUS_OPTIONS = ['open', 'booked', 'blocked']

function certLabel(value) {
  return CERTIFICATE_TYPES.find(c => c.value === value)?.label ?? value
}

function fmtSlot(row) {
  const start = new Date(`${row.class_date}T${row.start_time}`)
  return start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const BLANK_SINGLE_FORM = {
  instructor_id: '', certificate_type: 'private_pilot', class_date: '',
  start_time: '18:00', end_time: '20:00', timezone: 'America/Chicago', buffer_minutes: 15,
}

const BLANK_BULK_FORM = {
  instructor_id: '', certificate_type: 'private_pilot',
  start_date: '', end_date: '', weekdays: [],
  start_time: '18:00', end_time: '20:00', timezone: 'America/Chicago', buffer_minutes: 15,
}

// Apex Advantage Mock Orals ($129-$179, 2-hour ACS-based product,
// supabase-portal-schema-v97.sql) -- the dedicated admin surface for
// (1) marking which existing profiles may conduct Mock Orals and
// (2) creating/operating their bookable availability. This REPLACES the
// old inline "Availability" accordion that used to live inside
// MockOralDashboard.jsx (single hardcoded-120-minute slot, instructor
// list limited to role='instructor' only, no bulk creation, no overlap
// warning) -- consolidated here so there is exactly one place that
// creates availability, not two. MockOralDashboard.jsx still owns actual
// booking oversight (assignment/no-show/cancel) and links here.
//
// Server-side, closing a real gap found while building this (see
// supabase-portal-schema-v144-mock-oral-availability-admin.sql): the
// instructor-eligibility columns on profiles were never added to the
// admin-only column lock, and the "instructors manage their own
// availability" policy never checked eligibility at all -- meaning any
// authenticated member could previously self-declare as a Mock Oral
// instructor and create real, payable availability. Both are fixed in
// that migration; this UI is what a legitimate admin uses to do the
// same thing safely.
export default function MockOralAvailability() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'

  const [candidateProfiles, setCandidateProfiles] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [eligibleInstructors, setEligibleInstructors] = useState([])

  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const [filterInstructor, setFilterInstructor] = useState('')
  const [filterCertificate, setFilterCertificate] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTime, setFilterTime] = useState('upcoming')

  const [singleForm, setSingleForm] = useState({ ...BLANK_SINGLE_FORM, instructor_id: isInstructor ? profile.id : '' })
  const [singleError, setSingleError] = useState('')
  const [singleConflicts, setSingleConflicts] = useState([])
  const [singleSaving, setSingleSaving] = useState(false)

  const [bulkForm, setBulkForm] = useState({ ...BLANK_BULK_FORM, instructor_id: isInstructor ? profile.id : '' })
  const [bulkError, setBulkError] = useState('')
  const [bulkPreview, setBulkPreview] = useState(null) // { rows: [{class_date, conflict}], instructor }
  const [bulkIncludeConflicts, setBulkIncludeConflicts] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)

  const [editingSlot, setEditingSlot] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState('')
  const [editConflicts, setEditConflicts] = useState([])
  const [editSaving, setEditSaving] = useState(false)

  const [removeConfirm, setRemoveConfirm] = useState(null) // { instructorProfile, openUpcomingCount }
  const [closeSlotsOnRemove, setCloseSlotsOnRemove] = useState(true)

  const displayedProfiles = searchQuery.trim().length >= 2 ? searchResults : candidateProfiles

  useEffect(() => { loadSlots() }, [])
  useEffect(() => { if (isAdmin) { loadCandidateProfiles(); loadEligibleInstructors() } }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults([]); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, mock_oral_instructor, mock_oral_certificate_types, mock_oral_rate_cents')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('full_name')
        .limit(25)
      setSearchResults(data ?? [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, isAdmin])

  async function loadCandidateProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, mock_oral_instructor, mock_oral_certificate_types, mock_oral_rate_cents')
      .or('role.eq.admin,role.eq.instructor,mock_oral_instructor.eq.true')
      .order('full_name')
    setCandidateProfiles(data ?? [])
  }

  async function loadEligibleInstructors() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, mock_oral_instructor, mock_oral_certificate_types')
      .eq('mock_oral_instructor', true)
      .order('full_name')
    setEligibleInstructors(data ?? [])
  }

  async function refreshProfileLists() {
    await Promise.all([loadCandidateProfiles(), loadEligibleInstructors()])
    if (searchQuery.trim().length >= 2) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, mock_oral_instructor, mock_oral_certificate_types, mock_oral_rate_cents')
        .or(`full_name.ilike.%${searchQuery.trim()}%,email.ilike.%${searchQuery.trim()}%`)
        .order('full_name')
        .limit(25)
      setSearchResults(data ?? [])
    }
  }

  async function loadSlots() {
    setSlotsLoading(true)
    setError('')
    let query = supabase
      .from('mock_oral_availability')
      .select('*, instructor:profiles!instructor_id(full_name), booking:mock_oral_bookings(id, status, full_name, product:mock_oral_products(name))')
      .order('class_date', { ascending: true })
      .order('start_time', { ascending: true })
    if (!isAdmin && profile?.id) query = query.eq('instructor_id', profile.id)
    const { data, error: loadError } = await query
    if (loadError) setError(loadError.message)
    setSlots((data ?? []).map(s => ({ ...s, booking: Array.isArray(s.booking) ? (s.booking[0] ?? null) : s.booking })))
    setSlotsLoading(false)
  }

  // ── Instructor management (admin only) ──────────────────────────
  async function toggleInstructor(target, nextValue) {
    if (!nextValue) {
      const today = new Date().toISOString().slice(0, 10)
      const openUpcomingCount = slots.filter(s => s.instructor_id === target.id && s.status === 'open' && s.class_date >= today).length
      setRemoveConfirm({ instructorProfile: target, openUpcomingCount })
      setCloseSlotsOnRemove(true)
      return
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ mock_oral_instructor: true, mock_oral_certificate_types: target.mock_oral_certificate_types?.length ? target.mock_oral_certificate_types : ['private_pilot'] })
      .eq('id', target.id)
    if (updateError) { setError(updateError.message); return }
    setNotice(`${target.full_name} can now be scheduled for Mock Orals.`)
    refreshProfileLists()
  }

  async function confirmRemoveInstructor(alsoCloseSlots) {
    const target = removeConfirm.instructorProfile
    setRemoveConfirm(null)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ mock_oral_instructor: false, mock_oral_certificate_types: [] })
      .eq('id', target.id)
    if (updateError) { setError(updateError.message); return }

    if (alsoCloseSlots) {
      const today = new Date().toISOString().slice(0, 10)
      await supabase
        .from('mock_oral_availability')
        .update({ status: 'blocked' })
        .eq('instructor_id', target.id)
        .eq('status', 'open')
        .gte('class_date', today)
    }
    setNotice(`${target.full_name} is no longer a Mock Oral instructor.${alsoCloseSlots ? ' Their open upcoming slots were closed.' : ''}`)
    refreshProfileLists()
    loadSlots()
  }

  async function updateCertificateTypes(target, nextTypes) {
    const { error: updateError } = await supabase.from('profiles').update({ mock_oral_certificate_types: nextTypes }).eq('id', target.id)
    if (updateError) { setError(updateError.message); return }
    refreshProfileLists()
  }

  async function updateRate(target, dollars) {
    const cents = dollars ? Math.round(Number(dollars) * 100) : null
    const { error: updateError } = await supabase.from('profiles').update({ mock_oral_rate_cents: cents }).eq('id', target.id)
    if (updateError) { setError(updateError.message); return }
    refreshProfileLists()
  }

  // ── Single-slot creation ─────────────────────────────────────────
  const selectedSingleInstructor = eligibleInstructors.find(i => i.id === singleForm.instructor_id) ?? (isInstructor ? profile : null)

  function submitSingleSlot(e, force = false) {
    e?.preventDefault?.()
    setSingleError('')
    const errors = validateSingleSlotForm(singleForm, selectedSingleInstructor)
    if (errors.length) { setSingleError(errors[0]); return }

    const conflicts = findConflicts(singleForm, slots)
    if (conflicts.length && !force) {
      setSingleConflicts(conflicts)
      return
    }
    setSingleConflicts([])
    createSingleSlot()
  }

  async function createSingleSlot() {
    setSingleSaving(true)
    const { error: insertError } = await supabase.from('mock_oral_availability').insert({
      instructor_id: singleForm.instructor_id,
      certificate_type: singleForm.certificate_type,
      class_date: singleForm.class_date,
      start_time: singleForm.start_time,
      end_time: singleForm.end_time,
      timezone: singleForm.timezone,
      buffer_minutes: Number(singleForm.buffer_minutes) || 15,
    })
    setSingleSaving(false)
    if (insertError) { setSingleError(insertError.message); return }
    setNotice('Availability slot created.')
    setSingleForm(prev => ({ ...prev, class_date: '' }))
    loadSlots()
  }

  // ── Bulk / recurring creation ─────────────────────────────────────
  const selectedBulkInstructor = eligibleInstructors.find(i => i.id === bulkForm.instructor_id) ?? (isInstructor ? profile : null)

  function toggleBulkWeekday(day) {
    setBulkForm(current => ({
      ...current,
      weekdays: current.weekdays.includes(day) ? current.weekdays.filter(d => d !== day) : [...current.weekdays, day].sort(),
    }))
  }

  function previewBulk() {
    setBulkError('')
    setBulkPreview(null)
    setBulkIncludeConflicts(false)
    const base = {
      instructor_id: bulkForm.instructor_id, certificate_type: bulkForm.certificate_type,
      start_time: bulkForm.start_time, end_time: bulkForm.end_time,
    }
    const errors = validateSingleSlotForm({ ...base, class_date: bulkForm.start_date || '2099-01-01', timezone: bulkForm.timezone }, selectedBulkInstructor)
      .filter(e => e !== 'Date is required.') // date-range fields are validated separately below
    if (!bulkForm.start_date) errors.push('Start date is required.')
    if (!bulkForm.end_date) errors.push('End date is required.')
    if (bulkForm.start_date && bulkForm.end_date && bulkForm.end_date < bulkForm.start_date) errors.push('End date must be on or after the start date.')
    if (!bulkForm.weekdays.length) errors.push('Select at least one weekday.')
    if (errors.length) { setBulkError(errors[0]); return }

    const dates = generateRecurringDates({ startDate: bulkForm.start_date, endDate: bulkForm.end_date, weekdays: bulkForm.weekdays })
    if (!dates.length) { setBulkError('No matching dates in that range.'); return }

    const rows = dates.map(class_date => {
      const candidate = { ...base, class_date }
      const conflicts = findConflicts(candidate, slots)
      return { class_date, conflict: conflicts.length > 0 }
    })
    setBulkPreview({ rows, instructor: selectedBulkInstructor })
  }

  async function confirmCreateBulk() {
    if (!bulkPreview) return
    const rowsToCreate = bulkPreview.rows.filter(r => bulkIncludeConflicts || !r.conflict)
    if (!rowsToCreate.length) { setBulkError('No slots to create -- all generated dates conflict with existing availability.'); return }

    setBulkSaving(true)
    const payload = rowsToCreate.map(r => ({
      instructor_id: bulkForm.instructor_id,
      certificate_type: bulkForm.certificate_type,
      class_date: r.class_date,
      start_time: bulkForm.start_time,
      end_time: bulkForm.end_time,
      timezone: bulkForm.timezone,
      buffer_minutes: Number(bulkForm.buffer_minutes) || 15,
    }))
    const { error: insertError } = await supabase.from('mock_oral_availability').insert(payload)
    setBulkSaving(false)
    if (insertError) { setBulkError(insertError.message); return }
    setNotice(`Created ${rowsToCreate.length} availability slot${rowsToCreate.length === 1 ? '' : 's'}.`)
    setBulkPreview(null)
    setBulkForm(prev => ({ ...prev, start_date: '', end_date: '' }))
    loadSlots()
  }

  // ── Edit / close-reopen / delete ──────────────────────────────────
  function openEdit(slot) {
    setEditingSlot(slot)
    setEditForm({
      certificate_type: slot.certificate_type,
      class_date: slot.class_date,
      start_time: slot.start_time.slice(0, 5),
      end_time: slot.end_time.slice(0, 5),
      timezone: slot.timezone,
      buffer_minutes: slot.buffer_minutes,
    })
    setEditError('')
    setEditConflicts([])
  }

  function submitEdit(force = false) {
    const instructorRow = eligibleInstructors.find(i => i.id === editingSlot.instructor_id) ?? { mock_oral_instructor: true, mock_oral_certificate_types: [editForm.certificate_type] }
    const errors = validateSingleSlotForm({ ...editForm, instructor_id: editingSlot.instructor_id }, instructorRow)
    if (errors.length) { setEditError(errors[0]); return }

    const conflicts = findConflicts({ ...editForm, instructor_id: editingSlot.instructor_id }, slots, editingSlot.id)
    if (conflicts.length && !force) { setEditConflicts(conflicts); return }

    saveEdit()
  }

  async function saveEdit() {
    setEditSaving(true)
    const { error: updateError } = await supabase.from('mock_oral_availability').update({
      certificate_type: editForm.certificate_type,
      class_date: editForm.class_date,
      start_time: editForm.start_time,
      end_time: editForm.end_time,
      timezone: editForm.timezone,
      buffer_minutes: Number(editForm.buffer_minutes) || 15,
    }).eq('id', editingSlot.id).eq('status', 'open') // defense in depth -- never edit out from under a booking
    setEditSaving(false)
    if (updateError) { setEditError(updateError.message); return }
    setNotice('Slot updated.')
    setEditingSlot(null)
    setEditForm(null)
    loadSlots()
  }

  async function toggleCloseReopen(slot) {
    const nextStatus = slot.status === 'open' ? 'blocked' : 'open'
    const { error: updateError } = await supabase.from('mock_oral_availability').update({ status: nextStatus }).eq('id', slot.id).neq('status', 'booked')
    if (updateError) { setError(updateError.message); return }
    loadSlots()
  }

  async function deleteSlot(slot) {
    if (!window.confirm('Remove this availability slot? This cannot be undone.')) return
    const { error: deleteError } = await supabase.from('mock_oral_availability').delete().eq('id', slot.id).neq('status', 'booked')
    if (deleteError) { setError(deleteError.message); return }
    setNotice('Slot removed.')
    loadSlots()
  }

  async function cancelBooking(slot) {
    if (!window.confirm(`Cancel ${slot.booking.full_name}'s Mock Oral? The time slot will be released. This does not issue a refund.`)) return
    const { error: rpcError } = await supabase.rpc('cancel_mock_oral_booking', { p_booking_id: slot.booking.id, p_reason: 'Canceled by admin from Mock Oral Availability' })
    if (rpcError) { setError(rpcError.message); return }
    setNotice('Booking canceled; slot released.')
    loadSlots()
  }

  // ── Upcoming table filtering ───────────────────────────────────────
  const filteredSlots = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return slots.filter(s => {
      if (filterInstructor && s.instructor_id !== filterInstructor) return false
      if (filterCertificate && s.certificate_type !== filterCertificate) return false
      if (filterStatus && s.status !== filterStatus) return false
      if (filterTime === 'upcoming' && s.class_date < today) return false
      if (filterTime === 'past' && s.class_date >= today) return false
      return true
    })
  }, [slots, filterInstructor, filterCertificate, filterStatus, filterTime])

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Apex Advantage</p>
          <h2 className="page-title">Mock Oral Availability</h2>
          <p className="page-sub">Mark eligible instructors and publish bookable Mock Oral time slots.</p>
        </div>
      </div>

      {notice && <div className="form-success" style={{ marginBottom: 18 }}>{notice}</div>}
      {error && <div className="form-error" style={{ marginBottom: 18 }}>{error}</div>}

      {isAdmin && (
        <section className="card" style={{ marginBottom: 24 }}>
          <h3 className="card__title">Mock Oral Instructors</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            Any existing profile can be marked eligible -- this does not create a separate instructor record. Only Private Pilot is sold today; the other certificate types are recorded for when they go live.
          </p>
          <input
            className="search-input"
            type="search"
            placeholder="Search all profiles by name or email…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ marginBottom: 14, width: '100%', maxWidth: 360 }}
          />
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Mock Oral Instructor</th><th>Certificate Types</th><th>Rate / session</th></tr>
              </thead>
              <tbody>
                {searching && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Searching…</td></tr>}
                {!searching && displayedProfiles.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.full_name}</strong></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.email}</td>
                    <td>{p.role}</td>
                    <td>
                      <input type="checkbox" checked={!!p.mock_oral_instructor} onChange={e => toggleInstructor(p, e.target.checked)} />
                    </td>
                    <td>
                      {p.mock_oral_instructor ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {CERTIFICATE_TYPES.map(ct => (
                            <label key={ct.value} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="checkbox"
                                checked={(p.mock_oral_certificate_types || []).includes(ct.value)}
                                onChange={e => {
                                  const next = e.target.checked
                                    ? [...(p.mock_oral_certificate_types || []), ct.value]
                                    : (p.mock_oral_certificate_types || []).filter(v => v !== ct.value)
                                  updateCertificateTypes(p, next)
                                }}
                              />
                              {ct.label}
                            </label>
                          ))}
                        </div>
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td>
                      {p.mock_oral_instructor ? (
                        <input
                          type="number" min="0" step="1" placeholder="e.g. 65"
                          defaultValue={p.mock_oral_rate_cents ? p.mock_oral_rate_cents / 100 : ''}
                          style={{ width: 90 }}
                          onBlur={e => updateRate(p, e.target.value)}
                        />
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
                {!searching && displayedProfiles.length === 0 && (
                  <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>{searchQuery.trim().length >= 2 ? 'No matching profiles.' : 'No admins/instructors found.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: 24 }}>
        <h3 className="card__title">Add a Slot</h3>
        <form onSubmit={submitSingleSlot} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
          {isAdmin && (
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Instructor
              <select value={singleForm.instructor_id} onChange={e => setSingleForm({ ...singleForm, instructor_id: e.target.value })}>
                <option value="">Select…</option>
                {eligibleInstructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Certificate Type
            <select value={singleForm.certificate_type} onChange={e => setSingleForm({ ...singleForm, certificate_type: e.target.value })}>
              {(selectedSingleInstructor?.mock_oral_certificate_types?.length ? selectedSingleInstructor.mock_oral_certificate_types : CERTIFICATE_TYPES.map(c => c.value)).map(v => (
                <option key={v} value={v}>{certLabel(v)}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Date
            <input type="date" value={singleForm.class_date} onChange={e => setSingleForm({ ...singleForm, class_date: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Start Time
            <input type="time" value={singleForm.start_time} onChange={e => setSingleForm({ ...singleForm, start_time: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>End Time
            <input type="time" value={singleForm.end_time} onChange={e => setSingleForm({ ...singleForm, end_time: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Time Zone
            <select value={singleForm.timezone} onChange={e => setSingleForm({ ...singleForm, timezone: e.target.value })}>
              {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Buffer After (min)
            <input type="number" min="0" value={singleForm.buffer_minutes} onChange={e => setSingleForm({ ...singleForm, buffer_minutes: e.target.value })} style={{ width: 80 }} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={singleSaving}>{singleSaving ? 'Adding…' : 'Add Slot'}</button>
        </form>
        {singleError && <div className="form-error" style={{ marginBottom: 10 }}>{singleError}</div>}
        {singleConflicts.length > 0 && (
          <div className="form-error" style={{ marginBottom: 10 }}>
            This overlaps {singleConflicts.length} existing slot{singleConflicts.length === 1 ? '' : 's'} for this instructor ({singleConflicts.map(fmtSlot).join(', ')}).
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setSingleConflicts([])}>Cancel</button>{' '}
              <button type="button" className="btn-primary-sm" onClick={() => submitSingleSlot(null, true)}>Create Anyway</button>
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 24 }}>
        <h3 className="card__title">Add Recurring Slots</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
          Example: every Monday, Wednesday, and Friday, 6:00–8:00 PM Eastern, for the next four weeks.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          {isAdmin && (
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Instructor
              <select value={bulkForm.instructor_id} onChange={e => setBulkForm({ ...bulkForm, instructor_id: e.target.value })}>
                <option value="">Select…</option>
                {eligibleInstructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Certificate Type
            <select value={bulkForm.certificate_type} onChange={e => setBulkForm({ ...bulkForm, certificate_type: e.target.value })}>
              {(selectedBulkInstructor?.mock_oral_certificate_types?.length ? selectedBulkInstructor.mock_oral_certificate_types : CERTIFICATE_TYPES.map(c => c.value)).map(v => (
                <option key={v} value={v}>{certLabel(v)}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Start Date
            <input type="date" value={bulkForm.start_date} onChange={e => setBulkForm({ ...bulkForm, start_date: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>End Date
            <input type="date" value={bulkForm.end_date} onChange={e => setBulkForm({ ...bulkForm, end_date: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Start Time
            <input type="time" value={bulkForm.start_time} onChange={e => setBulkForm({ ...bulkForm, start_time: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>End Time
            <input type="time" value={bulkForm.end_time} onChange={e => setBulkForm({ ...bulkForm, end_time: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Time Zone
            <select value={bulkForm.timezone} onChange={e => setBulkForm({ ...bulkForm, timezone: e.target.value })}>
              {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>Buffer After (min)
            <input type="number" min="0" value={bulkForm.buffer_minutes} onChange={e => setBulkForm({ ...bulkForm, buffer_minutes: e.target.value })} style={{ width: 80 }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {WEEKDAYS.map(w => (
            <label key={w.value} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={bulkForm.weekdays.includes(w.value)} onChange={() => toggleBulkWeekday(w.value)} />
              {w.label}
            </label>
          ))}
        </div>
        <button type="button" className="btn-secondary" onClick={previewBulk}>Preview Slots</button>
        {bulkError && <div className="form-error" style={{ marginTop: 10 }}>{bulkError}</div>}

        {bulkPreview && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              {bulkPreview.rows.length} slot{bulkPreview.rows.length === 1 ? '' : 's'} generated
              {bulkPreview.rows.some(r => r.conflict) ? `, ${bulkPreview.rows.filter(r => r.conflict).length} overlap existing availability` : ''}.
            </p>
            <div className="table-scroll" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
              <table className="admin-table">
                <thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead>
                <tbody>
                  {bulkPreview.rows.map(r => (
                    <tr key={r.class_date} style={r.conflict ? { background: 'rgba(248,113,113,0.08)' } : undefined}>
                      <td>{new Date(`${r.class_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                      <td>{bulkForm.start_time}–{bulkForm.end_time} {bulkForm.timezone}</td>
                      <td>{r.conflict ? <span className="badge">Overlaps existing</span> : <span className="badge badge--green">Clear</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bulkPreview.rows.some(r => r.conflict) && (
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <input type="checkbox" checked={bulkIncludeConflicts} onChange={e => setBulkIncludeConflicts(e.target.checked)} />
                Also create the overlapping slots anyway
              </label>
            )}
            <button type="button" className="btn btn--primary" disabled={bulkSaving} onClick={confirmCreateBulk}>
              {bulkSaving ? 'Creating…' : `Create ${bulkIncludeConflicts ? bulkPreview.rows.length : bulkPreview.rows.filter(r => !r.conflict).length} Slot${(bulkIncludeConflicts ? bulkPreview.rows.length : bulkPreview.rows.filter(r => !r.conflict).length) === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="card__title">Upcoming Availability</h3>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {isAdmin && (
            <select value={filterInstructor} onChange={e => setFilterInstructor(e.target.value)}>
              <option value="">All instructors</option>
              {eligibleInstructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
            </select>
          )}
          <select value={filterCertificate} onChange={e => setFilterCertificate(e.target.value)}>
            <option value="">All certificate types</option>
            {CERTIFICATE_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterTime} onChange={e => setFilterTime(e.target.value)}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
        </div>

        {slotsLoading ? (
          <p className="empty-state">Loading…</p>
        ) : filteredSlots.length === 0 ? (
          <div className="empty-state-block">
            <h3>No slots here yet</h3>
            <p>Add a slot above, or adjust the filters.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th><th>Time</th><th>Timezone</th>{isAdmin && <th>Instructor</th>}
                  <th>Certificate</th><th>Status</th><th>Booking</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlots.map(s => (
                  <tr key={s.id}>
                    <td>{new Date(`${s.class_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</td>
                    <td>{s.timezone}</td>
                    {isAdmin && <td>{s.instructor?.full_name ?? '—'}</td>}
                    <td>{certLabel(s.certificate_type)}</td>
                    <td><span className={s.status === 'open' ? 'badge badge--green' : s.status === 'booked' ? 'badge badge--blue' : 'badge'}>{s.status}</span></td>
                    <td>
                      {s.booking ? (
                        <span style={{ fontSize: 12 }}>
                          <strong>{s.booking.full_name}</strong><br />
                          {s.booking.product?.name}<br />
                          <span className={`status-badge${s.booking.status === 'confirmed' ? '' : ' status-badge--warning'}`}>{s.booking.status}</span>
                        </span>
                      ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {s.status !== 'booked' && <button className="btn-link" onClick={() => openEdit(s)}>Edit</button>}
                        {s.status !== 'booked' && (
                          <button className="btn-link" onClick={() => toggleCloseReopen(s)}>{s.status === 'open' ? 'Close' : 'Reopen'}</button>
                        )}
                        {s.status !== 'booked' && <button className="btn-link" onClick={() => deleteSlot(s)}>Remove</button>}
                        {s.status === 'booked' && isAdmin && s.booking?.status === 'confirmed' && (
                          <button className="btn-link" onClick={() => cancelBooking(s)}>Cancel Booking</button>
                        )}
                        {s.status === 'booked' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Protected — booked</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {removeConfirm && (
        <Modal title="Remove Mock Oral Eligibility" onClose={() => setRemoveConfirm(null)}>
          <div className="modal-form">
            <p>
              {removeConfirm.instructorProfile.full_name} will no longer be schedulable for Mock Orals. Their existing bookings are unaffected.
              {removeConfirm.openUpcomingCount > 0 && ` They have ${removeConfirm.openUpcomingCount} open, unbooked, upcoming slot${removeConfirm.openUpcomingCount === 1 ? '' : 's'}.`}
            </p>
            {removeConfirm.openUpcomingCount > 0 && (
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <input type="checkbox" checked={closeSlotsOnRemove} onChange={e => setCloseSlotsOnRemove(e.target.checked)} />
                Also close their open upcoming slots so students stop seeing them
              </label>
            )}
            <div className="modal-form__actions">
              <button type="button" className="btn-secondary" onClick={() => setRemoveConfirm(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary-sm"
                onClick={() => confirmRemoveInstructor(closeSlotsOnRemove)}
              >
                Remove Eligibility
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editingSlot && editForm && (
        <Modal title="Edit Availability Slot" onClose={() => { setEditingSlot(null); setEditForm(null) }}>
          <form className="modal-form" onSubmit={e => { e.preventDefault(); submitEdit(false) }}>
            {editError && <div className="form-error">{editError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Certificate Type</label>
                <select value={editForm.certificate_type} onChange={e => setEditForm({ ...editForm, certificate_type: e.target.value })}>
                  {CERTIFICATE_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={editForm.class_date} onChange={e => setEditForm({ ...editForm, class_date: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Time Zone</label>
                <select value={editForm.timezone} onChange={e => setEditForm({ ...editForm, timezone: e.target.value })}>
                  {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Buffer After (min)</label>
                <input type="number" min="0" value={editForm.buffer_minutes} onChange={e => setEditForm({ ...editForm, buffer_minutes: e.target.value })} />
              </div>
            </div>
            {editConflicts.length > 0 && (
              <div className="form-error">
                This overlaps {editConflicts.length} other slot{editConflicts.length === 1 ? '' : 's'} ({editConflicts.map(fmtSlot).join(', ')}).
              </div>
            )}
            <div className="modal-form__actions">
              <button type="button" className="btn-secondary" onClick={() => { setEditingSlot(null); setEditForm(null) }}>Close</button>
              {editConflicts.length > 0 ? (
                <button type="button" className="btn-primary-sm" disabled={editSaving} onClick={() => submitEdit(true)}>Save Anyway</button>
              ) : (
                <button type="submit" className="btn-primary-sm" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
