import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const STAGES = [
  { key: 'inquiry',   label: 'Inquiry',          color: '#94a3b8' },
  { key: 'discovery', label: 'Discovery Flight',  color: '#60a5fa' },
  { key: 'enrolled',  label: 'Enrolled',          color: '#a78bfa' },
  { key: 'active',    label: 'Active Student',    color: '#4ade80' },
  { key: 'graduated', label: 'Graduated',         color: '#F4B400' },
  { key: 'inactive',  label: 'Inactive',          color: '#f87171' },
]

const REFERRAL_SOURCES = ['Walk-in', 'Website', 'Social Media', 'Referral', 'Google', 'Flying Club', 'Event', 'Other']
const BLANK = { full_name: '', email: '', phone: '', stage: 'inquiry', referral_source: '', notes: '' }

export default function CRM() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [activeLead, setActiveLead] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  async function load() {
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    setLeads(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function openLead(lead) {
    setActiveLead(lead)
    setNoteText('')
    const { data } = await supabase
      .from('lead_notes')
      .select('*, author:author_id(full_name)')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
    setNotes(data ?? [])
    setModal('view')
  }

  function openCreate() { setForm(BLANK); setFormError(''); setModal('create') }
  function closeModal() { setModal(null); setActiveLead(null); setFormError('') }
  function field(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('leads').insert({
      full_name: form.full_name, email: form.email || null, phone: form.phone || null,
      stage: form.stage, referral_source: form.referral_source || null, notes: form.notes || null,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); load()
  }

  async function handleUpdateStage(leadId, stage) {
    await supabase.from('leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', leadId)
    load()
  }

  async function handleAddNote(e) {
    e.preventDefault()
    setAddingNote(true)
    await supabase.from('lead_notes').insert({ lead_id: activeLead.id, author_id: profile.id, body: noteText })
    const { data } = await supabase.from('lead_notes').select('*, author:author_id(full_name)').eq('lead_id', activeLead.id).order('created_at', { ascending: false })
    setNotes(data ?? [])
    setNoteText('')
    setAddingNote(false)
  }

  async function handleDeleteLead() {
    if (!window.confirm('Delete this lead?')) return
    await supabase.from('leads').delete().eq('id', activeLead.id)
    closeModal(); load()
  }

  const byStage = (key) => leads.filter(l => l.stage === key)

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">CRM</h2>
          <p className="page-sub">Lead pipeline & prospects</p>
        </div>
        <button className="btn-primary-sm" onClick={openCreate}>+ Add Lead</button>
      </div>

      <div className="stat-grid stat-grid--sm" style={{ marginBottom: 24 }}>
        <div className="stat-card"><p className="stat-card__label">Total Leads</p><p className="stat-card__value">{leads.length}</p></div>
        <div className="stat-card"><p className="stat-card__label">New Inquiries</p><p className="stat-card__value">{byStage('inquiry').length}</p></div>
        <div className="stat-card"><p className="stat-card__label">Active Students</p><p className="stat-card__value">{byStage('active').length}</p></div>
        <div className="stat-card"><p className="stat-card__label">Graduated</p><p className="stat-card__value">{byStage('graduated').length}</p></div>
      </div>

      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="crm-board">
          {STAGES.filter(s => s.key !== 'inactive').map(stage => (
            <div key={stage.key} className="crm-column">
              <div className="crm-column__header">
                <span className="crm-column__dot" style={{ background: stage.color }} />
                <span className="crm-column__label">{stage.label}</span>
                <span className="crm-column__count">{byStage(stage.key).length}</span>
              </div>
              <div className="crm-column__cards">
                {byStage(stage.key).map(lead => (
                  <div key={lead.id} className="crm-card" onClick={() => openLead(lead)}>
                    <p className="crm-card__name">{lead.full_name}</p>
                    {lead.email && <p className="crm-card__contact">{lead.email}</p>}
                    {lead.phone && <p className="crm-card__contact">{lead.phone}</p>}
                    {lead.referral_source && <span className="crm-card__source">{lead.referral_source}</span>}
                    <p className="crm-card__date">{new Date(lead.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
                {byStage(stage.key).length === 0 && (
                  <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>No leads</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {leads.filter(l => l.stage === 'inactive').length > 0 && (
        <details style={{ marginTop: 32 }}>
          <summary style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', marginBottom: 12 }}>
            Inactive leads ({byStage('inactive').length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {byStage('inactive').map(l => (
              <div key={l.id} className="crm-card crm-card--row" onClick={() => openLead(l)}>
                <span>{l.full_name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{l.email}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {modal === 'create' && (
        <Modal title="Add Lead" onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} required placeholder="Jane Smith" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => field('email', e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" value={form.phone} onChange={e => field('phone', e.target.value)} placeholder="(512) 555-0100" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Stage</label>
                <select value={form.stage} onChange={e => field('stage', e.target.value)}>
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Referral Source</label>
                <select value={form.referral_source} onChange={e => field('referral_source', e.target.value)}>
                  <option value="">Unknown</option>
                  {REFERRAL_SOURCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => field('notes', e.target.value)} rows={3} placeholder="Initial notes about this lead…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Lead'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'view' && activeLead && (
        <Modal title={activeLead.full_name} onClose={closeModal} wide>
          <div className="crm-lead-view">
            <div className="crm-lead-view__left">
              <div className="form-group">
                <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Pipeline Stage</label>
                <select
                  value={activeLead.stage}
                  onChange={e => { const s = e.target.value; handleUpdateStage(activeLead.id, s); setActiveLead(l => ({ ...l, stage: s })) }}
                  style={{ marginTop: 6 }}
                >
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                {activeLead.email && <div className="crm-detail-row"><span>✉</span><span>{activeLead.email}</span></div>}
                {activeLead.phone && <div className="crm-detail-row"><span>📞</span><span>{activeLead.phone}</span></div>}
                {activeLead.referral_source && <div className="crm-detail-row"><span>📣</span><span>{activeLead.referral_source}</span></div>}
                <div className="crm-detail-row"><span>📅</span><span>Added {new Date(activeLead.created_at).toLocaleDateString()}</span></div>
              </div>
              {activeLead.notes && (
                <div style={{ marginTop: 16, background: 'var(--navy-3)', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Initial Notes</p>
                  <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{activeLead.notes}</p>
                </div>
              )}
              {isAdmin && (
                <button className="btn-link" style={{ color: '#f87171', fontSize: 12, marginTop: 24 }} onClick={handleDeleteLead}>
                  Delete Lead
                </button>
              )}
            </div>
            <div className="crm-lead-view__right">
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Activity Notes</p>
              <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                  placeholder="Log a note or activity…" required
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button type="submit" className="btn-primary-sm" disabled={addingNote}>Add</button>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
                {notes.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>No activity yet.</p>
                ) : notes.map(n => (
                  <div key={n.id} style={{ background: 'var(--navy-3)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 6 }}>{n.body}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {n.author?.full_name ?? 'Staff'} · {new Date(n.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn-secondary" onClick={closeModal}>Close</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
