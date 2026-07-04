import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const FLIGHT_CATEGORIES = ['Private Pilot', 'Instrument Rating', 'Commercial Pilot', 'ATP', 'Flight Review', 'Discovery Flight', 'Other']
const GROUND_TABS = [
  { key: 'Private Pilot', label: 'Private Pilot' },
  { key: 'Instrument Rating', label: 'Instrument' },
  { key: 'Commercial Pilot', label: 'Commercial' },
]

export default function Syllabi() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const isStudent = profile?.role === 'student'
  const canEdit = isAdmin

  const [tab, setTab] = useState('flight')
  const [groundTab, setGroundTab] = useState('Private Pilot')

  const [syllabi, setSyllabi] = useState([])
  const [students, setStudents] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)

  // Ground school state
  const [groundLessons, setGroundLessons] = useState([])
  const [myEnrollment, setMyEnrollment] = useState(null)
  const [myCompletions, setMyCompletions] = useState(new Set())
  const [groundLoading, setGroundLoading] = useState(false)
  const [allEnrollments, setAllEnrollments] = useState([]) // for admin/instructor ground view
  const [allCompletions, setAllCompletions] = useState([])

  // Flight syllabus modal state
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', category: 'Private Pilot' })
  const [lessons, setLessons] = useState([])
  const [lessonForm, setLessonForm] = useState({ title: '', description: '', duration_hours: '' })
  const [editingLesson, setEditingLesson] = useState(null) // lesson being inline-edited
  const [editLessonForm, setEditLessonForm] = useState({ title: '', description: '', duration_hours: '' })
  const [enrollForm, setEnrollForm] = useState({ student_id: '', instructor_id: '' })
  const [progress, setProgress] = useState(null)
  const [materials, setMaterials] = useState([])
  const [materialFile, setMaterialFile] = useState(null)
  const [materialTitle, setMaterialTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    const { data } = await supabase.from('syllabi').select('*, syllabus_lessons(id)').order('category')
    setSyllabi(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name').then(({ data }) => setStudents(data ?? []))
    supabase.from('profiles').select('id, full_name').eq('role', 'instructor').order('full_name').then(({ data }) => setInstructors(data ?? []))
  }, [])

  useEffect(() => {
    if (tab !== 'ground' || loading) return
    loadGroundData()
  }, [tab, groundTab, loading])

  async function loadGroundData() {
    const syllabus = syllabi.find(s => s.type === 'ground' && s.category === groundTab)
    if (!syllabus) { setGroundLessons([]); setMyEnrollment(null); setMyCompletions(new Set()); return }
    setGroundLoading(true)

    const { data: ldata } = await supabase.from('syllabus_lessons').select('*').eq('syllabus_id', syllabus.id).order('sort_order')
    setGroundLessons(ldata ?? [])

    if (isStudent && profile) {
      const { data: enrollment } = await supabase.from('student_syllabi')
        .select('*').eq('syllabus_id', syllabus.id).eq('student_id', profile.id).maybeSingle()
      setMyEnrollment(enrollment ?? null)
      if (enrollment) {
        const { data: comp } = await supabase.from('lesson_completions').select('syllabus_lesson_id').eq('student_syllabus_id', enrollment.id)
        setMyCompletions(new Set((comp ?? []).map(c => c.syllabus_lesson_id)))
      } else { setMyCompletions(new Set()) }
    } else if (isAdmin || isInstructor) {
      const { data: enrollments } = await supabase.from('student_syllabi')
        .select('*, student:profiles!student_id(full_name)').eq('syllabus_id', syllabus.id)
      setAllEnrollments(enrollments ?? [])
      if (enrollments?.length) {
        const { data: comp } = await supabase.from('lesson_completions').select('*').in('student_syllabus_id', enrollments.map(e => e.id))
        setAllCompletions(comp ?? [])
      } else { setAllCompletions([]) }
    }
    setGroundLoading(false)
  }

  async function selfEnroll() {
    const syllabus = syllabi.find(s => s.type === 'ground' && s.category === groundTab)
    if (!syllabus || !profile) return
    setSaving(true)
    const { data } = await supabase.from('student_syllabi').insert({ student_id: profile.id, syllabus_id: syllabus.id }).select().maybeSingle()
    setSaving(false)
    setMyEnrollment(data)
  }

  async function toggleMyCompletion(lessonId) {
    if (!myEnrollment) return
    const done = myCompletions.has(lessonId)
    if (done) {
      await supabase.from('lesson_completions').delete().eq('student_syllabus_id', myEnrollment.id).eq('syllabus_lesson_id', lessonId)
      setMyCompletions(s => { const n = new Set(s); n.delete(lessonId); return n })
    } else {
      await supabase.from('lesson_completions').insert({ student_syllabus_id: myEnrollment.id, syllabus_lesson_id: lessonId })
      setMyCompletions(s => new Set([...s, lessonId]))
    }
  }

  async function adminToggleCompletion(enrollmentId, lessonId) {
    const done = allCompletions.some(c => c.student_syllabus_id === enrollmentId && c.syllabus_lesson_id === lessonId)
    if (done) {
      await supabase.from('lesson_completions').delete().eq('student_syllabus_id', enrollmentId).eq('syllabus_lesson_id', lessonId)
      setAllCompletions(c => c.filter(x => !(x.student_syllabus_id === enrollmentId && x.syllabus_lesson_id === lessonId)))
    } else {
      const { data } = await supabase.from('lesson_completions').insert({ student_syllabus_id: enrollmentId, syllabus_lesson_id: lessonId }).select().maybeSingle()
      if (data) setAllCompletions(c => [...c, data])
    }
  }

  function closeModal() { setModal(null); setFormError(''); setProgress(null) }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }

  // ── Flight syllabus CRUD ──
  function openCreate() {
    setForm({ name: '', description: '', category: 'Private Pilot' })
    setFormError('')
    setModal({ mode: 'syllabus-create' })
  }

  function openEdit(syllabus) {
    setForm({ name: syllabus.name, description: syllabus.description ?? '', category: syllabus.category ?? 'Private Pilot' })
    setFormError('')
    setModal({ mode: 'syllabus-edit', syllabus })
  }

  async function handleSyllabusSave(e) {
    e.preventDefault(); setSaving(true); setFormError('')
    const payload = { name: form.name, description: form.description || null, category: form.category, type: 'flight' }
    let error
    if (modal.mode === 'syllabus-create') {
      ;({ error } = await supabase.from('syllabi').insert(payload))
    } else {
      ;({ error } = await supabase.from('syllabi').update(payload).eq('id', modal.syllabus.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); load()
  }

  async function handleDeleteSyllabus() {
    if (!window.confirm('Delete this syllabus and all its lessons?')) return
    await supabase.from('syllabi').delete().eq('id', modal.syllabus.id)
    closeModal(); load()
  }

  async function openLessons(syllabus) {
    const { data } = await supabase.from('syllabus_lessons').select('*').eq('syllabus_id', syllabus.id).order('sort_order')
    setLessons(data ?? [])
    setLessonForm({ title: '', description: '', duration_hours: '' })
    setFormError('')
    setModal({ mode: 'lessons', syllabus })
  }

  async function addLesson(e) {
    e.preventDefault(); setSaving(true)
    const { error } = await supabase.from('syllabus_lessons').insert({
      syllabus_id: modal.syllabus.id,
      title: lessonForm.title,
      description: lessonForm.description || null,
      duration_hours: parseFloat(lessonForm.duration_hours) || null,
      sort_order: lessons.length,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    setLessonForm({ title: '', description: '', duration_hours: '' })
    const { data } = await supabase.from('syllabus_lessons').select('*').eq('syllabus_id', modal.syllabus.id).order('sort_order')
    setLessons(data ?? []); load()
  }

  async function deleteLesson(id) {
    if (!window.confirm('Delete this lesson?')) return
    await supabase.from('syllabus_lessons').delete().eq('id', id)
    setLessons(l => l.filter(x => x.id !== id)); load()
  }

  function startEditLesson(lesson) {
    setEditingLesson(lesson.id)
    setEditLessonForm({ title: lesson.title, description: lesson.description ?? '', duration_hours: lesson.duration_hours ?? '' })
  }

  async function saveEditLesson(id) {
    setSaving(true)
    const { error } = await supabase.from('syllabus_lessons').update({
      title: editLessonForm.title,
      description: editLessonForm.description || null,
      duration_hours: parseFloat(editLessonForm.duration_hours) || null,
    }).eq('id', id)
    setSaving(false)
    if (error) { setFormError(error.message); return }
    setLessons(l => l.map(x => x.id === id ? { ...x, title: editLessonForm.title, description: editLessonForm.description || null, duration_hours: parseFloat(editLessonForm.duration_hours) || null } : x))
    setEditingLesson(null)
  }

  async function openEnroll(syllabus) {
    setEnrollForm({ student_id: '', instructor_id: '' }); setFormError('')
    setModal({ mode: 'enroll', syllabus })
  }

  async function handleEnroll(e) {
    e.preventDefault(); setSaving(true); setFormError('')
    const { error } = await supabase.from('student_syllabi').insert({
      student_id: enrollForm.student_id,
      syllabus_id: modal.syllabus.id,
      instructor_id: enrollForm.instructor_id || null,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
  }

  async function openMaterials(syllabus) {
    const { data } = await supabase.from('training_materials').select('*, uploader:uploaded_by(full_name)').eq('syllabus_id', syllabus.id).order('uploaded_at', { ascending: false })
    setMaterials(data ?? [])
    setMaterialFile(null)
    setMaterialTitle('')
    setFormError('')
    setModal({ mode: 'materials', syllabus })
  }

  async function uploadMaterial(e) {
    e.preventDefault()
    if (!materialFile) { setFormError('Select a file.'); return }
    setSaving(true); setFormError('')
    const path = `${modal.syllabus.id}/${Date.now()}_${materialFile.name}`
    const { error: storageErr } = await supabase.storage.from('training-materials').upload(path, materialFile, { upsert: false })
    if (storageErr) { setSaving(false); setFormError(storageErr.message); return }
    const { error: dbErr } = await supabase.from('training_materials').insert({
      syllabus_id: modal.syllabus.id,
      title: materialTitle || materialFile.name,
      file_name: materialFile.name,
      file_path: path,
      uploaded_by: profile.id,
    })
    setSaving(false)
    if (dbErr) { setFormError(dbErr.message); return }
    setMaterialFile(null); setMaterialTitle('')
    const { data } = await supabase.from('training_materials').select('*, uploader:uploaded_by(full_name)').eq('syllabus_id', modal.syllabus.id).order('uploaded_at', { ascending: false })
    setMaterials(data ?? [])
  }

  async function downloadMaterial(mat) {
    const { data } = await supabase.storage.from('training-materials').createSignedUrl(mat.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteMaterial(mat) {
    if (!window.confirm(`Delete "${mat.title}"?`)) return
    await supabase.storage.from('training-materials').remove([mat.file_path])
    await supabase.from('training_materials').delete().eq('id', mat.id)
    setMaterials(m => m.filter(x => x.id !== mat.id))
  }

  async function openProgress(syllabus) {
    const { data: enrollments } = await supabase.from('student_syllabi')
      .select('*, student:profiles!student_id(full_name), instructor:profiles!instructor_id(full_name)')
      .eq('syllabus_id', syllabus.id)
    const { data: syllabusLessons } = await supabase.from('syllabus_lessons').select('*').eq('syllabus_id', syllabus.id).order('sort_order')
    const { data: completions } = await supabase.from('lesson_completions').select('*')
      .in('student_syllabus_id', (enrollments ?? []).map(e => e.id))
    setProgress({ enrollments: enrollments ?? [], lessons: syllabusLessons ?? [], completions: completions ?? [] })
    setModal({ mode: 'progress', syllabus })
  }

  async function toggleCompletion(enrollmentId, lessonId, isComplete) {
    if (isComplete) {
      await supabase.from('lesson_completions').delete().eq('student_syllabus_id', enrollmentId).eq('syllabus_lesson_id', lessonId)
    } else {
      await supabase.from('lesson_completions').insert({ student_syllabus_id: enrollmentId, syllabus_lesson_id: lessonId })
    }
    const { data } = await supabase.from('lesson_completions').select('*').in('student_syllabus_id', progress.enrollments.map(e => e.id))
    setProgress(p => ({ ...p, completions: data ?? [] }))
  }

  const flightSyllabi = syllabi.filter(s => s.type !== 'ground')
  const grouped = flightSyllabi.reduce((acc, s) => {
    const cat = s.category ?? 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  const currentGroundSyllabus = syllabi.find(s => s.type === 'ground' && s.category === groundTab)
  const groundPct = groundLessons.length > 0 ? Math.round((myCompletions.size / groundLessons.length) * 100) : 0

  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Syllabi</h2>
        {canEdit && tab === 'flight' && <button className="btn-primary-sm" onClick={openCreate}>+ New Syllabus</button>}
      </div>

      {/* Top-level tabs */}
      <div className="tab-bar" style={{ marginBottom: 28 }}>
        <button className={`tab-btn${tab === 'flight' ? ' tab-btn--active' : ''}`} onClick={() => setTab('flight')}>Flight Training</button>
        <button className={`tab-btn${tab === 'ground' ? ' tab-btn--active' : ''}`} onClick={() => setTab('ground')}>Apex Advantage Ground</button>
      </div>

      {/* ── FLIGHT TRAINING TAB ── */}
      {tab === 'flight' && (
        loading ? <p className="empty-state">Loading…</p> :
        flightSyllabi.length === 0 ? <p className="empty-state">No flight syllabi yet.</p> :
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 32 }}>
            <h3 className="section-label">{cat}</h3>
            <div className="syllabus-grid">
              {items.map(s => (
                <div key={s.id} className="syllabus-card">
                  <div className="syllabus-card__head">
                    <p className="syllabus-card__name">{s.name}</p>
                    <span className="badge">{s.syllabus_lessons?.length ?? 0} lessons</span>
                  </div>
                  {s.description && <p className="syllabus-card__desc">{s.description}</p>}
                  <div className="syllabus-card__actions">
                    <button className="btn-link" onClick={() => openLessons(s)}>Lessons</button>
                    <button className="btn-link" onClick={() => openMaterials(s)}>Materials</button>
                    <button className="btn-link" onClick={() => openProgress(s)}>Progress</button>
                    {canEdit && <>
                      <button className="btn-link" onClick={() => openEnroll(s)}>Enroll</button>
                      <button className="btn-link" onClick={() => openEdit(s)}>Edit</button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* ── APEX ADVANTAGE GROUND TAB ── */}
      {tab === 'ground' && (
        <div>
          {/* Sub-tabs */}
          <div className="pill-bar" style={{ marginBottom: 24 }}>
            {GROUND_TABS.map(t => (
              <button key={t.key} className={`pill-btn${groundTab === t.key ? ' pill-btn--active' : ''}`} onClick={() => setGroundTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {groundLoading ? <p className="empty-state">Loading…</p> : !currentGroundSyllabus ? (
            <p className="empty-state">Ground school curriculum not set up yet.</p>
          ) : (
            <div>
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 4 }}>{currentGroundSyllabus.description}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{groundLessons.length} lessons</p>
              </div>

              {/* Student: enroll prompt or progress bar */}
              {isStudent && !myEnrollment && (
                <div className="ground-enroll-banner">
                  <p>Start tracking your progress through the {groundTab} ground school curriculum.</p>
                  <button className="btn-primary-sm" onClick={selfEnroll} disabled={saving}>{saving ? 'Starting…' : 'Start Course'}</button>
                </div>
              )}

              {isStudent && myEnrollment && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{myCompletions.size} of {groundLessons.length} lessons complete</span>
                    <span className="badge badge--yellow">{groundPct}%</span>
                  </div>
                  <div className="progress-bar"><div className="progress-bar__fill" style={{ width: `${groundPct}%` }} /></div>
                </div>
              )}

              {/* Admin/Instructor: student progress summary */}
              {(isAdmin || isInstructor) && allEnrollments.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h4 className="section-label" style={{ marginBottom: 12 }}>Student Progress</h4>
                  <div className="table-wrap" style={{ marginBottom: 20 }}>
                    <table className="data-table">
                      <thead><tr><th>Student</th><th>Progress</th><th>Complete</th></tr></thead>
                      <tbody>
                        {allEnrollments.map(en => {
                          const done = allCompletions.filter(c => c.student_syllabus_id === en.id).length
                          const pct = groundLessons.length > 0 ? Math.round((done / groundLessons.length) * 100) : 0
                          return (
                            <tr key={en.id}>
                              <td>{en.student?.full_name}</td>
                              <td style={{ width: 200 }}>
                                <div className="progress-bar" style={{ marginTop: 4 }}><div className="progress-bar__fill" style={{ width: `${pct}%` }} /></div>
                              </td>
                              <td>{done}/{groundLessons.length}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lesson cards */}
              <div className="ground-lesson-list">
                {groundLessons.map((lesson, i) => {
                  const studentDone = isStudent && myCompletions.has(lesson.id)
                  return (
                    <div key={lesson.id} className={`ground-lesson-card${studentDone ? ' ground-lesson-card--done' : ''}`}>
                      <div className="ground-lesson-card__num">{i + 1}</div>
                      <div className="ground-lesson-card__body">
                        <p className="ground-lesson-card__title">{lesson.title}</p>
                        {lesson.description && <p className="ground-lesson-card__desc">{lesson.description}</p>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        {lesson.duration_hours && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{lesson.duration_hours}h</span>}
                        {isStudent && myEnrollment && (
                          <button className={`check-btn${studentDone ? ' check-btn--done' : ''}`} onClick={() => toggleMyCompletion(lesson.id)}>
                            {studentDone ? '✓' : ''}
                          </button>
                        )}
                        {(isAdmin || isInstructor) && canEdit && (
                          <button className="btn-link" style={{ fontSize: 11 }} onClick={() => {
                            // inline admin mark for... first enrolled student? For now open lessons modal
                          }}>—</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Admin: per-student completion grid */}
              {(isAdmin || isInstructor) && allEnrollments.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h4 className="section-label" style={{ marginBottom: 12 }}>Mark Completions</h4>
                  {allEnrollments.map(en => {
                    const doneIds = new Set(allCompletions.filter(c => c.student_syllabus_id === en.id).map(c => c.syllabus_lesson_id))
                    const pct = groundLessons.length > 0 ? Math.round((doneIds.size / groundLessons.length) * 100) : 0
                    return (
                      <div key={en.id} style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <p style={{ fontWeight: 600, color: 'var(--white)', fontSize: 14 }}>{en.student?.full_name}</p>
                          <span className="badge badge--yellow">{pct}%</span>
                        </div>
                        <div className="ground-lesson-list">
                          {groundLessons.map((lesson, i) => {
                            const done = doneIds.has(lesson.id)
                            return (
                              <div key={lesson.id} className={`ground-lesson-card${done ? ' ground-lesson-card--done' : ''}`} style={{ padding: '10px 16px' }}>
                                <div className="ground-lesson-card__num" style={{ width: 24, height: 24, fontSize: 11 }}>{i + 1}</div>
                                <p className="ground-lesson-card__title" style={{ flex: 1, fontSize: 13 }}>{lesson.title}</p>
                                <button className={`check-btn${done ? ' check-btn--done' : ''}`} onClick={() => adminToggleCompletion(en.id, lesson.id)}>
                                  {done ? '✓' : ''}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── FLIGHT MODALS ── */}
      {(modal?.mode === 'syllabus-create' || modal?.mode === 'syllabus-edit') && (
        <Modal title={modal.mode === 'syllabus-create' ? 'New Syllabus' : 'Edit Syllabus'} onClose={closeModal}>
          <form onSubmit={handleSyllabusSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={form.name} onChange={e => field('name', e.target.value)} required placeholder="e.g. Private Pilot Course" />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={e => field('category', e.target.value)}>
                {FLIGHT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => field('description', e.target.value)} rows={3} placeholder="Optional overview…" />
            </div>
            <div className="modal-form__actions">
              {modal.mode === 'syllabus-edit' && <button type="button" className="btn-danger" onClick={handleDeleteSyllabus}>Delete</button>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal.mode === 'syllabus-create' ? 'Create' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === 'lessons' && (
        <Modal title={`Lessons — ${modal.syllabus.name}`} onClose={closeModal}>
          <div style={{ marginBottom: 16 }}>
            {lessons.length === 0
              ? <p className="empty-state" style={{ padding: '12px 0' }}>No lessons yet.</p>
              : lessons.map((l, i) => (
                <div key={l.id}>
                  {editingLesson === l.id ? (
                    <div className="lesson-edit-row">
                      <span className="lesson-edit-row__num">{i + 1}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input
                          className="lesson-edit-input"
                          value={editLessonForm.title}
                          onChange={e => setEditLessonForm(f => ({ ...f, title: e.target.value }))}
                          placeholder="Lesson title"
                          autoFocus
                        />
                        <input
                          className="lesson-edit-input"
                          value={editLessonForm.description}
                          onChange={e => setEditLessonForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="Description (optional)"
                        />
                        <input
                          className="lesson-edit-input lesson-edit-input--sm"
                          type="number" step="0.1" min="0"
                          value={editLessonForm.duration_hours}
                          onChange={e => setEditLessonForm(f => ({ ...f, duration_hours: e.target.value }))}
                          placeholder="Duration (hrs)"
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignSelf: 'flex-start', paddingTop: 2 }}>
                        <button className="btn-primary-sm" onClick={() => saveEditLesson(l.id)} disabled={saving} style={{ padding: '6px 12px', fontSize: 12 }}>{saving ? '…' : 'Save'}</button>
                        <button className="btn-secondary" onClick={() => setEditingLesson(null)} style={{ padding: '6px 12px', fontSize: 12 }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="activity-row">
                      <div style={{ flex: 1 }}>
                        <p className="activity-row__primary">{i + 1}. {l.title}</p>
                        {l.description && <p className="activity-row__sub">{l.description}</p>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        {l.duration_hours && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{l.duration_hours}h</span>}
                        {canEdit && <>
                          <button className="btn-link" onClick={() => startEditLesson(l)}>Edit</button>
                          <button className="btn-link" style={{ color: '#f87171' }} onClick={() => deleteLesson(l.id)}>Delete</button>
                        </>}
                      </div>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
          {canEdit && (
            <form onSubmit={addLesson} className="modal-form" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              {formError && <div className="form-error">{formError}</div>}
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Add Lesson</p>
              <div className="form-group">
                <label>Title</label>
                <input type="text" value={lessonForm.title} onChange={e => setLessonForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Pre-flight Inspection" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Description</label>
                  <input type="text" value={lessonForm.description} onChange={e => setLessonForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="form-group">
                  <label>Duration (hrs)</label>
                  <input type="number" step="0.1" min="0" value={lessonForm.duration_hours} onChange={e => setLessonForm(f => ({ ...f, duration_hours: e.target.value }))} placeholder="1.0" />
                </div>
              </div>
              <div className="modal-form__actions">
                <div style={{ marginLeft: 'auto' }}>
                  <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Adding…' : '+ Add Lesson'}</button>
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}

      {modal?.mode === 'enroll' && (
        <Modal title={`Enroll Student — ${modal.syllabus.name}`} onClose={closeModal}>
          <form onSubmit={handleEnroll} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Student</label>
              <select value={enrollForm.student_id} onChange={e => setEnrollForm(f => ({ ...f, student_id: e.target.value }))} required>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Instructor (optional)</label>
              <select value={enrollForm.instructor_id} onChange={e => setEnrollForm(f => ({ ...f, instructor_id: e.target.value }))}>
                <option value="">Select instructor</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Enrolling…' : 'Enroll'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === 'materials' && (
        <Modal title={`Materials — ${modal.syllabus.name}`} onClose={closeModal}>
          <div style={{ marginBottom: 16 }}>
            {materials.length === 0
              ? <p className="empty-state" style={{ padding: '12px 0' }}>No materials uploaded yet.</p>
              : materials.map(mat => (
                <div key={mat.id} className="activity-row">
                  <div style={{ flex: 1 }}>
                    <p className="activity-row__primary">📄 {mat.title}</p>
                    <p className="activity-row__sub">{mat.file_name} · {new Date(mat.uploaded_at).toLocaleDateString()}{mat.uploader?.full_name ? ` · ${mat.uploader.full_name}` : ''}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    <button className="btn-link" onClick={() => downloadMaterial(mat)}>Download</button>
                    {canEdit && <button className="btn-link" style={{ color: '#f87171' }} onClick={() => deleteMaterial(mat)}>Delete</button>}
                  </div>
                </div>
              ))
            }
          </div>
          {canEdit && (
            <form onSubmit={uploadMaterial} className="modal-form" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              {formError && <div className="form-error">{formError}</div>}
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Upload Material</p>
              <div className="form-group">
                <label>Title</label>
                <input type="text" value={materialTitle} onChange={e => setMaterialTitle(e.target.value)} placeholder="e.g. Private Pilot Handbook Chapter 3" />
              </div>
              <div className="form-group">
                <label>File</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.pptx,.docx,.xlsx"
                  onChange={e => setMaterialFile(e.target.files[0] ?? null)}
                  style={{ color: 'var(--text)', fontSize: 13 }} />
              </div>
              <div className="modal-form__actions">
                <div style={{ marginLeft: 'auto' }}>
                  <button type="submit" className="btn-primary-sm" disabled={saving || !materialFile}>{saving ? 'Uploading…' : 'Upload'}</button>
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}

      {modal?.mode === 'progress' && progress && (
        <Modal title={`Progress — ${modal.syllabus.name}`} onClose={closeModal}>
          {progress.enrollments.length === 0
            ? <p className="empty-state">No students enrolled yet.</p>
            : progress.enrollments.map(enrollment => {
              const completedIds = new Set(progress.completions.filter(c => c.student_syllabus_id === enrollment.id).map(c => c.syllabus_lesson_id))
              const pct = progress.lessons.length > 0 ? Math.round((completedIds.size / progress.lessons.length) * 100) : 0
              return (
                <div key={enrollment.id} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <p style={{ fontWeight: 600, color: 'var(--white)' }}>{enrollment.student?.full_name}</p>
                      {enrollment.instructor && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Instructor: {enrollment.instructor.full_name}</p>}
                    </div>
                    <span className="badge badge--yellow">{pct}%</span>
                  </div>
                  <div className="progress-bar" style={{ marginBottom: 8 }}><div className="progress-bar__fill" style={{ width: `${pct}%` }} /></div>
                  {progress.lessons.map((lesson, i) => {
                    const done = completedIds.has(lesson.id)
                    return (
                      <div key={lesson.id} className="activity-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button onClick={() => canEdit && toggleCompletion(enrollment.id, lesson.id, done)}
                            style={{ background: done ? 'var(--gold)' : 'transparent', border: `2px solid ${done ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 4, width: 18, height: 18, cursor: canEdit ? 'pointer' : 'default', flexShrink: 0, color: '#080f1e', fontSize: 11 }}>
                            {done ? '✓' : ''}
                          </button>
                          <span style={{ fontSize: 13, color: done ? 'var(--muted)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none' }}>
                            {i + 1}. {lesson.title}
                          </span>
                        </div>
                        {lesson.duration_hours && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{lesson.duration_hours}h</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })
          }
        </Modal>
      )}
    </Layout>
  )
}
