import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const LESSON_TYPES = ['Discovery Flight', 'Private Pilot Training', 'Instrument Training', 'Commercial Training', 'Flight Review', 'Check Ride Prep', 'Other']

const BLANK_FORM = { student_id: '', instructor_id: '', date: '', start_time: '', end_time: '', aircraft_id: '', lesson_type: 'Private Pilot Training', debrief_notes: '' }
const BLANK_REQ = { instructor_id: '', preferred_date: '', preferred_time: '', lesson_type: 'Private Pilot Training', notes: '' }

export default function Schedule() {
  const { profile } = useAuth()
  const [lessons, setLessons] = useState([])
  const [current, setCurrent] = useState(new Date())
  const [students, setStudents] = useState([])
  const [instructors, setInstructors] = useState([])
  const [aircraft, setAircraft] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Dispatch release
  const [dispatchModal, setDispatchModal] = useState(null) // lesson
  const [dispatchChecks, setDispatchChecks] = useState({})
  const [dispatchSaving, setDispatchSaving] = useState(false)

  const DISPATCH_ITEMS = [
    'Weather briefing obtained (1800wxbrief or ForeFlight)',
    'NOTAMs reviewed',
    'Aircraft airworthiness confirmed (no open squawks)',
    'Aircraft preflight completed',
    'Fuel & oil levels verified',
    'Student documents verified (student cert, medical)',
    'Instructor is current (flight review, medical, CFI)',
    'Route of flight filed / discussed',
  ]

  // Lesson requests
  const [tab, setTab] = useState('calendar') // 'calendar' | 'requests'
  const [requests, setRequests] = useState([])
  const [reqForm, setReqForm] = useState(BLANK_REQ)
  const [reqModal, setReqModal] = useState(false)
  const [reqSaving, setReqSaving] = useState(false)
  const [reqError, setReqError] = useState('')

  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const isStudent = profile?.role === 'student'
  const canEdit = isAdmin || isInstructor

  const year = current.getFullYear()
  const month = current.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  async function loadLessons() {
    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString()
    let q = supabase
      .from('lessons')
      .select('*, student:profiles!student_id(full_name), instructor:profiles!instructor_id(full_name)')
      .gte('starts_at', start)
      .lte('starts_at', end)
    if (isInstructor) q = q.eq('instructor_id', profile.id)
    else if (!isAdmin) q = q.eq('student_id', profile.id)
    const { data } = await q
    setLessons(data ?? [])
  }

  async function loadRequests() {
    let q = supabase.from('lesson_requests')
      .select('*, student:profiles!student_id(full_name), instructor:profiles!instructor_id(full_name)')
      .order('preferred_date', { ascending: true })
    if (isStudent) q = q.eq('student_id', profile.id)
    else if (isInstructor) q = q.eq('instructor_id', profile.id)
    const { data } = await q
    setRequests(data ?? [])
  }

  useEffect(() => { loadLessons() }, [year, month, profile])
  useEffect(() => { if (profile) loadRequests() }, [profile])

  useEffect(() => {
    if (!canEdit) return
    supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
      .then(({ data }) => setStudents(data ?? []))
    supabase.from('profiles').select('id, full_name').eq('role', 'instructor').order('full_name')
      .then(({ data }) => setInstructors(data ?? []))
  }, [canEdit])

  useEffect(() => {
    supabase.from('aircraft').select('id, tail_number, make, model, status').order('tail_number')
      .then(({ data }) => setAircraft(data ?? []))
  }, [])

  function lessonsOnDay(day) {
    return lessons.filter(l => {
      const d = new Date(l.starts_at)
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year
    })
  }

  function prevMonth() { setCurrent(new Date(year, month - 1, 1)) }
  function nextMonth() { setCurrent(new Date(year, month + 1, 1)) }

  function openCreate(day) {
    if (!canEdit) return
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setForm({ ...BLANK_FORM, date: dateStr, instructor_id: isInstructor ? profile.id : '' })
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(lesson, e) {
    e.stopPropagation()
    if (!canEdit) return
    const start = new Date(lesson.starts_at)
    const end = new Date(lesson.ends_at)
    setForm({
      student_id: lesson.student_id ?? '',
      instructor_id: lesson.instructor_id ?? '',
      date: start.toISOString().slice(0, 10),
      start_time: start.toTimeString().slice(0, 5),
      end_time: end.toTimeString().slice(0, 5),
      aircraft_id: lesson.aircraft_id ?? '',
      lesson_type: lesson.lesson_type ?? 'Private Pilot Training',
      debrief_notes: lesson.debrief_notes ?? '',
    })
    setFormError('')
    setModal({ mode: 'edit', lesson })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }
  function buildIso(date, time) { return new Date(`${date}T${time}:00`).toISOString() }

  async function checkConflicts(startsAt, endsAt, aircraftId, instructorId, excludeId) {
    const conflicts = []

    if (aircraftId) {
      let q = supabase.from('lessons')
        .select('id, starts_at, ends_at, student:profiles!student_id(full_name)')
        .eq('aircraft_id', aircraftId)
        .lt('starts_at', endsAt)
        .gt('ends_at', startsAt)
      if (excludeId) q = q.neq('id', excludeId)
      const { data } = await q
      if (data?.length) conflicts.push(`Aircraft conflict with ${data[0].student?.full_name ?? 'another lesson'} at ${new Date(data[0].starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    }

    if (instructorId) {
      let q = supabase.from('lessons')
        .select('id, starts_at, ends_at, student:profiles!student_id(full_name)')
        .eq('instructor_id', instructorId)
        .lt('starts_at', endsAt)
        .gt('ends_at', startsAt)
      if (excludeId) q = q.neq('id', excludeId)
      const { data } = await q
      if (data?.length) conflicts.push(`Instructor conflict with ${data[0].student?.full_name ?? 'another lesson'}`)
    }

    return conflicts
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const startsAt = buildIso(form.date, form.start_time)
    const endsAt = buildIso(form.date, form.end_time)

    if (new Date(endsAt) <= new Date(startsAt)) {
      setFormError('End time must be after start time.')
      setSaving(false)
      return
    }

    const conflicts = await checkConflicts(startsAt, endsAt, form.aircraft_id || null, form.instructor_id || null, modal.mode === 'edit' ? modal.lesson.id : null)
    if (conflicts.length) {
      setFormError('Scheduling conflict: ' + conflicts.join('; '))
      setSaving(false)
      return
    }

    const payload = {
      student_id: form.student_id || null,
      instructor_id: form.instructor_id || null,
      aircraft_id: form.aircraft_id || null,
      lesson_type: form.lesson_type || null,
      starts_at: startsAt,
      ends_at: endsAt,
    }
    let error
    if (modal.mode === 'create') {
      ;({ error } = await supabase.from('lessons').insert(payload))
    } else {
      const debriefChanged = form.debrief_notes !== (modal.lesson.debrief_notes ?? '')
      const editPayload = {
        ...payload,
        debrief_notes: form.debrief_notes || null,
        ...(debriefChanged ? { debrief_updated_at: new Date().toISOString() } : {}),
      }
      ;({ error } = await supabase.from('lessons').update(editPayload).eq('id', modal.lesson.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    loadLessons()
  }

  async function handleDelete() {
    if (!window.confirm('Delete this lesson?')) return
    await supabase.from('lessons').delete().eq('id', modal.lesson.id)
    closeModal()
    loadLessons()
  }

  // Lesson request handlers
  function openReqModal() {
    setReqForm({ ...BLANK_REQ, preferred_date: new Date().toISOString().slice(0, 10) })
    setReqError('')
    setReqModal(true)
  }

  async function handleSubmitRequest(e) {
    e.preventDefault()
    setReqSaving(true)
    setReqError('')
    const { error } = await supabase.from('lesson_requests').insert({
      student_id: profile.id,
      instructor_id: reqForm.instructor_id || null,
      preferred_date: reqForm.preferred_date,
      preferred_time: reqForm.preferred_time || null,
      lesson_type: reqForm.lesson_type,
      notes: reqForm.notes || null,
      status: 'pending',
    })
    setReqSaving(false)
    if (error) { setReqError(error.message); return }
    setReqModal(false)
    loadRequests()
  }

  async function handleApproveRequest(req) {
    const startsAt = req.preferred_time
      ? new Date(`${req.preferred_date}T${req.preferred_time}:00`).toISOString()
      : new Date(`${req.preferred_date}T09:00:00`).toISOString()
    const endsAt = new Date(new Date(startsAt).getTime() + 90 * 60000).toISOString()

    const { error: lessonErr } = await supabase.from('lessons').insert({
      student_id: req.student_id,
      instructor_id: req.instructor_id || null,
      starts_at: startsAt,
      ends_at: endsAt,
      lesson_type: req.lesson_type,
    })
    if (lessonErr) { alert(lessonErr.message); return }

    await supabase.from('lesson_requests').update({ status: 'approved' }).eq('id', req.id)

    // Notify student
    await supabase.from('notifications').insert({
      user_id: req.student_id,
      title: 'Lesson Request Approved',
      body: `Your ${req.lesson_type} request on ${new Date(req.preferred_date).toLocaleDateString()} has been approved.`,
      type: 'success',
      link: '/schedule',
    })

    loadRequests()
    loadLessons()
  }

  async function handleDeclineRequest(req) {
    if (!window.confirm('Decline this request?')) return
    await supabase.from('lesson_requests').update({ status: 'declined' }).eq('id', req.id)
    await supabase.from('notifications').insert({
      user_id: req.student_id,
      title: 'Lesson Request Declined',
      body: `Your ${req.lesson_type} request on ${new Date(req.preferred_date).toLocaleDateString()} was not approved. Please contact us for alternatives.`,
      type: 'warning',
      link: '/schedule',
    })
    loadRequests()
  }

  function openDispatch(lesson, e) {
    e.stopPropagation()
    setDispatchChecks(Object.fromEntries(DISPATCH_ITEMS.map(i => [i, false])))
    setDispatchModal(lesson)
  }

  async function handleDispatchRelease(e) {
    e.preventDefault()
    const allChecked = DISPATCH_ITEMS.every(i => dispatchChecks[i])
    if (!allChecked) { alert('All checklist items must be completed before dispatch.'); return }
    setDispatchSaving(true)
    await supabase.from('dispatch_releases').insert({
      lesson_id: dispatchModal.id,
      released_by: profile.id,
      checklist: dispatchChecks,
    })
    setDispatchSaving(false)
    setDispatchModal(null)
    alert('Dispatch release logged successfully.')
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  const availableAircraft = aircraft.filter(a => a.status === 'available')

  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Schedule</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {isStudent && (
            <button className="btn-primary-sm" onClick={openReqModal}>+ Request Lesson</button>
          )}
          {canEdit && (
            <button className="btn-primary-sm" onClick={() => openCreate(new Date().getDate())}>+ Book Lesson</button>
          )}
          {tab === 'calendar' && (
            <div className="cal-nav">
              <button className="cal-nav__btn" onClick={prevMonth}>‹</button>
              <span className="cal-nav__label">{MONTHS[month]} {year}</span>
              <button className="cal-nav__btn" onClick={nextMonth}>›</button>
            </div>
          )}
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 20 }}>
        <button className={`tab-btn${tab === 'calendar' ? ' tab-btn--active' : ''}`} onClick={() => setTab('calendar')}>Calendar</button>
        <button className={`tab-btn${tab === 'requests' ? ' tab-btn--active' : ''}`} onClick={() => setTab('requests')}>
          Lesson Requests{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {tab === 'calendar' && (
        <div className="calendar">
          <div className="calendar__header">
            {DAYS.map(d => <div key={d} className="calendar__day-label">{d}</div>)}
          </div>
          <div className="calendar__grid">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} className="calendar__cell calendar__cell--empty" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dayLessons = lessonsOnDay(day)
              const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year
              return (
                <div
                  key={day}
                  className={`calendar__cell${isToday ? ' calendar__cell--today' : ''}${canEdit ? ' calendar__cell--clickable' : ''}`}
                  onClick={() => openCreate(day)}
                >
                  <span className="calendar__cell-num">{day}</span>
                  {dayLessons.map(l => (
                    <div key={l.id} className="cal-event" onClick={e => openEdit(l, e)}>
                      <span>{new Date(l.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{l.student?.full_name ?? '—'}</span>
                      {l.lesson_type && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>{l.lesson_type}</span>}
                      {canEdit && (
                        <button
                          className="cal-dispatch-btn"
                          onClick={e => openDispatch(l, e)}
                          title="Dispatch Release"
                        >⬆ Dispatch</button>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Date</th>
                <th>Time</th>
                <th>Type</th>
                <th>Instructor</th>
                <th>Notes</th>
                <th>Status</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={canEdit ? 8 : 7} className="empty-state">No lesson requests.</td></tr>
              ) : requests.map(r => (
                <tr key={r.id}>
                  <td>{r.student?.full_name ?? '—'}</td>
                  <td>{new Date(r.preferred_date).toLocaleDateString()}</td>
                  <td>{r.preferred_time ?? '—'}</td>
                  <td>{r.lesson_type ?? '—'}</td>
                  <td>{r.instructor?.full_name ?? 'Any'}</td>
                  <td className="td-notes">{r.notes ?? '—'}</td>
                  <td>
                    <span className={
                      r.status === 'approved' ? 'badge badge--green' :
                      r.status === 'declined' ? 'badge badge--red' : 'badge badge--yellow'
                    }>{r.status}</span>
                  </td>
                  {canEdit && r.status === 'pending' && (
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-link" style={{ color: '#4ade80' }} onClick={() => handleApproveRequest(r)}>Approve</button>
                      <button className="btn-link" style={{ color: '#f87171' }} onClick={() => handleDeclineRequest(r)}>Decline</button>
                    </td>
                  )}
                  {canEdit && r.status !== 'pending' && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lesson booking/edit modal */}
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Book Lesson' : 'Edit Lesson'} onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Student</label>
                <select value={form.student_id} onChange={e => field('student_id', e.target.value)} required>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Instructor</label>
                <select value={form.instructor_id} onChange={e => field('instructor_id', e.target.value)} disabled={isInstructor}>
                  <option value="">Select instructor</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => field('date', e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={form.start_time} onChange={e => field('start_time', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input type="time" value={form.end_time} onChange={e => field('end_time', e.target.value)} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Aircraft</label>
                <select value={form.aircraft_id} onChange={e => field('aircraft_id', e.target.value)}>
                  <option value="">No aircraft</option>
                  {availableAircraft.map(a => (
                    <option key={a.id} value={a.id}>{a.tail_number}{a.make ? ` — ${a.make} ${a.model ?? ''}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Lesson Type</label>
                <select value={form.lesson_type} onChange={e => field('lesson_type', e.target.value)}>
                  {LESSON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {modal.mode === 'edit' && (
              <div className="form-group">
                <label>Debrief Notes</label>
                <textarea
                  value={form.debrief_notes}
                  onChange={e => field('debrief_notes', e.target.value)}
                  rows={4}
                  placeholder="Visible to the student on their dashboard — what went well, what to work on next…"
                />
              </div>
            )}
            <div className="modal-form__actions">
              {modal.mode === 'edit' && isAdmin && (
                <button type="button" className="btn-danger" onClick={handleDelete}>Delete</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal.mode === 'create' ? 'Book Lesson' : 'Save Changes'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Dispatch release modal */}
      {dispatchModal && (
        <Modal title={`Dispatch Release — ${dispatchModal.student?.full_name ?? 'Lesson'}`} onClose={() => setDispatchModal(null)}>
          <form onSubmit={handleDispatchRelease} className="modal-form">
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {new Date(dispatchModal.starts_at).toLocaleDateString()} at {new Date(dispatchModal.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {DISPATCH_ITEMS.map(item => (
                <label key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={dispatchChecks[item] ?? false}
                    onChange={e => setDispatchChecks(c => ({ ...c, [item]: e.target.checked }))}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  {item}
                </label>
              ))}
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setDispatchModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={dispatchSaving || !DISPATCH_ITEMS.every(i => dispatchChecks[i])}>
                  {dispatchSaving ? 'Logging…' : 'Release for Flight'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Lesson request modal (student) */}
      {reqModal && (
        <Modal title="Request a Lesson" onClose={() => setReqModal(false)}>
          <form onSubmit={handleSubmitRequest} className="modal-form">
            {reqError && <div className="form-error">{reqError}</div>}
            <div className="form-group">
              <label>Preferred Instructor (optional)</label>
              <select value={reqForm.instructor_id} onChange={e => setReqForm(f => ({ ...f, instructor_id: e.target.value }))}>
                <option value="">No preference</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Preferred Date</label>
                <input type="date" value={reqForm.preferred_date} onChange={e => setReqForm(f => ({ ...f, preferred_date: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Preferred Time</label>
                <input type="time" value={reqForm.preferred_time} onChange={e => setReqForm(f => ({ ...f, preferred_time: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label>Lesson Type</label>
              <select value={reqForm.lesson_type} onChange={e => setReqForm(f => ({ ...f, lesson_type: e.target.value }))}>
                {LESSON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea value={reqForm.notes} onChange={e => setReqForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any specific goals or notes for this lesson…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setReqModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={reqSaving}>{reqSaving ? 'Submitting…' : 'Submit Request'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
