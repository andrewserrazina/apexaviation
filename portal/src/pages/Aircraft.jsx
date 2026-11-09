import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import { PageHeader, StatsRow, Button } from '../components/ui'

const STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'unavailable', label: 'Unavailable' },
]

const SQUAWK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'resolved', label: 'Resolved' },
]

const MAINT_TYPES = ['100-Hour Inspection', 'Annual Inspection', 'Oil Change', 'AD Compliance', 'Avionics', 'Tach/Hobbs Calibration', 'Unscheduled Repair', 'Other']

const BLANK = { tail_number: '', make: '', model: '', year: '', status: 'available', total_hours: '', current_tach: '', next_100hr_tach: '', annual_due_date: '', last_inspection: '', notes: '' }
const BLANK_MAINT = { maint_type: '100-Hour Inspection', performed_at: new Date().toISOString().slice(0, 10), tach_at_service: '', description: '', performed_by: '', next_due_tach: '', next_due_date: '' }

function statusBadge(s) {
  if (s === 'available') return 'badge badge--green'
  if (s === 'maintenance') return 'badge badge--yellow'
  return 'badge badge--red'
}

function squawkBadge(s) {
  if (s === 'resolved') return 'badge badge--green'
  if (s === 'deferred') return 'badge badge--yellow'
  return 'badge badge--red'
}

function tachRemaining(ac) {
  if (ac.next_100hr_tach == null || ac.current_tach == null) return null
  return ac.next_100hr_tach - ac.current_tach
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.round((new Date(dateStr) - new Date()) / 86400000)
}

// How urgent an aircraft's next maintenance need is, lowest number
// first -- drives the fleet list's sort order so the tail that needs
// attention soonest (fewest tach hours or days until due) always
// surfaces at the top, rather than relying on someone remembering to
// check every card.
function urgency(ac) {
  const openSquawks = (ac.squawks ?? []).filter(s => s.status === 'open').length
  if (ac.status === 'unavailable' || openSquawks > 0) return -1
  const candidates = []
  const tach = tachRemaining(ac)
  if (tach != null) candidates.push(tach)
  const annualDays = daysUntil(ac.annual_due_date)
  if (annualDays != null) candidates.push(annualDays)
  return candidates.length > 0 ? Math.min(...candidates) : Infinity
}

export default function Aircraft() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = isAdmin || profile?.role === 'instructor'

  const [aircraft, setAircraft] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Aircraft detail (squawks + maintenance in one record, tabbed)
  const [detail, setDetail] = useState(null) // { aircraft, tab: 'squawks' | 'maintenance' }
  const [squawks, setSquawks] = useState([])
  const [squawkForm, setSquawkForm] = useState({ description: '', notes: '', status: 'open' })
  const [squawkSaving, setSquawkSaving] = useState(false)
  const [addingSquawk, setAddingSquawk] = useState(false)
  const [maintRecords, setMaintRecords] = useState([])
  const [maintForm, setMaintForm] = useState(BLANK_MAINT)
  const [maintSaving, setMaintSaving] = useState(false)
  const [addingMaint, setAddingMaint] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('aircraft').select('*, squawks(id, status)').order('tail_number')
    setAircraft(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function loadSquawks(aircraftId) {
    const { data } = await supabase.from('squawks').select('*, reporter:reported_by(full_name)').eq('aircraft_id', aircraftId).order('created_at', { ascending: false })
    setSquawks(data ?? [])
  }

  async function loadMaintenance(aircraftId) {
    const { data } = await supabase.from('maintenance_records').select('*').eq('aircraft_id', aircraftId).order('performed_at', { ascending: false })
    setMaintRecords(data ?? [])
  }

  function openDetail(ac, tab = 'squawks') {
    setDetail({ aircraft: ac, tab })
    setAddingSquawk(false)
    setAddingMaint(false)
    setSquawkForm({ description: '', notes: '', status: 'open' })
    setMaintForm(BLANK_MAINT)
    loadSquawks(ac.id)
    loadMaintenance(ac.id)
  }

  async function handleAddSquawk(e) {
    e.preventDefault()
    setSquawkSaving(true)
    const { error } = await supabase.from('squawks').insert({
      aircraft_id: detail.aircraft.id,
      description: squawkForm.description,
      notes: squawkForm.notes || null,
      status: squawkForm.status,
      reported_by: profile.id,
    })
    if (!error) {
      setSquawkForm({ description: '', notes: '', status: 'open' })
      setAddingSquawk(false)
      loadSquawks(detail.aircraft.id)
      load()
    }
    setSquawkSaving(false)
  }

  async function updateSquawkStatus(squawkId, status) {
    await supabase.from('squawks').update({ status, ...(status === 'resolved' ? { resolved_at: new Date().toISOString() } : {}) }).eq('id', squawkId)
    loadSquawks(detail.aircraft.id)
    load()
  }

  async function handleAddMaint(e) {
    e.preventDefault()
    setMaintSaving(true)
    const { error } = await supabase.from('maintenance_records').insert({
      aircraft_id: detail.aircraft.id,
      maint_type: maintForm.maint_type,
      performed_at: maintForm.performed_at,
      tach_at_service: maintForm.tach_at_service ? parseFloat(maintForm.tach_at_service) : null,
      description: maintForm.description || null,
      performed_by: maintForm.performed_by || null,
      next_due_tach: maintForm.next_due_tach ? parseFloat(maintForm.next_due_tach) : null,
      next_due_date: maintForm.next_due_date || null,
    })
    if (!error) {
      if (maintForm.maint_type === '100-Hour Inspection' && maintForm.next_due_tach) {
        await supabase.from('aircraft').update({ next_100hr_tach: parseFloat(maintForm.next_due_tach) }).eq('id', detail.aircraft.id)
      }
      if (maintForm.maint_type === 'Annual Inspection' && maintForm.next_due_date) {
        await supabase.from('aircraft').update({ annual_due_date: maintForm.next_due_date }).eq('id', detail.aircraft.id)
      }
      if (maintForm.tach_at_service) {
        await supabase.from('aircraft').update({ current_tach: parseFloat(maintForm.tach_at_service) }).eq('id', detail.aircraft.id)
      }
      setMaintForm(BLANK_MAINT)
      setAddingMaint(false)
      loadMaintenance(detail.aircraft.id)
      load()
    }
    setMaintSaving(false)
  }

  function openCreate() {
    setForm(BLANK)
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(ac) {
    setForm({
      tail_number: ac.tail_number ?? '',
      make: ac.make ?? '',
      model: ac.model ?? '',
      year: ac.year ?? '',
      status: ac.status ?? 'available',
      total_hours: ac.total_hours ?? '',
      current_tach: ac.current_tach ?? '',
      next_100hr_tach: ac.next_100hr_tach ?? '',
      annual_due_date: ac.annual_due_date ?? '',
      last_inspection: ac.last_inspection ?? '',
      notes: ac.notes ?? '',
    })
    setFormError('')
    setModal({ mode: 'edit', ac })
  }

  function closeModal() { setModal(null); setFormError('') }
  function field(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const payload = {
      tail_number: form.tail_number.trim().toUpperCase(),
      make: form.make || null,
      model: form.model || null,
      year: form.year ? parseInt(form.year) : null,
      status: form.status,
      total_hours: form.total_hours ? parseFloat(form.total_hours) : 0,
      current_tach: form.current_tach ? parseFloat(form.current_tach) : null,
      next_100hr_tach: form.next_100hr_tach ? parseFloat(form.next_100hr_tach) : null,
      annual_due_date: form.annual_due_date || null,
      last_inspection: form.last_inspection || null,
      notes: form.notes || null,
    }
    let error
    if (modal.mode === 'create') {
      ;({ error } = await supabase.from('aircraft').insert(payload))
    } else {
      ;({ error } = await supabase.from('aircraft').update(payload).eq('id', modal.ac.id))
    }
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    load()
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${modal.ac.tail_number} from fleet?`)) return
    await supabase.from('aircraft').delete().eq('id', modal.ac.id)
    closeModal()
    load()
  }

  function openSquawkCount(ac) {
    return (ac.squawks ?? []).filter(s => s.status !== 'resolved').length
  }

  const sortedFleet = [...aircraft].sort((a, b) => urgency(a) - urgency(b))

  return (
    <Layout>
      <PageHeader
        eyebrow="Apex Operations"
        title="Fleet"
        description="Aircraft status, squawks, and maintenance history."
        actions={isAdmin && <Button variant="primary" onClick={openCreate}>+ Add Aircraft</Button>}
      />

      <StatsRow
        size="sm"
        stats={[
          { label: 'Total Aircraft', value: aircraft.length },
          { label: 'Available', value: aircraft.filter(a => a.status === 'available').length },
          { label: 'In Maintenance', value: aircraft.filter(a => a.status === 'maintenance').length },
          { label: 'Open Squawks', value: aircraft.reduce((sum, a) => sum + openSquawkCount(a), 0) },
        ]}
      />

      {loading ? <p className="empty-state">Loading…</p> : aircraft.length === 0 ? (
        <p className="empty-state">No aircraft in fleet yet.</p>
      ) : (
        <div className="aircraft-grid">
          {sortedFleet.map(ac => (
            <div key={ac.id} className="aircraft-card">
              <div className="aircraft-card__head">
                <span className="aircraft-card__tail">{ac.tail_number}</span>
                <span className={statusBadge(ac.status)}>{ac.status}</span>
              </div>
              <p className="aircraft-card__model">{[ac.year, ac.make, ac.model].filter(Boolean).join(' ') || 'Unknown aircraft'}</p>
              <div className="aircraft-card__stats">
                <div>
                  <p className="aircraft-card__stat-label">Total Hours</p>
                  <p className="aircraft-card__stat-value">{ac.total_hours ?? '—'}</p>
                </div>
                <div>
                  <p className="aircraft-card__stat-label">Tach</p>
                  <p className="aircraft-card__stat-value">{ac.current_tach ?? '—'}</p>
                </div>
              </div>
              <div className="aircraft-card__stats" style={{ marginTop: 8 }}>
                {ac.next_100hr_tach != null && ac.current_tach != null && (
                  <div>
                    <p className="aircraft-card__stat-label">100-Hr Due</p>
                    <p className="aircraft-card__stat-value" style={{ color: tachRemaining(ac) < 10 ? 'var(--tone-danger)' : tachRemaining(ac) < 25 ? 'var(--gold)' : 'var(--text)' }}>
                      {tachRemaining(ac).toFixed(1)} hr left
                    </p>
                  </div>
                )}
                {ac.annual_due_date && (
                  <div>
                    <p className="aircraft-card__stat-label">Annual Due</p>
                    <p className="aircraft-card__stat-value" style={{ color: daysUntil(ac.annual_due_date) < 30 ? 'var(--tone-danger)' : daysUntil(ac.annual_due_date) < 60 ? 'var(--gold)' : 'var(--text)' }}>
                      {new Date(ac.annual_due_date).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
              {ac.notes && <p className="aircraft-card__notes">{ac.notes}</p>}
              <div className="aircraft-card__actions">
                <button className="btn-link" onClick={() => openDetail(ac, 'squawks')}>
                  Squawks{openSquawkCount(ac) > 0 ? ` (${openSquawkCount(ac)})` : ''}
                </button>
                {isStaff && (
                  <button className="btn-link" onClick={() => openDetail(ac, 'maintenance')}>Maintenance</button>
                )}
                {isAdmin && (
                  <button className="btn-link" onClick={() => openEdit(ac)}>Edit</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Aircraft create/edit modal */}
      {modal && (
        <Modal title={modal.mode === 'create' ? 'Add Aircraft' : `Edit ${modal.ac?.tail_number}`} onClose={closeModal}>
          <form onSubmit={handleSave} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Tail Number</label>
                <input type="text" value={form.tail_number} onChange={e => field('tail_number', e.target.value)} required placeholder="N12345" />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => field('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Make</label>
                <input type="text" value={form.make} onChange={e => field('make', e.target.value)} placeholder="Cessna" />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input type="text" value={form.model} onChange={e => field('model', e.target.value)} placeholder="172S" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Year</label>
                <input type="number" value={form.year} onChange={e => field('year', e.target.value)} placeholder="2018" min="1900" max="2030" />
              </div>
              <div className="form-group">
                <label>Total Hours</label>
                <input type="number" step="0.1" min="0" value={form.total_hours} onChange={e => field('total_hours', e.target.value)} placeholder="1200.0" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Current Tach</label>
                <input type="number" step="0.1" min="0" value={form.current_tach} onChange={e => field('current_tach', e.target.value)} placeholder="1452.3" />
              </div>
              <div className="form-group">
                <label>Next 100-Hr Due (Tach)</label>
                <input type="number" step="0.1" min="0" value={form.next_100hr_tach} onChange={e => field('next_100hr_tach', e.target.value)} placeholder="1500.0" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Annual Due Date</label>
                <input type="date" value={form.annual_due_date} onChange={e => field('annual_due_date', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Last Inspection</label>
                <input type="date" value={form.last_inspection} onChange={e => field('last_inspection', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => field('notes', e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
            <div className="modal-form__actions">
              {modal.mode === 'edit' && (
                <button type="button" className="btn-danger" onClick={handleDelete}>Remove</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : modal.mode === 'create' ? 'Add Aircraft' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Aircraft detail: squawks + maintenance in one tabbed record,
          instead of two separate popups -- one place per tail number,
          matching how FlightCircle/Blackbox tie maintenance history to
          the aircraft record rather than splitting it across screens. */}
      {detail && (
        <Modal title={`${detail.aircraft.tail_number} — Fleet Record`} onClose={() => setDetail(null)} wide>
          <div className="tab-bar" style={{ marginBottom: 16 }}>
            <button type="button" className={`tab-btn${detail.tab === 'squawks' ? ' tab-btn--active' : ''}`} onClick={() => setDetail(d => ({ ...d, tab: 'squawks' }))}>
              Squawks{squawks.filter(s => s.status !== 'resolved').length > 0 ? ` (${squawks.filter(s => s.status !== 'resolved').length})` : ''}
            </button>
            {isStaff && (
              <button type="button" className={`tab-btn${detail.tab === 'maintenance' ? ' tab-btn--active' : ''}`} onClick={() => setDetail(d => ({ ...d, tab: 'maintenance' }))}>
                Maintenance
              </button>
            )}
          </div>

          {detail.tab === 'squawks' ? (
            <div className="modal-form">
              {squawks.length === 0 && !addingSquawk && (
                <p className="empty-state" style={{ marginBottom: 16 }}>No squawks logged.</p>
              )}
              {squawks.map(sq => (
                <div key={sq.id} className="squawk-item">
                  <div className="squawk-item__head">
                    <span className={squawkBadge(sq.status)}>{sq.status}</span>
                    <span className="squawk-item__date">{new Date(sq.created_at).toLocaleDateString()}</span>
                    {sq.reporter?.full_name && <span className="squawk-item__reporter">by {sq.reporter.full_name}</span>}
                  </div>
                  <p className="squawk-item__desc">{sq.description}</p>
                  {sq.notes && <p className="squawk-item__notes">{sq.notes}</p>}
                  {isStaff && sq.status !== 'resolved' && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                      {sq.status === 'open' && (
                        <button className="btn-link" style={{ fontSize: 12 }} onClick={() => updateSquawkStatus(sq.id, 'deferred')}>Defer</button>
                      )}
                      <button className="btn-link" style={{ fontSize: 12, color: 'var(--tone-success)' }} onClick={() => updateSquawkStatus(sq.id, 'resolved')}>Resolve</button>
                    </div>
                  )}
                </div>
              ))}

              {addingSquawk ? (
                <form onSubmit={handleAddSquawk} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={squawkForm.description} onChange={e => setSquawkForm(f => ({ ...f, description: e.target.value }))} rows={2} required placeholder="Describe the issue…" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Initial Status</label>
                      <select value={squawkForm.status} onChange={e => setSquawkForm(f => ({ ...f, status: e.target.value }))}>
                        {SQUAWK_STATUSES.filter(s => s.value !== 'resolved').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Notes (optional)</label>
                      <input type="text" value={squawkForm.notes} onChange={e => setSquawkForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context…" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => setAddingSquawk(false)}>Cancel</button>
                    <button type="submit" className="btn-primary-sm" disabled={squawkSaving}>{squawkSaving ? 'Logging…' : 'Log Squawk'}</button>
                  </div>
                </form>
              ) : (
                <button className="btn-secondary" style={{ marginTop: 16, width: '100%' }} onClick={() => setAddingSquawk(true)}>
                  + Log Squawk
                </button>
              )}
            </div>
          ) : (
            <div className="modal-form">
              {maintRecords.length === 0 && !addingMaint && (
                <p className="empty-state" style={{ marginBottom: 16 }}>No maintenance records logged.</p>
              )}
              {maintRecords.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 16 }}>
                  <table className="data-table">
                    <thead>
                      <tr><th>Type</th><th>Date</th><th>Tach</th><th>Next Due</th><th>Performed By</th></tr>
                    </thead>
                    <tbody>
                      {maintRecords.map(m => (
                        <tr key={m.id}>
                          <td>{m.maint_type}</td>
                          <td>{new Date(m.performed_at).toLocaleDateString()}</td>
                          <td>{m.tach_at_service ?? '—'}</td>
                          <td>{m.next_due_tach ? `${m.next_due_tach} tach` : m.next_due_date ? new Date(m.next_due_date).toLocaleDateString() : '—'}</td>
                          <td>{m.performed_by ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {addingMaint ? (
                <form onSubmit={handleAddMaint} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Type</label>
                      <select value={maintForm.maint_type} onChange={e => setMaintForm(f => ({ ...f, maint_type: e.target.value }))}>
                        {MAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Date Performed</label>
                      <input type="date" value={maintForm.performed_at} onChange={e => setMaintForm(f => ({ ...f, performed_at: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Tach at Service</label>
                      <input type="number" step="0.1" value={maintForm.tach_at_service} onChange={e => setMaintForm(f => ({ ...f, tach_at_service: e.target.value }))} placeholder="1452.3" />
                    </div>
                    <div className="form-group">
                      <label>Performed By</label>
                      <input type="text" value={maintForm.performed_by} onChange={e => setMaintForm(f => ({ ...f, performed_by: e.target.value }))} placeholder="A&P / IA name" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Next Due (Tach)</label>
                      <input type="number" step="0.1" value={maintForm.next_due_tach} onChange={e => setMaintForm(f => ({ ...f, next_due_tach: e.target.value }))} placeholder="1552.3" />
                    </div>
                    <div className="form-group">
                      <label>Next Due (Date)</label>
                      <input type="date" value={maintForm.next_due_date} onChange={e => setMaintForm(f => ({ ...f, next_due_date: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Description / Notes</label>
                    <textarea value={maintForm.description} onChange={e => setMaintForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Work performed…" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => setAddingMaint(false)}>Cancel</button>
                    <button type="submit" className="btn-primary-sm" disabled={maintSaving}>{maintSaving ? 'Saving…' : 'Log Entry'}</button>
                  </div>
                </form>
              ) : (
                <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setAddingMaint(true)}>
                  + Log Maintenance Entry
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  )
}
