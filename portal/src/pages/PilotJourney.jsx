import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'

function fmtDate(dateStr) {
  return dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString() : '—'
}

// Members can always log their own milestones as 'self_reported' -- only an
// admin or instructor acting on someone ELSE's row can move a milestone to
// 'instructor_verified' (enforced server-side by
// trg_protect_milestone_verification, supabase-portal-schema-v52.sql).
// This page is that verification action; it has no other write path.
export default function PilotJourney() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [showVerified, setShowVerified] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    const [{ data: milestones, error: mErr }, { data: types, error: tErr }, { data: profiles, error: pErr }] = await Promise.all([
      supabase.from('member_milestones').select('*').order('achieved_on', { ascending: false }).limit(300),
      supabase.from('journey_milestone_types').select('milestone_key, label'),
      supabase.from('profiles').select('id, full_name, email').eq('role', 'student'),
    ])
    if (mErr) { setError(mErr.message); setLoading(false); return }
    if (tErr) { setError(tErr.message); setLoading(false); return }
    if (pErr) { setError(pErr.message); setLoading(false); return }

    const labelByKey = {}
    for (const t of types ?? []) labelByKey[t.milestone_key] = t.label
    const memberById = {}
    for (const p of profiles ?? []) memberById[p.id] = p

    setRows((milestones ?? []).map(m => ({
      ...m,
      label: labelByKey[m.milestone_key] ?? m.milestone_key,
      member: memberById[m.profile_id] ?? null,
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function verify(row) {
    setSavingId(row.id)
    setError('')
    const { error: updateErr } = await supabase
      .from('member_milestones')
      .update({
        verification_status: 'instructor_verified',
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    setSavingId(null)
    if (updateErr) { setError(updateErr.message); return }
    load()
  }

  const visible = rows.filter(r => showVerified || r.verification_status === 'self_reported')

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Pilot Journey</h2>
          <p className="page-sub">Self-reported milestones awaiting instructor verification. Verifying here is the only way a milestone can become "Instructor Verified" — students cannot set this themselves.</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
          <input type="checkbox" checked={showVerified} onChange={e => setShowVerified(e.target.checked)} />
          Show already-verified milestones
        </label>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Milestone</th>
              <th>Date</th>
              <th>Notes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty-state">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">Nothing awaiting verification.</td></tr>
            ) : visible.map(r => (
              <tr key={r.id}>
                <td>
                  <strong>{r.member?.full_name ?? r.profile_id}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.member?.email}</div>
                </td>
                <td>{r.label}</td>
                <td>{fmtDate(r.achieved_on)}</td>
                <td style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 280 }}>{r.notes ?? '—'}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.verification_status.replace(/_/g, ' ')}</td>
                <td>
                  {r.verification_status === 'self_reported' && (
                    <button className="btn-link" disabled={savingId === r.id} onClick={() => verify(r)}>
                      {savingId === r.id ? 'Verifying…' : 'Mark Instructor Verified'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  )
}
