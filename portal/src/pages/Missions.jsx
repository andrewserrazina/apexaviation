import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const REQUIREMENT_TYPES = [
  { value: 'study_days', label: 'Study N days in the window', targetLabel: 'Days required' },
  { value: 'questions_answered', label: 'Answer N questions in the window', targetLabel: 'Questions required' },
  { value: 'practice_sets_completed', label: 'Complete N practice sets in the window', targetLabel: 'Sets required' },
  { value: 'score_threshold', label: 'Score at or above N% on any practice set', targetLabel: 'Score % required' },
]

const BLANK = {
  title: '', description: '', cadence: 'weekly', requirementType: 'study_days', target: 5,
  xp_reward: 75, premium_reward: '', starts_on: '', ends_on: '', is_premium_only: false,
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

// Progress itself is computed server-side only (refresh_mission_progress(),
// supabase-portal-schema-v50.sql, run on the lifecycle cron) -- this page
// only authors mission definitions and reads back completion stats.
export default function Missions() {
  const [missions, setMissions] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(null) // { mode: 'create' | 'edit', mission }
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const { data: missionRows, error: mErr } = await supabase.from('missions').select('*').order('starts_on', { ascending: false })
    if (mErr) { setError(mErr.message); setLoading(false); return }
    const { data: progressRows } = await supabase.from('member_mission_progress').select('mission_id, completed_at')
    const byMission = {}
    for (const p of progressRows ?? []) {
      const s = byMission[p.mission_id] ?? { total: 0, completed: 0 }
      s.total++
      if (p.completed_at) s.completed++
      byMission[p.mission_id] = s
    }
    setStats(byMission)
    setMissions(missionRows ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setForm({ ...BLANK, starts_on: todayStr(), ends_on: todayStr() })
    setFormError('')
    setModal({ mode: 'create' })
  }

  function openEdit(mission) {
    setForm({
      title: mission.title,
      description: mission.description ?? '',
      cadence: mission.cadence,
      requirementType: mission.requirement?.type ?? 'study_days',
      target: mission.requirement?.target ?? 1,
      xp_reward: mission.xp_reward,
      premium_reward: mission.premium_reward ?? '',
      starts_on: mission.starts_on,
      ends_on: mission.ends_on,
      is_premium_only: mission.is_premium_only,
    })
    setFormError('')
    setModal({ mode: 'edit', mission })
  }

  function closeModal() { setModal(null) }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Title is required.'); return }
    if (form.ends_on < form.starts_on) { setFormError('End date must be on or after the start date.'); return }
    setSaving(true)
    setFormError('')
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      cadence: form.cadence,
      requirement: { type: form.requirementType, target: Number(form.target) },
      xp_reward: Number(form.xp_reward),
      premium_reward: form.premium_reward.trim() || null,
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      is_premium_only: form.is_premium_only,
    }
    const { error: saveError } = modal.mode === 'create'
      ? await supabase.from('missions').insert(payload)
      : await supabase.from('missions').update(payload).eq('id', modal.mission.id)
    setSaving(false)
    if (saveError) { setFormError(saveError.message); return }
    closeModal()
    load()
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${modal.mission.title}"? Member progress toward it will also be removed.`)) return
    await supabase.from('missions').delete().eq('id', modal.mission.id)
    closeModal()
    load()
  }

  async function handleClone(mission) {
    const payload = {
      title: mission.title + ' (copy)',
      description: mission.description,
      cadence: mission.cadence,
      requirement: mission.requirement,
      xp_reward: mission.xp_reward,
      premium_reward: mission.premium_reward,
      starts_on: todayStr(),
      ends_on: mission.ends_on,
      is_premium_only: mission.is_premium_only,
    }
    await supabase.from('missions').insert(payload)
    load()
  }

  const today = todayStr()

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Missions</h2>
          <p className="page-sub">Weekly/monthly/seasonal goals — progress and XP awards are computed automatically by the lifecycle cron</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ New Mission</button>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Cadence</th>
              <th>Requirement</th>
              <th>Window</th>
              <th>XP</th>
              <th>Completion</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty-state">Loading…</td></tr>
            ) : missions.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">No missions yet — create one to get started.</td></tr>
            ) : missions.map(m => {
              const s = stats[m.id] ?? { total: 0, completed: 0 }
              const active = today >= m.starts_on && today <= m.ends_on
              return (
                <tr key={m.id}>
                  <td>
                    <strong>{m.title}</strong>
                    {active && <span className="badge badge--green" style={{ marginLeft: 8 }}>Active</span>}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{m.cadence}</td>
                  <td>{REQUIREMENT_TYPES.find(r => r.value === m.requirement?.type)?.label ?? m.requirement?.type} ({m.requirement?.target})</td>
                  <td>{m.starts_on} → {m.ends_on}</td>
                  <td>{m.xp_reward}</td>
                  <td>{s.completed} / {s.total}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn-link" onClick={() => openEdit(m)}>Edit</button>
                      <button className="btn-link" onClick={() => handleClone(m)}>Clone</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'New Mission' : 'Edit Mission'} onClose={closeModal}>
          <form onSubmit={handleSave}>
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Title</label>
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Study 5 Days This Week" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Shown to members on the Missions page" />
            </div>
            <div className="form-group">
              <label>Cadence</label>
              <select value={form.cadence} onChange={e => setForm(f => ({ ...f, cadence: e.target.value }))}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="seasonal">Seasonal</option>
              </select>
            </div>
            <div className="form-group">
              <label>Requirement</label>
              <select value={form.requirementType} onChange={e => setForm(f => ({ ...f, requirementType: e.target.value }))}>
                {REQUIREMENT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{REQUIREMENT_TYPES.find(r => r.value === form.requirementType)?.targetLabel ?? 'Target'}</label>
              <input type="number" min="1" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>XP reward</label>
              <input type="number" min="0" value={form.xp_reward} onChange={e => setForm(f => ({ ...f, xp_reward: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Premium reward (optional — e.g. "15-min debrief with Andrew")</label>
              <input type="text" value={form.premium_reward} onChange={e => setForm(f => ({ ...f, premium_reward: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Starts on</label>
              <input type="date" value={form.starts_on} onChange={e => setForm(f => ({ ...f, starts_on: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Ends on</label>
              <input type="date" value={form.ends_on} onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.is_premium_only} onChange={e => setForm(f => ({ ...f, is_premium_only: e.target.checked }))} />
                Membership-only (reserved for the future Apex Advantage Membership tier — has no effect yet)
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 8 }}>
              {modal.mode === 'edit' ? <button type="button" className="btn-link" style={{ color: '#f87171' }} onClick={handleDelete}>Delete</button> : <span />}
              <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Mission'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
