import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const DOC_TYPES = [
  { value: 'medical_1', label: '1st Class Medical' },
  { value: 'medical_2', label: '2nd Class Medical' },
  { value: 'medical_3', label: '3rd Class Medical' },
  { value: 'student_pilot_cert', label: 'Student Pilot Certificate' },
  { value: 'private_cert', label: 'Private Pilot Certificate' },
  { value: 'instrument_rating', label: 'Instrument Rating' },
  { value: 'commercial_cert', label: 'Commercial Certificate' },
  { value: 'atp_cert', label: 'ATP Certificate' },
  { value: 'flight_review', label: 'Flight Review' },
  { value: 'knowledge_test', label: 'Knowledge Test Results' },
  { value: 'other', label: 'Other' },
]

function typeLabel(val) {
  return DOC_TYPES.find(d => d.value === val)?.label ?? val
}

function fileIcon(name) {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️'
  return '📎'
}

export default function Documents() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'

  const [docs, setDocs] = useState([])
  const [students, setStudents] = useState([])
  const [selectedStudent, setSelectedStudent] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // 'upload'
  const [docType, setDocType] = useState('medical_3')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef()

  const viewingId = isAdmin || isInstructor ? selectedStudent : profile?.id

  useEffect(() => {
    if (!profile) return
    if (isAdmin) {
      supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
        .then(({ data }) => setStudents(data ?? []))
    } else if (isInstructor) {
      supabase.from('lessons').select('student_id, student:profiles!student_id(id, full_name)').eq('instructor_id', profile.id)
        .then(({ data }) => {
          const seen = new Set()
          const unique = []
          for (const l of data ?? []) {
            if (l.student && !seen.has(l.student.id)) { seen.add(l.student.id); unique.push(l.student) }
          }
          setStudents(unique.sort((a, b) => a.full_name.localeCompare(b.full_name)))
        })
    }
  }, [profile])

  useEffect(() => {
    if (!viewingId) { setDocs([]); setLoading(false); return }
    loadDocs(viewingId)
  }, [viewingId])

  async function loadDocs(studentId) {
    setLoading(true)
    const { data } = await supabase
      .from('student_documents')
      .select('*, uploader:uploaded_by(full_name)')
      .eq('student_id', studentId)
      .order('uploaded_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }

  async function openUpload() {
    setDocType('medical_3')
    setNotes('')
    setFile(null)
    setUploadError('')
    setModal('upload')
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) { setUploadError('Please select a file.'); return }
    const targetId = (isAdmin && selectedStudent) ? selectedStudent : profile.id
    if (!targetId) { setUploadError('Select a student first.'); return }
    setUploading(true)
    setUploadError('')

    const path = `${targetId}/${Date.now()}_${file.name}`
    const { error: storageErr } = await supabase.storage.from('student-docs').upload(path, file, { upsert: false })
    if (storageErr) { setUploading(false); setUploadError(storageErr.message); return }

    const { error: dbErr } = await supabase.from('student_documents').insert({
      student_id: targetId,
      doc_type: docType,
      file_name: file.name,
      file_path: path,
      notes: notes || null,
      uploaded_by: profile.id,
    })
    setUploading(false)
    if (dbErr) { setUploadError(dbErr.message); return }
    setModal(null)
    loadDocs(targetId)
  }

  async function handleDownload(doc) {
    const { data } = await supabase.storage.from('student-docs').createSignedUrl(doc.file_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from('student-docs').remove([doc.file_path])
    await supabase.from('student_documents').delete().eq('id', doc.id)
    loadDocs(viewingId)
  }

  const grouped = docs.reduce((acc, d) => {
    const t = d.doc_type
    if (!acc[t]) acc[t] = []
    acc[t].push(d)
    return acc
  }, {})

  const canUpload = isAdmin || (!isInstructor)
  const studentName = isAdmin && selectedStudent
    ? students.find(s => s.id === selectedStudent)?.full_name
    : profile?.full_name

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Documents</h2>
          {studentName && <p className="page-sub">{isAdmin && selectedStudent ? studentName : 'My Documents'}</p>}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {(isAdmin || isInstructor) && (
            <select className="select-input" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
          {canUpload && (!isAdmin || selectedStudent || !isAdmin) && (
            <button className="btn-primary-sm" onClick={openUpload}>+ Upload Document</button>
          )}
        </div>
      </div>

      {!viewingId ? (
        <p className="empty-state">{isAdmin || isInstructor ? 'Select a student to view their documents.' : 'No documents yet.'}</p>
      ) : loading ? (
        <p className="empty-state">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <p>No documents uploaded yet.</p>
          {canUpload && <button className="btn-primary-sm" onClick={openUpload}>Upload First Document</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h3 className="section-label" style={{ marginBottom: 12 }}>{typeLabel(type)}</h3>
              <div className="doc-grid">
                {items.map(doc => (
                  <div key={doc.id} className="doc-card">
                    <div className="doc-card__icon">{fileIcon(doc.file_name)}</div>
                    <div className="doc-card__body">
                      <p className="doc-card__name">{doc.file_name}</p>
                      {doc.notes && <p className="doc-card__notes">{doc.notes}</p>}
                      <p className="doc-card__meta">
                        {new Date(doc.uploaded_at).toLocaleDateString()}
                        {doc.uploader?.full_name && ` · ${doc.uploader.full_name}`}
                      </p>
                    </div>
                    <div className="doc-card__actions">
                      <button className="btn-link" onClick={() => handleDownload(doc)}>Download</button>
                      {(isAdmin || doc.uploaded_by === profile?.id) && (
                        <button className="btn-link" style={{ color: '#f87171' }} onClick={() => handleDelete(doc)}>Delete</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'upload' && (
        <Modal title="Upload Document" onClose={() => setModal(null)}>
          <form onSubmit={handleUpload} className="modal-form">
            {uploadError && <div className="form-error">{uploadError}</div>}
            {isAdmin && (
              <div className="form-group">
                <label>Student</label>
                <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)} required>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Document Type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>File</label>
              <div
                className={`file-drop${file ? ' file-drop--has-file' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={ev => ev.preventDefault()}
                onDrop={ev => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) setFile(f) }}
              >
                {file ? (
                  <p className="file-drop__name">{fileIcon(file.name)} {file.name}</p>
                ) : (
                  <>
                    <p className="file-drop__prompt">Click or drag a file here</p>
                    <p className="file-drop__hint">PDF, JPG, PNG supported · Max 10 MB</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" style={{ display: 'none' }}
                  onChange={e => setFile(e.target.files[0] ?? null)} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes (optional)</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Expires Jan 2027" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
