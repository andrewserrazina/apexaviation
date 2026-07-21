import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import CalendarGrid from '../components/CalendarGrid'
import { supabase } from '../lib/supabase'
import { PRIVATE_PILOT_COURSE, getPrivatePilotLesson, privatePilotLessons } from '../data/privatePilotCurriculum'

/**
 * @typedef {Object} CurriculumLesson
 * @property {string} id
 * @property {string} courseId
 * @property {string} moduleId
 * @property {string} moduleTitle
 * @property {string} title
 * @property {string} overview
 */

/**
 * @typedef {Object} ScheduledClass
 * @property {string} id
 * @property {string} course_id
 * @property {string} lesson_id
 * @property {string} lesson_title
 * @property {string} title
 * @property {string} description
 * @property {string} class_date
 * @property {string} start_time
 * @property {string} end_time
 * @property {string} timezone
 * @property {string} instructor_name
 * @property {string | null} instructor_id
 * @property {string} meeting_url
 * @property {number} capacity
 * @property {number} enrolled_count
 * @property {'draft' | 'published' | 'canceled' | 'completed'} status
 */

const TIME_ZONES = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'UTC']
const STATUS_OPTIONS = ['draft', 'published', 'canceled', 'completed']
const ATTENDANCE_OPTIONS = ['registered', 'attended', 'no_show']

const BLANK_FORM = {
  lesson_id: '',
  title: '',
  description: '',
  class_date: '',
  // Framework's own Class Duration Recommendation: 2 hours per session,
  // matching Apex's existing weeknight 7:00-9:00 PM virtual ground
  // school window. Pre-filled as a starting point, not enforced --
  // admins can still set any time.
  start_time: '19:00',
  end_time: '21:00',
  timezone: 'America/Chicago',
  instructor_id: '',
  instructor_name: '',
  meeting_url: '',
  // Framework's own Student Capacity Recommendation: 4-10 students per
  // cohort, 8 is the sweet spot for a single-instructor Austin cohort.
  capacity: 8,
  status: 'draft',
}

function formatDateTime(row) {
  if (!row.class_date || !row.start_time) return 'Date TBD'
  const start = new Date(`${row.class_date}T${row.start_time}`)
  const end = row.end_time ? new Date(`${row.class_date}T${row.end_time}`) : null
  const date = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const startTime = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const endTime = end?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${startTime}${endTime ? `–${endTime}` : ''}`
}

function normalizeTime(time) {
  return time?.slice(0, 5) ?? ''
}

function validateClass(form, targetStatus = form.status) {
  const errors = []
  // Lesson/description are not required here (unlike the DB's not-null
  // columns) -- Quick Add mode auto-fills both from the title in
  // payloadFor, so a curriculum lesson is optional, not mandatory, for a
  // fast draft. Full-mode admins can still fill them in normally.
  if (!form.title.trim()) errors.push('Class title is required.')
  if (!form.class_date) errors.push('Date is required.')
  if (!form.start_time) errors.push('Start time is required.')
  if (!form.end_time) errors.push('End time is required.')
  if (!form.timezone) errors.push('Time zone is required.')
  if (!Number.isFinite(Number(form.capacity)) || Number(form.capacity) <= 0) errors.push('Capacity must be positive.')
  if (form.start_time && form.end_time && form.end_time <= form.start_time) errors.push('End time must be after start time.')

  if (targetStatus === 'published') {
    if (!form.class_date || !form.start_time || !form.end_time) errors.push('Published classes must have a date and time.')
    if (!form.instructor_name.trim()) errors.push('Published classes must have an instructor.')
    if (!form.meeting_url.trim()) errors.push('Published classes must have a meeting link.')
  }

  return errors
}

export default function AdminGroundSchoolSchedule() {
  const [classes, setClasses] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [activeClass, setActiveClass] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('table') // 'table' | 'calendar'
  const [quickMode, setQuickMode] = useState(true)

  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState('')
  const [rosterSavingId, setRosterSavingId] = useState(null)

  const upcomingClasses = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return classes.filter(row => row.class_date >= today && row.status !== 'canceled').slice(0, 8)
  }, [classes])

  async function load() {
    setLoading(true)
    const [{ data: rows, error }, { data: instructorRows }] = await Promise.all([
      supabase
        .from('scheduled_ground_classes')
        .select('*')
        .order('class_date', { ascending: true })
        .order('start_time', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['admin', 'instructor'])
        .order('full_name'),
    ])

    if (error) setNotice(error.message)
    setClasses(rows ?? [])
    setInstructors(instructorRows ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function field(key, value) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function selectLesson(lessonId) {
    const lesson = getPrivatePilotLesson(lessonId)
    if (!lesson) {
      field('lesson_id', lessonId)
      return
    }
    setForm(current => ({
      ...current,
      lesson_id: lesson.id,
      title: current.title || lesson.title,
      description: current.description || lesson.overview,
    }))
  }

  function selectInstructor(instructorId) {
    const instructor = instructors.find(item => item.id === instructorId)
    setForm(current => ({
      ...current,
      instructor_id: instructorId,
      instructor_name: instructor?.full_name ?? current.instructor_name,
    }))
  }

  function openCreate() {
    setActiveClass(null)
    setForm(BLANK_FORM)
    setQuickMode(true)
    setFormError('')
    setNotice('')
    setModal('edit')
  }

  // Clicking a day on the calendar view is the same Quick Add flow as
  // "+ Schedule Class", just pre-filled with the clicked date.
  function openCreateOnDate(date) {
    setActiveClass(null)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    setForm({ ...BLANK_FORM, class_date: dateStr })
    setQuickMode(true)
    setFormError('')
    setNotice('')
    setModal('edit')
  }

  function openEdit(row) {
    setActiveClass(row)
    setForm({
      lesson_id: row.lesson_id ?? '',
      title: row.title ?? '',
      description: row.description ?? '',
      class_date: row.class_date ?? '',
      start_time: normalizeTime(row.start_time),
      end_time: normalizeTime(row.end_time),
      timezone: row.timezone ?? 'America/Chicago',
      instructor_id: row.instructor_id ?? '',
      instructor_name: row.instructor_name ?? '',
      meeting_url: row.meeting_url ?? '',
      capacity: row.capacity ?? 8,
      status: row.status ?? 'draft',
    })
    setQuickMode(false)
    setFormError('')
    setNotice('')
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setActiveClass(null)
    setFormError('')
  }

  function payloadFor(targetStatus) {
    const lesson = getPrivatePilotLesson(form.lesson_id)
    return {
      course_id: PRIVATE_PILOT_COURSE.id,
      lesson_id: form.lesson_id || '',
      lesson_title: lesson?.title ?? form.title.trim(),
      module_id: lesson?.moduleId ?? null,
      module_title: lesson?.moduleTitle ?? null,
      title: form.title.trim(),
      // Quick Add hides the description field -- default it to the title
      // rather than leaving the not-null DB column empty.
      description: form.description.trim() || form.title.trim(),
      class_date: form.class_date,
      start_time: form.start_time,
      end_time: form.end_time,
      timezone: form.timezone,
      instructor_id: form.instructor_id || null,
      instructor_name: form.instructor_name.trim() || null,
      meeting_url: form.meeting_url.trim() || null,
      capacity: Number(form.capacity),
      status: targetStatus,
    }
  }

  async function saveClass(targetStatus = form.status) {
    const errors = validateClass(form, targetStatus)
    if (errors.length) {
      setFormError(errors[0])
      return
    }

    setSaving(true)
    setFormError('')
    const payload = payloadFor(targetStatus)
    const result = activeClass
      ? await supabase.from('scheduled_ground_classes').update(payload).eq('id', activeClass.id)
      : await supabase.from('scheduled_ground_classes').insert(payload)

    setSaving(false)
    if (result.error) {
      setFormError(result.error.message)
      return
    }

    setNotice(targetStatus === 'published' ? 'Class published.' : 'Class saved.')
    closeModal()
    load()
  }

  async function cancelClass(row) {
    if (!window.confirm(`Cancel "${row.title}"? Students will no longer see it on their dashboard.`)) return
    const { error } = await supabase.from('scheduled_ground_classes').update({ status: 'canceled' }).eq('id', row.id)
    if (error) {
      setNotice(error.message)
      return
    }
    setNotice('Class canceled.')
    load()
  }

  async function openRoster(row) {
    setActiveClass(row)
    setModal('roster')
    setRosterError('')
    await loadRoster(row.id)
  }

  async function loadRoster(classId) {
    setRosterLoading(true)
    const { data, error } = await supabase
      .from('scheduled_ground_class_enrollments')
      .select('*')
      .eq('scheduled_ground_class_id', classId)
      .order('registered_at')
    if (error) setRosterError(error.message)
    else setRoster(data ?? [])
    setRosterLoading(false)
  }

  async function updateAttendance(enrollment, status) {
    setRosterSavingId(enrollment.id)
    const { error } = await supabase
      .from('scheduled_ground_class_enrollments')
      .update({ attendance_status: status, updated_at: new Date().toISOString() })
      .eq('id', enrollment.id)
    setRosterSavingId(null)
    if (error) { setRosterError(error.message); return }
    await loadRoster(activeClass.id)
  }

  async function cancelEnrollment(enrollment) {
    if (!window.confirm(`Cancel ${enrollment.full_name}'s enrollment and free their seat? This does not issue a Stripe refund -- do that separately in the Stripe dashboard if one is owed.`)) return
    setRosterSavingId(enrollment.id)
    const { error } = await supabase.rpc('cancel_scheduled_ground_class_enrollment', { p_enrollment_id: enrollment.id })
    setRosterSavingId(null)
    if (error) { setRosterError(error.message); return }
    await loadRoster(activeClass.id)
    load()
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Admin</p>
          <h2 className="page-title">Ground School Schedule</h2>
          <p className="page-sub">Schedule live Private Pilot classes from the approved Apex Advantage curriculum.</p>
        </div>
        <button className="btn-primary-sm" onClick={openCreate}>+ Quick Add Class</button>
      </div>

      {notice && <div className="form-success" style={{ marginBottom: 18 }}>{notice}</div>}

      <div className="tab-bar" style={{ marginBottom: 20 }}>
        <button className={`tab-btn${view === 'table' ? ' tab-btn--active' : ''}`} onClick={() => setView('table')}>Table</button>
        <button className={`tab-btn${view === 'calendar' ? ' tab-btn--active' : ''}`} onClick={() => setView('calendar')}>Calendar</button>
      </div>

      {view === 'calendar' ? (
        <section className="card" style={{ marginBottom: 24 }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>Click a day to quick-add a class, or click a class to edit it.</p>
          <CalendarGrid
            events={classes.filter(row => row.status !== 'canceled')}
            getEventDate={row => new Date(`${row.class_date}T${row.start_time}`)}
            onDayClick={openCreateOnDate}
            renderEvent={row => (
              <div
                key={row.id}
                className="cal-event"
                onClick={e => { e.stopPropagation(); openEdit(row) }}
                style={row.status === 'draft' ? { borderLeftColor: 'var(--muted)' } : undefined}
              >
                <span>{new Date(`${row.class_date}T${row.start_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{row.title}</span>
                {row.status === 'draft' && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>Draft</span>}
              </div>
            )}
          />
        </section>
      ) : (
        <section className="card" style={{ marginBottom: 24 }}>
          <h3 className="card__title">Upcoming Scheduled Classes</h3>
          {loading ? (
            <p className="empty-state">Loading scheduled classes…</p>
          ) : upcomingClasses.length === 0 ? (
            <div className="empty-state-block">
              <h3>No upcoming ground school classes</h3>
              <p>Create a draft or publish the next Private Pilot class.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Lesson</th>
                    <th>Date / Time</th>
                    <th>Instructor</th>
                    <th>Capacity</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingClasses.map(row => (
                    <tr key={row.id}>
                      <td><strong>{row.title}</strong></td>
                      <td>{row.module_id ? `${row.module_id} · ` : ''}{row.lesson_title}</td>
                      <td>{formatDateTime(row)}<br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{row.timezone}</span></td>
                      <td>{row.instructor_name ?? 'TBD'}</td>
                      <td>{row.enrolled_count ?? 0}/{row.capacity}</td>
                      <td><span className={`status-badge status-badge--${row.status === 'published' ? 'success' : 'warning'}`}>{row.status}</span></td>
                      <td>
                        <div className="action-row">
                          <button className="btn-link" onClick={() => openRoster(row)}>Roster{row.enrolled_count ? ` (${row.enrolled_count})` : ''}</button>
                          <button className="btn-link" onClick={() => openEdit(row)}>Edit</button>
                          {row.status !== 'canceled' && <button className="btn-link" onClick={() => cancelClass(row)}>Cancel</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h3 className="card__title">Private Pilot Curriculum Source</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
          Class lesson options are structured from PrivateCurriculum.md. Update that source document first when curriculum changes.
        </p>
        <div className="curriculum-chip-grid">
          {privatePilotLessons.map(lesson => (
            <button key={lesson.id} className="curriculum-chip" onClick={() => { openCreate(); setQuickMode(false); selectLesson(lesson.id) }}>
              <span>{lesson.moduleId}</span>
              {lesson.title}
            </button>
          ))}
        </div>
      </section>

      {modal === 'edit' && (
        <Modal title={activeClass ? 'Edit Ground School Class' : 'Schedule Ground School Class'} onClose={closeModal}>
          <form className="modal-form" onSubmit={e => { e.preventDefault(); saveClass(form.status) }}>
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Course</label>
                <input type="text" value="Private Pilot" disabled />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => field('status', e.target.value)}>
                  {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
            </div>

            {!quickMode && (
              <div className="form-group">
                <label>Lesson / Module</label>
                <select value={form.lesson_id} onChange={e => selectLesson(e.target.value)}>
                  <option value="">No curriculum lesson (freeform class)</option>
                  {privatePilotLessons.map(lesson => (
                    <option key={lesson.id} value={lesson.id}>{lesson.phase} — {lesson.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Class Title</label>
              <input type="text" value={form.title} onChange={e => field('title', e.target.value)} required />
            </div>

            {!quickMode && (
              <div className="form-group">
                <label>Description / Overview</label>
                <textarea value={form.description} onChange={e => field('description', e.target.value)} rows={3} placeholder="Defaults to the class title if left blank" />
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={form.class_date} onChange={e => field('class_date', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={form.start_time} onChange={e => field('start_time', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input type="time" value={form.end_time} onChange={e => field('end_time', e.target.value)} required />
              </div>
            </div>

            {!quickMode && (
              <div className="form-row">
                <div className="form-group">
                  <label>Time Zone</label>
                  <select value={form.timezone} onChange={e => field('timezone', e.target.value)} required>
                    {TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Capacity</label>
                  <input type="number" min="1" value={form.capacity} onChange={e => field('capacity', e.target.value)} required />
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Instructor Profile</label>
                <select value={form.instructor_id} onChange={e => selectInstructor(e.target.value)}>
                  <option value="">Manual / TBD</option>
                  {instructors.map(instructor => <option key={instructor.id} value={instructor.id}>{instructor.full_name}</option>)}
                </select>
              </div>
              {!quickMode && (
                <div className="form-group">
                  <label>Instructor Name</label>
                  <input type="text" value={form.instructor_name} onChange={e => field('instructor_name', e.target.value)} placeholder="Required before publishing" />
                </div>
              )}
            </div>

            {!quickMode && (
              <div className="form-group">
                <label>Meeting Link</label>
                <input type="url" value={form.meeting_url} onChange={e => field('meeting_url', e.target.value)} placeholder="Required before publishing" />
              </div>
            )}

            {quickMode && (
              <button type="button" className="btn-link" style={{ marginBottom: 12 }} onClick={() => setQuickMode(false)}>
                + Show all fields (lesson, description, capacity, meeting link…)
              </button>
            )}

            <div className="modal-form__actions">
              <button type="button" className="btn-secondary" onClick={closeModal}>Close</button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" disabled={saving} onClick={() => saveClass('draft')}>Save Draft</button>
                <button type="button" className="btn-primary-sm" disabled={saving} onClick={() => saveClass('published')}>Publish</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Status'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'roster' && activeClass && (
        <Modal title={`Roster — ${activeClass.title}`} onClose={closeModal} wide>
          <div className="modal-form">
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              {formatDateTime(activeClass)} · {activeClass.enrolled_count ?? 0}/{activeClass.capacity} enrolled
            </p>
            {rosterError && <div className="form-error" style={{ marginBottom: 12 }}>{rosterError}</div>}
            {rosterLoading ? (
              <p className="empty-state">Loading roster…</p>
            ) : roster.length === 0 ? (
              <div className="empty-state-block">
                <h3>No one enrolled yet</h3>
                <p>Registrations will show up here as students pay for a seat.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Payment</th>
                      <th>Attendance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map(enrollment => (
                      <tr key={enrollment.id}>
                        <td><strong>{enrollment.full_name}</strong></td>
                        <td>{enrollment.email}</td>
                        <td>
                          <span className={`status-badge status-badge--${enrollment.payment_status === 'paid' ? 'success' : 'warning'}`}>
                            {enrollment.payment_status}
                          </span>
                        </td>
                        <td>
                          <select
                            value={enrollment.attendance_status}
                            disabled={enrollment.payment_status === 'canceled' || rosterSavingId === enrollment.id}
                            onChange={e => updateAttendance(enrollment, e.target.value)}
                          >
                            {ATTENDANCE_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                            {enrollment.attendance_status === 'canceled' && <option value="canceled">canceled</option>}
                          </select>
                        </td>
                        <td>
                          {enrollment.payment_status !== 'canceled' && (
                            <button
                              className="btn-link"
                              disabled={rosterSavingId === enrollment.id}
                              onClick={() => cancelEnrollment(enrollment)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-form__actions">
              <button type="button" className="btn-secondary" onClick={closeModal}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
