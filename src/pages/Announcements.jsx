import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const BLANK = { title: '', body: '', pinned: false }

export default function Announcements() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [active, setActive] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    const { data } = await supabase
      .from('announcements')
      .select('*, author:author_id(full_name)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
    setAnnouncements(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() { setForm(BLANK); setFormError(''); setModal('create') }
  function openEdit(a) { setActive(a); setForm({ title: a.title, body: a.body, pinned: a.pinned ?? false }); setFormError(''); setModal('edit') }
  function closeModal() { setModal(null); setActive(null); setFormError('') }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    let error
    if (modal === 'create') {
      ;({ error } = await supabase.from('announcements').insert({ title: form.title, body: form.body, pinned: form.pinned, author_id: profile.id }))
    } else {
      ;({ error } = await supabase.from('announcements').update({ title: form.title, body: form.body, pinned: form.pinned }).eq('id', active.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); load()
  }

  async function handleDelete() {
    if (!window.confirm('Delete this announcement?')) return
    await supabase.from('announcements').delete().eq('id', active.id)
    closeModal(); load()
  }

  async function togglePin(a) {
    await supabase.from('announcements').update({ pinned: !a.pinned }).eq('id', a.id)
    load()
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Announcements</h2>
          <p className="page-sub">School-wide communications</p>
        </div>
        {isAdmin && <button className="btn-primary-sm" onClick={openCreate}>+ Post Announcement</button>}
      </div>

      {loading ? <p className="empty-state">Loading…</p> : announcements.length === 0 ? (
        <p className="empty-state">No announcements yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780 }}>
          {announcements.map(a => (
            <div key={a.id} className={`announcement-card${a.pinned ? ' announcement-card--pinned' : ''}`}>
              <div className="announcement-card__head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {a.pinned && <span className="announcement-pin">📌 Pinned</span>}
                  <h3 className="announcement-card__title">{a.title}</h3>
                </div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                    <button className="btn-link" style={{ fontSize: 12 }} onClick={() => togglePin(a)}>
                      {a.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button className="btn-link" style={{ fontSize: 12 }} onClick={() => openEdit(a)}>Edit</button>
                  </div>
                )}
              </div>
              <p className="announcement-card__body">{a.body}</p>
              <p className="announcement-card__meta">
                {a.author?.full_name ?? 'Apex Aviation'} · {new Date(a.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      )}

      {(modal === 'create' || modal === 'edit') && (
        <Modal title={modal === 'create' ? 'Post Announcement' : 'Edit Announcement'} onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Title</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Schedule change this weekend" />
            </div>
            <div className="form-group">
              <label>Message</label>
              <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={6} required placeholder="Write your announcement…" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} />
                Pin to top
              </label>
            </div>
            <div className="modal-form__actions">
              {modal === 'edit' && (
                <button type="button" className="btn-danger" onClick={handleDelete}>Delete</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal === 'create' ? 'Post' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
