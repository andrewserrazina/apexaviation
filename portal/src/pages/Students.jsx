import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const CERT_OPTIONS = ['None', 'Student Pilot', 'Private Pilot', 'Instrument Rating', 'Commercial Pilot', 'ATP']

const BLANK_EDIT = { full_name: '', email: '', certificate_status: 'None', medical_expiry: '' }
const BLANK_CREATE = { full_name: '', email: '', password: '', certificate_status: 'None', medical_expiry: '' }

export default function Students() {
  const [students, setStudents] = useState([])
  const [syllabi, setSyllabi] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_EDIT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Enrollment modal
  const [enrollModal, setEnrollModal] = useState(null) // { student }
  const [enrollments, setEnrollments] = useState([]) // current student_syllabi for selected student
  const [enrollSaving, setEnrollSaving] = useState(false)

  async function load() {
    const [{ data: s }, { data: sy }] = await Promise.all([
      supabase.from('profiles').select('*, logbook_entries(duration_hours)').eq('role', 'student').order('full_name'),
      supabase.from('syllabi').select('id, title').order('title'),
    ])
    setStudents(s ?? [])
    setSyllabi(sy ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = students.filter(s =>
    s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  )

  function totalHours(student) {
    return (student.logbook_entries ?? []).reduce((sum, e) => sum + (e.duration_hours ?? 0), 0).toFixed(1)
  }

  function openCreate() {
    setForm(BLANK_CREATE)
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(student) {
    setForm({
      full_name: student.full_name ?? '',
      email: student.email ?? '',
      certificate_status: student.certificate_status ?? 'None',
      medical_expiry: student.medical_expiry ?? '',
    })
    setFormError('')
    setModal({ mode: 'edit', student })
  }

  async function openEnroll(student) {
    const { data } = await supabase.from('student_syllabi').select('syllabus_id').eq('student_id', student.id)
    setEnrollments((data ?? []).map(e => e.syllabus_id))
    setEnrollModal({ student })
  }

  function closeModal() { setModal(null); setFormError('') }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const { data: { session: adminSession } } = await supabase.auth.getSession()
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } },
    })
    if (adminSession) await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token })
    if (error) { setSaving(false); setFormError(error.message); return }
    if (data.user) {
      await supabase.from('profiles').update({
        full_name: form.full_name,
        role: 'student',
        certificate_status: form.certificate_status || null,
        medical_expiry: form.medical_expiry || null,
      }).eq('id', data.user.id)
    }
    setSaving(false)
    closeModal()
    load()
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const { error } = await supabase.from('profiles').update({
      full_name: form.full_name,
      certificate_status: form.certificate_status || null,
      medical_expiry: form.medical_expiry || null,
    }).eq('id', modal.student.id)
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    load()
  }

  async function handleEnrollSave() {
    setEnrollSaving(true)
    const studentId = enrollModal.student.id

    // Get existing
    const { data: existing } = await supabase.from('student_syllabi').select('syllabus_id').eq('student_id', studentId)
    const existingIds = (existing ?? []).map(e => e.syllabus_id)

    // Insert new
    const toAdd = enrollments.filter(id => !existingIds.includes(id))
    const toRemove = existingIds.filter(id => !enrollments.includes(id))

    if (toAdd.length) {
      await supabase.from('student_syllabi').insert(toAdd.map(syllabus_id => ({ student_id: studentId, syllabus_id })))
    }
    if (toRemove.length) {
      for (const sid of toRemove) {
        await supabase.from('student_syllabi').delete().eq('student_id', studentId).eq('syllabus_id', sid)
      }
    }

    setEnrollSaving(false)
    setEnrollModal(null)
  }

  function toggleEnroll(syllabusId) {
    setEnrollments(prev =>
      prev.includes(syllabusId) ? prev.filter(id => id !== syllabusId) : [...prev, syllabusId]
    )
  }

  function field(key, value) { setForm(f => ({ ...f, [key]: value })) }

  const certExpiring = (exp) => {
    if (!exp) return false
    const days = (new Date(exp) - new Date()) / 86400000
    return days >= 0 && days <= 60
  }

  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Students</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input className="search-input" type="search" placeholder="Search students…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn-primary-sm" onClick={openCreate}>+ Add Student</button>
        </div>
      </div>

      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Certificate</th>
                <th>Medical Expiry</th>
                <th>Total Hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">No students found.</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.full_name}</strong></td>
                  <td>{s.email}</td>
                  <td><span className="badge">{s.certificate_status ?? 'None'}</span></td>
                  <td>
                    {s.medical_expiry
                      ? <span style={{ color: certExpiring(s.medical_expiry) ? '#fbbf24' : 'inherit' }}>
                          {new Date(s.medical_expiry).toLocaleDateString()}
                          {certExpiring(s.medical_expiry) && ' ⚠'}
                        </span>
                      : '—'}
                  </td>
                  <td>{totalHours(s)} hrs</td>
                  <td>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn-link" onClick={() => openEdit(s)}>Edit</button>
                      <button className="btn-link" onClick={() => openEnroll(s)}>Syllabi</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.mode === 'create' && (
        <Modal title="Add Student" onClose={closeModal}>
          <form onSubmit={handleCreate} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} required placeholder="Jane Smith" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => field('email', e.target.value)} required placeholder="jane@example.com" />
              </div>
            </div>
            <div className="form-group">
              <label>Temporary Password</label>
              <input type="password" value={form.password} onChange={e => field('password', e.target.value)} required placeholder="Min 6 characters" minLength={6} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Certificate Status</label>
                <select value={form.certificate_status} onChange={e => field('certificate_status', e.target.value)}>
                  {CERT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Medical Expiry</label>
                <input type="date" value={form.medical_expiry} onChange={e => field('medical_expiry', e.target.value)} />
              </div>
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Creating…' : 'Create Student'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === 'edit' && (
        <Modal title="Edit Student" onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} disabled className="input-disabled" />
            </div>
            <div className="form-group">
              <label>Certificate Status</label>
              <select value={form.certificate_status} onChange={e => field('certificate_status', e.target.value)}>
                {CERT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Medical Expiry</label>
              <input type="date" value={form.medical_expiry} onChange={e => field('medical_expiry', e.target.value)} />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {enrollModal && (
        <Modal title={`Syllabus Enrollment — ${enrollModal.student.full_name}`} onClose={() => setEnrollModal(null)}>
          <div className="modal-form">
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Toggle syllabi to enroll or unenroll this student. Progress is preserved when re-enrolling.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {syllabi.length === 0 ? (
                <p className="empty-state">No syllabi created yet.</p>
              ) : syllabi.map(sy => (
                <label key={sy.id} className="enroll-row">
                  <input
                    type="checkbox"
                    checked={enrollments.includes(sy.id)}
                    onChange={() => toggleEnroll(sy.id)}
                  />
                  <span>{sy.title}</span>
                </label>
              ))}
            </div>
            <div className="modal-form__actions" style={{ marginTop: 20 }}>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setEnrollModal(null)}>Cancel</button>
                <button type="button" className="btn-primary-sm" disabled={enrollSaving} onClick={handleEnrollSave}>
                  {enrollSaving ? 'Saving…' : 'Save Enrollment'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
