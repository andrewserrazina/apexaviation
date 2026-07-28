import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

function fmtDateTime(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleString() : '—'
}

const EVENT_LABELS = {
  daily_login: 'Daily Dispatch opened',
  practice_set_completed: 'Practice set completed',
  perfect_score_bonus: 'Perfect score bonus',
  achievement_earned: 'Achievement earned',
  admin_manual_award: 'Manual admin award',
}

// Every row here is written server-side by award_xp() (triggers or a
// security-definer RPC) -- there is no client-writable path to this
// table, so this view is a true audit trail, not something a member
// could have tampered with. See supabase-portal-schema-v47.sql.
export default function XpLedger() {
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [awardModal, setAwardModal] = useState(null)
  const [awardAmount, setAwardAmount] = useState('')
  const [awardReason, setAwardReason] = useState('')
  const [awardSaving, setAwardSaving] = useState(false)
  const [awardError, setAwardError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const [{ data: ledger, error: ledgerErr }, { data: profiles, error: profilesErr }] = await Promise.all([
      supabase
        .from('xp_ledger')
        .select('id, profile_id, event_type, xp_amount, source_table, source_id, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('profiles')
        .select('id, full_name, email, total_xp, current_rank')
        .eq('role', 'student')
        .order('total_xp', { ascending: false })
        .limit(50),
    ])
    if (ledgerErr) { setError(ledgerErr.message); setLoading(false); return }
    if (profilesErr) { setError(profilesErr.message); setLoading(false); return }

    const byId = {}
    for (const p of profiles ?? []) byId[p.id] = p
    setRows((ledger ?? []).map(r => ({ ...r, member: byId[r.profile_id] ?? null })))
    setTotals(profiles ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAward(member) {
    setAwardModal(member)
    setAwardAmount('')
    setAwardReason('')
    setAwardError('')
  }

  async function handleAward(e) {
    e.preventDefault()
    const amount = parseInt(awardAmount, 10)
    if (!amount || amount === 0) { setAwardError('Enter a non-zero XP amount.'); return }
    if (!awardReason.trim()) { setAwardError('A reason is required.'); return }
    setAwardSaving(true)
    setAwardError('')
    const { error: rpcError } = await supabase.rpc('admin_award_xp', {
      p_profile_id: awardModal.id,
      p_xp_amount: amount,
      p_reason: awardReason.trim(),
    })
    setAwardSaving(false)
    if (rpcError) { setAwardError(rpcError.message); return }
    setAwardModal(null)
    load()
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">XP Ledger</h2>
          <p className="page-sub">Every XP award is written server-side and immutable — this is the audit trail, not an editable record</p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <h3 className="report-section-title" style={{ marginBottom: 12 }}>Top members by total XP</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Rank</th>
              <th>Total XP</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="empty-state">Loading…</td></tr>
            ) : totals.length === 0 ? (
              <tr><td colSpan={4} className="empty-state">No members yet.</td></tr>
            ) : totals.map(m => (
              <tr key={m.id}>
                <td>
                  <strong>{m.full_name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.email}</div>
                </td>
                <td style={{ textTransform: 'capitalize' }}>{(m.current_rank ?? 'student_pilot').replace(/_/g, ' ')}</td>
                <td>{m.total_xp ?? 0}</td>
                <td>
                  <button className="btn-link" onClick={() => openAward(m)}>Award XP</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <h3 className="report-section-title" style={{ marginBottom: 12 }}>Recent ledger entries</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Member</th>
              <th>Event</th>
              <th>XP</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="empty-state">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">No XP has been awarded yet.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td>{r.member?.full_name ?? r.profile_id}</td>
                <td>
                  {EVENT_LABELS[r.event_type] ?? r.event_type}
                  {r.event_type === 'admin_manual_award' && r.metadata?.reason && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.metadata.reason}</div>
                  )}
                </td>
                <td>{r.xp_amount > 0 ? `+${r.xp_amount}` : r.xp_amount}</td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.source_table}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {awardModal && (
        <Modal title={`Award XP — ${awardModal.full_name}`} onClose={() => setAwardModal(null)}>
          <form onSubmit={handleAward}>
            {awardError && <div className="form-error">{awardError}</div>}
            <div className="form-group">
              <label>XP amount (use a negative number to correct an over-award)</label>
              <input type="number" value={awardAmount} onChange={e => setAwardAmount(e.target.value)} required placeholder="e.g. 50 or -50" />
            </div>
            <div className="form-group">
              <label>Reason (required, stored in the audit log)</label>
              <textarea value={awardReason} onChange={e => setAwardReason(e.target.value)} required rows={3} placeholder="e.g. Manually correcting a duplicate award from..." />
            </div>
            <button className="btn-primary" type="submit" disabled={awardSaving}>{awardSaving ? 'Saving…' : 'Award XP'}</button>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
