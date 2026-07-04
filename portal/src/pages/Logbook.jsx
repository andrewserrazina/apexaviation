import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const BLANK = { student_id: '', instructor_id: '', date: '', aircraft_id: '', route: '', duration_hours: '', notes: '' }

function exportCSV(entries, studentName) {
  const headers = ['Date', 'Aircraft', 'Route', 'Duration (hrs)', 'Instructor', 'Notes']
  const rows = entries.map(e => [
    e.date,
    e.aircraft_id ?? '',
    e.route ?? '',
    e.duration_hours ?? '',
    e.instructor?.full_name ?? '',
    (e.notes ?? '').replace(/,/g, ';'),
  ])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `logbook_${(studentName ?? 'export').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Logbook() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [studentId, setStudentId] = useState('')
  const [students, setStudents] = useState([])
  const [instructors, setInstructors] = useState([])
  const [aircraft, setAircraft] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const canEdit = isAdmin || isInstructor

  async function loadStudents() {
    if (isAdmin) {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
      setStudents(data ?? [])
    } else if (isInstructor) {
      const { data: lessonData } = await supabase.from('lessons').select('student_id, student:profiles!student_id(id, full_name)').eq('instructor_id', profile.id)
      const seen = new Set()
      const unique = []
      for (const l of lessonData ?? []) {
        if (l.student && !seen.has(l.student.id)) { seen.add(l.student.id); unique.push(l.student) }
      }
      setStudents(unique.sort((a, b) => a.full_name.localeCompare(b.full_name)))
    }
  }

  useEffect(() => {
    if (!profile) return
    loadStudents()
    if (canEdit) {
      supabase.from('profiles').select('id, full_name').eq('role', 'instructor').order('full_name')
        .then(({ data }) => setInstructors(data ?? []))
    }
    supabase.from('aircraft').select('id, tail_number, make, model').order('tail_number')
      .then(({ data }) => setAircraft(data ?? []))
  }, [profile])

  async function loadEntries(id) {
    if (!id) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('logbook_entries')
      .select('*, instructor:profiles!instructor_id(full_name)')
      .eq('student_id', id)
      .order('date', { ascending: false })
    setEntries(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (!profile) return
    const id = canEdit ? studentId : profile.id
    loadEntries(id)
  }, [studentId, profile])

  const totalHours = entries.reduce((sum, e) => sum + (e.duration_hours ?? 0), 0).toFixed(1)

  const currentStudentName = canEdit
    ? students.find(s => s.id === studentId)?.full_name
    : profile?.full_name

  function openCreate() {
    setForm({
      ...BLANK,
      instructor_id: isInstructor ? profile.id : '',
      student_id: !canEdit ? profile.id : studentId,
      date: new Date().toISOString().slice(0, 10),
    })
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(entry) {
    if (!canEdit) return
    setForm({
      student_id: entry.student_id ?? '',
      instructor_id: entry.instructor_id ?? '',
      date: entry.date ?? '',
      aircraft_id: entry.aircraft_id ?? '',
      route: entry.route ?? '',
      duration_hours: entry.duration_hours ?? '',
      notes: entry.notes ?? '',
    })
    setFormError('')
    setModal({ mode: 'edit', entry })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const payload = {
      student_id: form.student_id || null,
      instructor_id: form.instructor_id || null,
      date: form.date,
      aircraft_id: form.aircraft_id || null,
      route: form.route || null,
      duration_hours: parseFloat(form.duration_hours) || 0,
      notes: form.notes || null,
    }
    let error
    if (modal.mode === 'create') {
      ;({ error } = await supabase.from('logbook_entries').insert(payload))
    } else {
      ;({ error } = await supabase.from('logbook_entries').update(payload).eq('id', modal.entry.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    const id = canEdit ? studentId : profile.id
    loadEntries(id)
  }

  async function handleDelete() {
    if (!window.confirm('Delete this entry?')) return
    await supabase.from('logbook_entries').delete().eq('id', modal.entry.id)
    closeModal()
    const id = canEdit ? studentId : profile.id
    loadEntries(id)
  }

  const showTable = !canEdit || studentId

  // Resolve aircraft tail from id
  function aircraftLabel(id) {
    if (!id) return '—'
    const ac = aircraft.find(a => a.id === id)
    return ac ? ac.tail_number : id
  }

  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Logbook</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {showTable && entries.length > 0 && (
            <button className="btn-secondary" onClick={() => exportCSV(entries, currentStudentName)}>Export CSV</button>
          )}
          {canEdit && showTable && (
            <button className="btn-primary-sm" onClick={openCreate}>+ Log Flight</button>
          )}
          {canEdit && (
            <select className="select-input" value={studentId} onChange={e => setStudentId(e.target.value)}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
          {!canEdit && (
            <button className="btn-primary-sm" onClick={openCreate}>+ Log Flight</button>
          )}
        </div>
      </div>

      {showTable && (
        <div className="stat-grid stat-grid--sm">
          <div className="stat-card">
            <p className="stat-card__label">Total Hours</p>
            <p className="stat-card__value">{totalHours}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Entries</p>
            <p className="stat-card__value">{entries.length}</p>
          </div>
        </div>
      )}

      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Aircraft</th>
                <th>Route</th>
                <th>Duration</th>
                <th>Instructor</th>
                <th>Notes</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={canEdit ? 7 : 6} className="empty-state">No entries yet.</td></tr>
              ) : entries.map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.date).toLocaleDateString()}</td>
                  <td>{aircraftLabel(e.aircraft_id)}</td>
                  <td>{e.route ?? '—'}</td>
                  <td>{e.duration_hours} hrs</td>
                  <td>{e.instructor?.full_name ?? '—'}</td>
                  <td className="td-notes">{e.notes ?? '—'}</td>
                  {canEdit && <td><button className="btn-link" onClick={() => openEdit(e)}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Log Flight' : 'Edit Entry'} onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            {canEdit && (
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
            )}
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={form.date} onChange={e => field('date', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Duration (hrs)</label>
                <input type="number" step="0.1" min="0" value={form.duration_hours} onChange={e => field('duration_hours', e.target.value)} required placeholder="1.5" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Aircraft</label>
                <select value={form.aircraft_id} onChange={e => field('aircraft_id', e.target.value)}>
                  <option value="">No aircraft</option>
                  {aircraft.map(a => (
                    <option key={a.id} value={a.id}>{a.tail_number}{a.make ? ` — ${a.make} ${a.model ?? ''}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Route</label>
                <input type="text" placeholder="e.g. KAUS - KSAT" value={form.route} onChange={e => field('route', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => field('notes', e.target.value)} rows={3} placeholder="Optional remarks…" />
            </div>
            <div className="modal-form__actions">
              {modal.mode === 'edit' && isAdmin && (
                <button type="button" className="btn-danger" onClick={handleDelete}>Delete</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal.mode === 'create' ? 'Log Flight' : 'Save Changes'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
