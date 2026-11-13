import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import {
  PIPELINE_STAGE_OPTIONS, PIPELINE_STAGE_LABELS, ORIGIN_PLATFORM_OPTIONS, ORIGIN_PLATFORM_LABELS,
  CAPTURE_METHOD_OPTIONS, CAPTURE_METHOD_LABELS, TRAINING_INTEREST_OPTIONS,
  CONTACT_METHOD_OPTIONS, OUTCOME_OPTIONS, LEGACY_STAGE_LABELS,
  hasNameOrHandle, buildLeadInsertPayload, buildNoteInsertPayload,
  findDuplicateMatches, mergeDirectoryRecords, filterDirectoryRecords,
  followUpBucket, groupFollowUps,
} from '../lib/leads'

const REFERRAL_SOURCES = ['Walk-in', 'Website', 'Social Media', 'Referral', 'Google', 'Flying Club', 'Event', 'Other']

// Derived server-side by capture-waitlist-lead from which waitlist
// checkboxes a visitor selected (see that function's classifyLocation
// Segment()) -- null for every lead created another way, which is why
// every lookup below falls back to showing nothing rather than a bare
// "null".
const LOCATION_SEGMENT_LABELS = { austin_in_person: 'Austin In-Person', virtual: 'Virtual', both: 'Austin + Virtual' }

const BLANK_LEAD_FORM = {
  full_name: '', social_username: '', origin_platform: '', capture_method: '',
  email: '', phone: '', profile_url: '', training_interest: '', aircraft_interest: '',
  checkride_date: '', source_campaign: '', source_content: '', assigned_to: '',
  next_follow_up_at: '', pipeline_stage: 'new', notes: '', referral_source: '',
}

const BLANK_FILTERS = { stage: '', source: '', trainingInterest: '', assignedTo: '', followUp: '', search: '', segment: 'all' }

function formatDateTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CRM() {
  const { profile } = useAuth()
  // Office managers get full CRM management, same as admin -- only
  // instructors are read-mostly here (delete stays out of their hands).
  const canDeleteLead = profile?.role === 'admin' || profile?.role === 'office_manager'

  const [leads, setLeads] = useState([])
  const [readinessLeads, setReadinessLeads] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('board') // 'board' | 'directory' | 'followups'
  const [filters, setFilters] = useState(BLANK_FILTERS)

  const [modal, setModal] = useState(null) // 'create' | 'lead' | 'readiness' | null
  const [activeLead, setActiveLead] = useState(null)
  const [activeReadiness, setActiveReadiness] = useState(null)
  const [form, setForm] = useState(BLANK_LEAD_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [notes, setNotes] = useState([])
  const [noteForm, setNoteForm] = useState({ body: '', contactMethod: '', outcome: '' })
  const [addingNote, setAddingNote] = useState(false)
  const [bookingIndicators, setBookingIndicators] = useState(null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: leadRows }, { data: readinessRows }, { data: staffRows }] = await Promise.all([
      supabase.from('leads').select('*, assigned:assigned_to(full_name)').order('created_at', { ascending: false }),
      // RLS-gated: returns everything for admin/instructor/office_manager,
      // just their own submissions (by profile_id) otherwise.
      supabase.from('readiness_assessment_leads').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role').in('role', ['admin', 'instructor', 'office_manager']).order('full_name'),
    ])
    setLeads(leadRows ?? [])
    setReadinessLeads(readinessRows ?? [])
    setStaff(staffRows ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const directoryRecords = useMemo(() => mergeDirectoryRecords(leads, readinessLeads), [leads, readinessLeads])
  const followUpGroups = useMemo(() => groupFollowUps(leads), [leads])
  const dueCount = followUpGroups.overdue.length + followUpGroups.today.length

  const segmentFiltered = useMemo(() => {
    if (filters.segment === 'all') return directoryRecords
    return directoryRecords.filter(r => r.raw?.location_segment === filters.segment)
  }, [directoryRecords, filters.segment])

  const visibleRecords = useMemo(() => filterDirectoryRecords(segmentFiltered, filters), [segmentFiltered, filters])
  const boardRecords = useMemo(() => visibleRecords.filter(r => r.recordType === 'lead'), [visibleRecords])
  const byStage = (key) => boardRecords.filter(r => r.pipelineStage === key)

  const austinWaitlistCount = leads.filter(l => l.location_segment === 'austin_in_person' || l.location_segment === 'both').length

  function field(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })) }

  function openCreate(prefill = {}) {
    setForm({ ...BLANK_LEAD_FORM, ...prefill })
    setFormError('')
    setModal('create')
  }

  function closeModal() {
    setModal(null); setActiveLead(null); setActiveReadiness(null); setFormError('')
    setBookingIndicators(null); setLinkPickerOpen(false); setLinkSearch('')
  }

  async function openLead(lead) {
    setActiveLead(lead)
    setNoteForm({ body: '', contactMethod: '', outcome: '' })
    setBookingIndicators(null)
    setLinkPickerOpen(false)
    const [{ data: noteRows }, { data: indicators }] = await Promise.all([
      supabase.from('lead_notes').select('*, author:author_id(full_name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      lead.email ? supabase.rpc('lead_booking_indicators', { p_email: lead.email }) : Promise.resolve({ data: null }),
    ])
    setNotes(noteRows ?? [])
    setBookingIndicators(indicators ?? null)
    setModal('lead')
  }

  function openReadiness(rl) {
    setActiveReadiness(rl)
    setModal('readiness')
  }

  const duplicateMatches = useMemo(() => {
    if (modal !== 'create') return []
    if (!form.email && !form.phone && !(form.origin_platform && form.social_username)) return []
    return findDuplicateMatches(form, { leads, readinessLeads })
  }, [modal, form.email, form.phone, form.origin_platform, form.social_username, leads, readinessLeads])

  async function handleSave(e) {
    e.preventDefault()
    if (!hasNameOrHandle(form)) { setFormError('Enter a name or a social media username.'); return }
    setSaving(true)
    const { error } = await supabase.from('leads').insert(buildLeadInsertPayload(form))
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); load()
  }

  async function handleUpdateField(leadId, patch) {
    await supabase.from('leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', leadId)
    setActiveLead(l => (l ? { ...l, ...patch } : l))
    load()
  }

  async function handleAddNote(e) {
    e.preventDefault()
    if (!noteForm.body.trim()) return
    setAddingNote(true)
    await supabase.from('lead_notes').insert(buildNoteInsertPayload(activeLead.id, profile.id, noteForm))
    const { data } = await supabase.from('lead_notes').select('*, author:author_id(full_name)').eq('lead_id', activeLead.id).order('created_at', { ascending: false })
    setNotes(data ?? [])
    setNoteForm({ body: '', contactMethod: '', outcome: '' })
    setAddingNote(false)
  }

  async function handleCompleteFollowUp(lead) {
    await handleUpdateField(lead.id, { next_follow_up_at: null })
  }

  async function handleDeleteLead() {
    if (!window.confirm('Delete this lead?')) return
    await supabase.from('leads').delete().eq('id', activeLead.id)
    closeModal(); load()
  }

  async function handleLinkReadiness(readinessId) {
    await handleUpdateField(activeLead.id, { linked_readiness_lead_id: readinessId })
    setLinkPickerOpen(false); setLinkSearch('')
  }
  async function handleUnlinkReadiness() {
    await handleUpdateField(activeLead.id, { linked_readiness_lead_id: null })
  }

  const linkedLeadForReadiness = activeReadiness
    ? directoryRecords.find(r => r.recordType === 'readiness' && r.sourceId === activeReadiness.id)?.linkedLeadId
    : null

  const linkCandidates = useMemo(() => {
    if (!linkPickerOpen) return []
    const q = linkSearch.trim().toLowerCase()
    // Never offer a readiness record already linked to a different lead
    // -- each assessment should link to at most one lead at a time, so
    // staff don't accidentally attach the same person to two records.
    const alreadyLinkedIds = new Set(leads.map(l => l.linked_readiness_lead_id).filter(Boolean))
    return readinessLeads
      .filter(rl => !alreadyLinkedIds.has(rl.id))
      .filter(rl => !q || rl.full_name?.toLowerCase().includes(q) || rl.email?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [linkPickerOpen, linkSearch, readinessLeads, leads])

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">CRM</h2>
          <p className="page-sub">Unified lead pipeline — manual, social & readiness assessment leads</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {dueCount > 0 && (
            <button className="btn-secondary" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }} onClick={() => setView('followups')}>
              ⏰ {dueCount} follow-up{dueCount === 1 ? '' : 's'} due
            </button>
          )}
          <button className="btn-primary-sm" onClick={() => openCreate()}>+ Add Lead</button>
        </div>
      </div>

      <div className="stat-grid stat-grid--sm" style={{ marginBottom: 20 }}>
        <div className="stat-card"><p className="stat-card__label">Manual &amp; Social Leads</p><p className="stat-card__value">{leads.length}</p></div>
        <div className="stat-card"><p className="stat-card__label">Readiness Assessments</p><p className="stat-card__value">{readinessLeads.length}</p></div>
        <div className="stat-card"><p className="stat-card__label">Austin Waitlist</p><p className="stat-card__value">{austinWaitlistCount}</p></div>
        <div className="stat-card"><p className="stat-card__label">New</p><p className="stat-card__value">{leads.filter(l => l.pipeline_stage === 'new').length}</p></div>
        <div className="stat-card"><p className="stat-card__label">Won</p><p className="stat-card__value">{leads.filter(l => l.pipeline_stage === 'won').length}</p></div>
      </div>

      <div className="pill-bar" style={{ marginBottom: 16 }}>
        <button className={`pill-btn${view === 'board' ? ' pill-btn--active' : ''}`} onClick={() => setView('board')}>Pipeline Board</button>
        <button className={`pill-btn${view === 'directory' ? ' pill-btn--active' : ''}`} onClick={() => setView('directory')}>Lead Directory</button>
        <button className={`pill-btn${view === 'followups' ? ' pill-btn--active' : ''}`} onClick={() => setView('followups')}>Follow-Ups{dueCount > 0 ? ` (${dueCount})` : ''}</button>
      </div>

      <div className="crm-filter-bar">
        <input className="search-input" type="search" placeholder="Search name, email, phone…" value={filters.search} onChange={e => setFilter('search', e.target.value)} />
        <select value={filters.stage} onChange={e => setFilter('stage', e.target.value)} aria-label="Filter by pipeline stage">
          <option value="">All stages</option>
          {PIPELINE_STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filters.source} onChange={e => setFilter('source', e.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          {ORIGIN_PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="readiness_assessment">Readiness Assessment</option>
        </select>
        <select value={filters.trainingInterest} onChange={e => setFilter('trainingInterest', e.target.value)} aria-label="Filter by training interest">
          <option value="">All interests</option>
          {TRAINING_INTEREST_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.assignedTo} onChange={e => setFilter('assignedTo', e.target.value)} aria-label="Filter by assigned staff member">
          <option value="">Anyone assigned</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select value={filters.followUp} onChange={e => setFilter('followUp', e.target.value)} aria-label="Filter by follow-up status">
          <option value="">Any follow-up status</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No follow-up set</option>
        </select>
        <select value={filters.segment} onChange={e => setFilter('segment', e.target.value)} aria-label="Filter by location interest">
          <option value="all">All locations</option>
          <option value="austin_in_person">Austin In-Person</option>
          <option value="virtual">Virtual</option>
          <option value="both">Austin + Virtual</option>
        </select>
        {(filters.stage || filters.source || filters.trainingInterest || filters.assignedTo || filters.followUp || filters.search || filters.segment !== 'all') && (
          <button className="btn-link" onClick={() => setFilters(BLANK_FILTERS)}>Clear filters</button>
        )}
      </div>

      {loading ? <p className="empty-state">Loading…</p> : (
        <>
          {view === 'board' && (
            <div className="crm-board">
              {PIPELINE_STAGE_OPTIONS.filter(s => s.value !== 'lost').map(stage => (
                <div key={stage.value} className="crm-column">
                  <div className="crm-column__header">
                    <span className="crm-column__dot" style={{ background: stage.color }} />
                    <span className="crm-column__label">{stage.label}</span>
                    <span className="crm-column__count">{byStage(stage.value).length}</span>
                  </div>
                  <div className="crm-column__cards">
                    {byStage(stage.value).map(r => (
                      <div key={r.id} className="crm-card" onClick={() => openLead(r.raw)}>
                        <p className="crm-card__name">{r.displayName}</p>
                        {r.email && <p className="crm-card__contact">{r.email}</p>}
                        {r.phone && <p className="crm-card__contact">{r.phone}</p>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {r.originPlatform && <span className="crm-card__source">{ORIGIN_PLATFORM_LABELS[r.originPlatform]}</span>}
                          {r.raw.location_segment && <span className="crm-card__source">{LOCATION_SEGMENT_LABELS[r.raw.location_segment] ?? r.raw.location_segment}</span>}
                        </div>
                        {r.nextFollowUpAt && (
                          <p className={`crm-card__followup crm-card__followup--${followUpBucket(r.nextFollowUpAt)}`}>
                            Follow up {formatDateTime(r.nextFollowUpAt)}
                          </p>
                        )}
                        <p className="crm-card__date">{new Date(r.createdAt).toLocaleDateString()}</p>
                      </div>
                    ))}
                    {byStage(stage.value).length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>No leads</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'board' && byStage('lost').length > 0 && (
            <details style={{ marginTop: 32 }}>
              <summary style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', marginBottom: 12 }}>
                Lost leads ({byStage('lost').length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {byStage('lost').map(r => (
                  <div key={r.id} className="crm-card crm-card--row" onClick={() => openLead(r.raw)}>
                    <span>{r.displayName}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{r.email}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {view === 'directory' && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Source</th><th>Stage</th><th>Interest</th><th>Assigned</th><th>Follow-Up</th><th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map(r => (
                    <tr key={r.id} onClick={() => (r.recordType === 'lead' ? openLead(r.raw) : openReadiness(r.raw))} style={{ cursor: 'pointer' }}>
                      <td>{r.displayName}{r.email && <span style={{ color: 'var(--muted)', fontSize: 12, display: 'block' }}>{r.email}</span>}</td>
                      <td>
                        {r.recordType === 'readiness' ? (
                          <span className="badge badge--blue">Readiness Assessment{r.linkedLeadId ? ' · Linked' : ''}</span>
                        ) : (
                          <span className="badge">{r.originPlatform ? ORIGIN_PLATFORM_LABELS[r.originPlatform] : (r.raw.referral_source ?? '—')}</span>
                        )}
                      </td>
                      <td>{r.recordType === 'lead' ? (PIPELINE_STAGE_LABELS[r.pipelineStage] ?? r.pipelineStage) : '—'}</td>
                      <td>{r.trainingInterest ?? '—'}</td>
                      <td>{r.assignedTo ? (staff.find(s => s.id === r.assignedTo)?.full_name ?? '—') : '—'}</td>
                      <td>
                        {r.nextFollowUpAt ? (
                          <span className={`badge badge--${followUpBucket(r.nextFollowUpAt) === 'overdue' ? 'red' : followUpBucket(r.nextFollowUpAt) === 'today' ? 'yellow' : 'blue'}`}>
                            {formatDateTime(r.nextFollowUpAt)}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {visibleRecords.length === 0 && (
                    <tr><td colSpan={7} className="empty-state">No leads match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {view === 'followups' && (
            <div className="crm-followups">
              {[['overdue', 'Overdue', '#f87171'], ['today', 'Due Today', '#F4B400'], ['upcoming', 'Upcoming', '#60a5fa']].map(([key, label, color]) => (
                <div key={key} className="crm-followup-group">
                  <div className="crm-column__header">
                    <span className="crm-column__dot" style={{ background: color }} />
                    <span className="crm-column__label">{label}</span>
                    <span className="crm-column__count">{followUpGroups[key].length}</span>
                  </div>
                  <div className="crm-column__cards">
                    {followUpGroups[key].map(lead => (
                      <div key={lead.id} className="crm-card crm-card--row">
                        <div onClick={() => openLead(lead)} style={{ cursor: 'pointer', flex: 1 }}>
                          <span>{lead.full_name || `@${lead.social_username}`}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>{formatDateTime(lead.next_follow_up_at)}</span>
                        </div>
                        <button className="btn-link" onClick={() => handleCompleteFollowUp(lead)}>Mark Complete</button>
                      </div>
                    ))}
                    {followUpGroups[key].length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>Nothing here</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {modal === 'create' && (
        <Modal title="Add Lead" onClose={closeModal} wide>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            {duplicateMatches.length > 0 && (
              <div className="form-warning">
                <strong>Possible duplicate{duplicateMatches.length > 1 ? 's' : ''}:</strong>{' '}
                {duplicateMatches.map((m, i) => (
                  <span key={i}>
                    {m.record.full_name ?? m.record.email ?? m.record.social_username} ({m.type === 'readiness' ? 'readiness assessment' : 'existing lead'}, matched on {m.reasons.join(', ')}){i < duplicateMatches.length - 1 ? '; ' : ''}
                  </span>
                ))}
                {' '}— you can still save this as a separate record and link identities later from the lead detail view.
              </div>
            )}
            <p className="form-hint">Provide a name OR a social media username — at least one is required.</p>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="form-group">
                <label>Social Username</label>
                <input type="text" value={form.social_username} onChange={e => field('social_username', e.target.value)} placeholder="@flygirl512" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Origin Platform</label>
                <select value={form.origin_platform} onChange={e => field('origin_platform', e.target.value)}>
                  <option value="">Unknown</option>
                  {ORIGIN_PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Capture Method</label>
                <select value={form.capture_method} onChange={e => field('capture_method', e.target.value)}>
                  <option value="">Unknown</option>
                  {CAPTURE_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Profile URL</label>
              <input type="url" value={form.profile_url} onChange={e => field('profile_url', e.target.value)} placeholder="https://tiktok.com/@flygirl512" />
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
                <label>Training Interest</label>
                <select value={form.training_interest} onChange={e => field('training_interest', e.target.value)}>
                  <option value="">Unknown</option>
                  {TRAINING_INTEREST_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Aircraft / Avionics Interest</label>
                <input type="text" value={form.aircraft_interest} onChange={e => field('aircraft_interest', e.target.value)} placeholder="Piper PA-28, G1000" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Checkride Date</label>
                <input type="date" value={form.checkride_date} onChange={e => field('checkride_date', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Pipeline Stage</label>
                <select value={form.pipeline_stage} onChange={e => field('pipeline_stage', e.target.value)}>
                  {PIPELINE_STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Source Campaign</label>
                <input type="text" value={form.source_campaign} onChange={e => field('source_campaign', e.target.value)} placeholder="Apex Explains: First Solo" />
              </div>
              <div className="form-group">
                <label>Source Content / CTA</label>
                <input type="text" value={form.source_content} onChange={e => field('source_content', e.target.value)} placeholder="checkride-scenario-CTA" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Assigned To</label>
                <select value={form.assigned_to} onChange={e => field('assigned_to', e.target.value)}>
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Next Follow-Up</label>
                <input type="datetime-local" value={form.next_follow_up_at} onChange={e => field('next_follow_up_at', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Referral Source</label>
              <select value={form.referral_source} onChange={e => field('referral_source', e.target.value)}>
                <option value="">Unknown</option>
                {REFERRAL_SOURCES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
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

      {modal === 'lead' && activeLead && (
        <Modal title={activeLead.full_name || `@${activeLead.social_username}`} onClose={closeModal} wide>
          <div className="crm-lead-view">
            <div className="crm-lead-view__left">
              <div className="form-group">
                <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Pipeline Stage</label>
                <select value={activeLead.pipeline_stage} onChange={e => handleUpdateField(activeLead.id, { pipeline_stage: e.target.value })} style={{ marginTop: 6 }}>
                  {PIPELINE_STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {activeLead.stage && (
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Legacy status: {LEGACY_STAGE_LABELS[activeLead.stage] ?? activeLead.stage}</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                {activeLead.email && <div className="crm-detail-row"><span>✉</span><span>{activeLead.email}</span></div>}
                {activeLead.phone && <div className="crm-detail-row"><span>📞</span><span>{activeLead.phone}</span></div>}
                {activeLead.origin_platform && (
                  <div className="crm-detail-row"><span>📱</span><span>{ORIGIN_PLATFORM_LABELS[activeLead.origin_platform]}{activeLead.social_username ? ` — @${activeLead.social_username.replace(/^@/, '')}` : ''}</span></div>
                )}
                {activeLead.capture_method && <div className="crm-detail-row"><span>📥</span><span>Captured via {CAPTURE_METHOD_LABELS[activeLead.capture_method]}</span></div>}
                {activeLead.profile_url && <div className="crm-detail-row"><span>🔗</span><a href={activeLead.profile_url} target="_blank" rel="noopener noreferrer">{activeLead.profile_url}</a></div>}
                {activeLead.training_interest && <div className="crm-detail-row"><span>🎓</span><span>{activeLead.training_interest}</span></div>}
                {activeLead.aircraft_interest && <div className="crm-detail-row"><span>✈️</span><span>{activeLead.aircraft_interest}</span></div>}
                {activeLead.checkride_date && <div className="crm-detail-row"><span>📝</span><span>Checkride {new Date(activeLead.checkride_date).toLocaleDateString()}</span></div>}
                {activeLead.referral_source && <div className="crm-detail-row"><span>📣</span><span>{activeLead.referral_source}</span></div>}
                {(activeLead.source_campaign || activeLead.source_content) && (
                  <div className="crm-detail-row"><span>🎯</span><span>{[activeLead.source_campaign, activeLead.source_content].filter(Boolean).join(' · ')}</span></div>
                )}
                {activeLead.location_segment && <div className="crm-detail-row"><span>📍</span><span>{LOCATION_SEGMENT_LABELS[activeLead.location_segment] ?? activeLead.location_segment}</span></div>}
                <div className="crm-detail-row"><span>📅</span><span>Added {new Date(activeLead.created_at).toLocaleDateString()}</span></div>
              </div>

              <div className="form-group" style={{ marginTop: 16 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Assigned To</label>
                <select value={activeLead.assigned_to ?? ''} onChange={e => handleUpdateField(activeLead.id, { assigned_to: e.target.value || null })} style={{ marginTop: 6 }}>
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Next Follow-Up</label>
                <input type="datetime-local" value={toDatetimeLocalValue(activeLead.next_follow_up_at)} onChange={e => handleUpdateField(activeLead.id, { next_follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} style={{ marginTop: 6 }} />
                {activeLead.next_follow_up_at && (
                  <button type="button" className="btn-link" style={{ marginTop: 6 }} onClick={() => handleCompleteFollowUp(activeLead)}>Mark complete</button>
                )}
              </div>

              {bookingIndicators && (bookingIndicators.has_mock_oral_booking || bookingIndicators.has_portal_access_purchase || bookingIndicators.has_verified_purchase) && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Bookings &amp; Purchases</p>
                  {bookingIndicators.has_mock_oral_booking && <span className="badge badge--green">Mock Oral Booking</span>}
                  {bookingIndicators.has_portal_access_purchase && <span className="badge badge--green">Portal Access Purchase</span>}
                  {bookingIndicators.has_verified_purchase && <span className="badge badge--green">Verified Purchase</span>}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Linked Readiness Assessment</p>
                {activeLead.linked_readiness_lead_id ? (
                  <div>
                    {(() => {
                      const rl = readinessLeads.find(r => r.id === activeLead.linked_readiness_lead_id)
                      return rl ? (
                        <div className="crm-detail-row" style={{ cursor: 'pointer' }} onClick={() => openReadiness(rl)}>
                          <span>📊</span><span>{rl.readiness_level} ({rl.score}%) — {new Date(rl.created_at).toLocaleDateString()}</span>
                        </div>
                      ) : <p style={{ fontSize: 12, color: 'var(--muted)' }}>Linked assessment not visible.</p>
                    })()}
                    <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={handleUnlinkReadiness}>Unlink</button>
                  </div>
                ) : linkPickerOpen ? (
                  <div>
                    <input className="search-input" type="search" placeholder="Search readiness assessments…" value={linkSearch} onChange={e => setLinkSearch(e.target.value)} style={{ marginBottom: 6 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                      {linkCandidates.map(rl => (
                        <div key={rl.id} className="crm-card--row" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => handleLinkReadiness(rl.id)}>
                          {rl.full_name ?? rl.email} — {rl.email}
                        </div>
                      ))}
                      {linkCandidates.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>No matches.</p>}
                    </div>
                    <button type="button" className="btn-link" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setLinkPickerOpen(false)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => setLinkPickerOpen(true)}>Link to a readiness assessment…</button>
                )}
              </div>

              {canDeleteLead && (
                <button className="btn-link" style={{ color: '#f87171', fontSize: 12, marginTop: 24 }} onClick={handleDeleteLead}>
                  Delete Lead
                </button>
              )}
            </div>
            <div className="crm-lead-view__right">
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Activity Timeline</p>
              <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <textarea
                  value={noteForm.body} onChange={e => setNoteForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="Log a note or activity…" required rows={2} style={{ fontSize: 13 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={noteForm.contactMethod} onChange={e => setNoteForm(f => ({ ...f, contactMethod: e.target.value }))} style={{ flex: 1 }}>
                    <option value="">Contact method…</option>
                    {CONTACT_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={noteForm.outcome} onChange={e => setNoteForm(f => ({ ...f, outcome: e.target.value }))} style={{ flex: 1 }}>
                    <option value="">Outcome…</option>
                    {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button type="submit" className="btn-primary-sm" disabled={addingNote}>Add</button>
                </div>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
                {notes.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>No activity yet.</p>
                ) : notes.map(n => (
                  <div key={n.id} style={{ background: 'var(--navy-3)', borderRadius: 8, padding: 12 }}>
                    <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 6 }}>{n.body}</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      {n.contact_method && <span className="badge">{CONTACT_METHOD_OPTIONS.find(o => o.value === n.contact_method)?.label ?? n.contact_method}</span>}
                      {n.outcome && <span className="badge badge--blue">{OUTCOME_OPTIONS.find(o => o.value === n.outcome)?.label ?? n.outcome}</span>}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {n.author?.full_name ?? 'Staff'} · {new Date(n.created_at).toLocaleString()}
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

      {modal === 'readiness' && activeReadiness && (
        <Modal title={activeReadiness.full_name || activeReadiness.email} onClose={closeModal}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="badge badge--blue">Readiness Assessment — read-only</span>
            <div className="crm-detail-row"><span>✉</span><span>{activeReadiness.email}</span></div>
            <div className="crm-detail-row"><span>📊</span><span>{activeReadiness.readiness_level} — {activeReadiness.score}%</span></div>
            {activeReadiness.checkride_timing && <div className="crm-detail-row"><span>📝</span><span>Checkride timing: {activeReadiness.checkride_timing}</span></div>}
            {activeReadiness.strongest_category && <div className="crm-detail-row"><span>💪</span><span>Strongest: {activeReadiness.strongest_category}</span></div>}
            {activeReadiness.weakest_category_1 && <div className="crm-detail-row"><span>📉</span><span>Weakest: {[activeReadiness.weakest_category_1, activeReadiness.weakest_category_2].filter(Boolean).join(', ')}</span></div>}
            {activeReadiness.source && <div className="crm-detail-row"><span>📣</span><span>{activeReadiness.source}</span></div>}
            <div className="crm-detail-row"><span>📅</span><span>Submitted {new Date(activeReadiness.created_at).toLocaleDateString()}</span></div>

            {linkedLeadForReadiness ? (
              <button type="button" className="btn-secondary" onClick={() => { const l = leads.find(x => x.id === linkedLeadForReadiness); closeModal(); if (l) openLead(l) }}>
                View Linked Lead
              </button>
            ) : (
              <button type="button" className="btn-primary-sm" onClick={() => {
                const prefill = {
                  full_name: activeReadiness.full_name || '', email: activeReadiness.email || '',
                  origin_platform: 'website', capture_method: 'website_form',
                  checkride_date: '', training_interest: '', notes: `From readiness assessment: ${activeReadiness.readiness_level} (${activeReadiness.score}%).`,
                }
                closeModal()
                openCreate(prefill)
              }}>
                Create Lead From This
              </button>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn-secondary" onClick={closeModal}>Close</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
