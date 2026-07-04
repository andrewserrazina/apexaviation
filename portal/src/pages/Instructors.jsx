import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const BLANK_CREATE = { full_name: '', email: '', password: '', certificates: '', bio: '' }
const BLANK_EDIT = { full_name: '', email: '', certificates: '', bio: '' }

export default function Instructors() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_EDIT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [viewModal, setViewModal] = useState(null) // { instructor } for non-admin profile view

  async function load() {
    const { data } = await supabase
      .from('profiles')
      .select('*, lessons(id)')
      .eq('role', 'instructor')
      .order('full_name')
    setInstructors(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = instructors.filter(i =>
    i.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    i.email?.toLowerCase().includes(search.toLowerCase()) ||
    i.certificates?.toLowerCase().includes(search.toLowerCase())
  )

  function openCreate() {
    setForm(BLANK_CREATE)
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(instructor) {
    setForm({
      full_name: instructor.full_name ?? '',
      email: instructor.email ?? '',
      certificates: instructor.certificates ?? '',
      bio: instructor.bio ?? '',
    })
    setFormError('')
    setModal({ mode: 'edit', instructor })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(key, val) { setForm(f => ({ ...f, [key]: val })) }

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
        role: 'instructor',
        certificates: form.certificates || null,
        bio: form.bio || null,
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
      certificates: form.certificates || null,
      bio: form.bio || null,
    }).eq('id', modal.instructor.id)
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    load()
  }

  const certList = (certs) => certs ? certs.split(',').map(c => c.trim()).filter(Boolean) : []

  // Card view for all users
  return (
    <Layout>
      <div className="page-header">
        <h2 className="page-title">Instructors</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input className="search-input" type="search" placeholder="Search instructors…" value={search} onChange={e => setSearch(e.target.value)} />
          {isAdmin && <button className="btn-primary-sm" onClick={openCreate}>+ Add Instructor</button>}
        </div>
      </div>

      {loading ? <p className="empty-state">Loading…</p> : filtered.length === 0 ? (
        <p className="empty-state">No instructors found.</p>
      ) : (
        <div className="instructor-grid">
          {filtered.map(inst => (
            <div key={inst.id} className="instructor-card">
              <div className="instructor-card__avatar">{inst.full_name?.[0] ?? '?'}</div>
              <div className="instructor-card__body">
                <h3 className="instructor-card__name">{inst.full_name}</h3>
                <p className="instructor-card__lessons">{inst.lessons?.length ?? 0} lessons scheduled</p>
                {inst.certificates && (
                  <div className="instructor-card__certs">
                    {certList(inst.certificates).map(c => (
                      <span key={c} className="badge">{c}</span>
                    ))}
                  </div>
                )}
                {inst.bio && <p className="instructor-card__bio">{inst.bio}</p>}
                <div className="instructor-card__actions">
                  <button className="btn-link" onClick={() => setViewModal({ instructor: inst })}>View Profile</button>
                  {isAdmin && <button className="btn-link" onClick={() => openEdit(inst)}>Edit</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profile view modal */}
      {viewModal && (
        <Modal title={viewModal.instructor.full_name} onClose={() => setViewModal(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div className="instructor-card__avatar" style={{ width: 64, height: 64, fontSize: 28, flexShrink: 0 }}>
                {viewModal.instructor.full_name?.[0] ?? '?'}
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 18 }}>{viewModal.instructor.full_name}</p>
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>{viewModal.instructor.lessons?.length ?? 0} lessons scheduled</p>
              </div>
            </div>
            {viewModal.instructor.certificates && (
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Certificates & Ratings</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {certList(viewModal.instructor.certificates).map(c => <span key={c} className="badge">{c}</span>)}
                </div>
              </div>
            )}
            {viewModal.instructor.bio && (
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>About</p>
                <p style={{ fontSize: 14, lineHeight: 1.6 }}>{viewModal.instructor.bio}</p>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setViewModal(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}

      {modal?.mode === 'create' && (
        <Modal title="Add Instructor" onClose={closeModal}>
          <form onSubmit={handleCreate} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} required placeholder="John Smith" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => field('email', e.target.value)} required placeholder="john@example.com" />
              </div>
            </div>
            <div className="form-group">
              <label>Temporary Password</label>
              <input type="password" value={form.password} onChange={e => field('password', e.target.value)} required placeholder="Min 6 characters" minLength={6} />
            </div>
            <div className="form-group">
              <label>Certificates</label>
              <input type="text" value={form.certificates} onChange={e => field('certificates', e.target.value)} placeholder="e.g. CFI, CFII, MEI" />
            </div>
            <div className="form-group">
              <label>Bio</label>
              <textarea value={form.bio} onChange={e => field('bio', e.target.value)} rows={3} placeholder="Background and teaching philosophy…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Creating…' : 'Create Instructor'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === 'edit' && (
        <Modal title="Edit Instructor" onClose={closeModal}>
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
              <label>Certificates</label>
              <input type="text" value={form.certificates} onChange={e => field('certificates', e.target.value)} placeholder="e.g. CFI, CFII, MEI" />
            </div>
            <div className="form-group">
              <label>Bio</label>
              <textarea value={form.bio} onChange={e => field('bio', e.target.value)} rows={3} />
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
    </Layout>
  )
}
