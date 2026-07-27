import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import { sendAdminEmail } from '../lib/email'

const FEEDBACK_OPTIONS = [
  { value: '', label: 'No feedback yet' },
  { value: 'price', label: 'Price' },
  { value: 'checkride_not_soon', label: 'My checkride is not soon' },
  { value: 'unclear_what_included', label: 'Unclear what was included' },
  { value: 'wanted_to_see_more', label: 'Wanted to see more of the product' },
  { value: 'prefer_free_resources', label: 'Prefers free resources' },
  { value: 'not_ready_to_trust', label: 'Not ready to trust the product' },
  { value: 'checkout_technical_problem', label: 'Checkout/technical problem' },
  { value: 'other', label: 'Other' },
]

const TIMING_LABELS = {
  within_14_days: 'Within 14 days',
  within_30_days: 'Within 30 days',
  within_60_days: 'Within 60 days',
  more_than_60_days: 'More than 60 days',
  not_scheduled: 'Not scheduled',
}

function daysAgo(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function fmtDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString() : '—'
}

export default function Nonbuyers() {
  const { profile: admin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [detailRow, setDetailRow] = useState(null)
  const [feedbackCategory, setFeedbackCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')

  const [emailRow, setEmailRow] = useState(null)
  const [emailForm, setEmailForm] = useState({ subject: '', message: '', isHtml: false })
  const [emailSending, setEmailSending] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  // This view is deliberately not "all students" -- it's specifically the
  // registered-but-unpurchased list, so purchase status is implicitly
  // "not purchased" for every row here rather than a redundant column.
  // "Assessment result" (the spec's other requested column) isn't shown
  // because the free Checkride Readiness Assessment doesn't exist yet --
  // no invented data for a feature that isn't built.
  async function load() {
    setLoading(true)
    setError('')
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, email, created_at, checkride_timing, portal_last_active_at')
      .eq('role', 'student')
      .eq('checkride_prep_unlocked', false)
      .order('created_at', { ascending: false })
    if (pErr) { setError(pErr.message); setLoading(false); return }

    const ids = (profiles ?? []).map(p => p.id)
    if (ids.length === 0) { setRows([]); setLoading(false); return }

    const [{ data: qProgress }, { data: attempts }, { data: emailLog }, { data: feedback }] = await Promise.all([
      supabase.from('portal_question_progress').select('profile_id, completed').in('profile_id', ids),
      supabase.from('checkout_session_attempts').select('profile_id, purpose, created_at, completed_at').in('profile_id', ids).order('created_at', { ascending: false }),
      supabase.from('portal_email_log').select('profile_id, email_type, sent_at').in('profile_id', ids).order('sent_at', { ascending: false }),
      supabase.from('member_feedback').select('*').in('profile_id', ids),
    ])

    const lessonsCompleted = {}
    for (const r of qProgress ?? []) {
      if (r.completed) lessonsCompleted[r.profile_id] = (lessonsCompleted[r.profile_id] ?? 0) + 1
    }

    // Both attempts and emailLog are queried already sorted newest-first,
    // so the first row seen per profile_id is the most recent one.
    const latestAttempt = {}
    for (const a of attempts ?? []) if (!latestAttempt[a.profile_id]) latestAttempt[a.profile_id] = a

    const latestEmail = {}
    for (const e of emailLog ?? []) if (!latestEmail[e.profile_id]) latestEmail[e.profile_id] = e

    const feedbackByProfile = {}
    for (const f of feedback ?? []) feedbackByProfile[f.profile_id] = f

    setRows(profiles.map(p => ({
      ...p,
      lessonsCompleted: lessonsCompleted[p.id] ?? 0,
      lastAttempt: latestAttempt[p.id] ?? null,
      lastEmail: latestEmail[p.id] ?? null,
      feedback: feedbackByProfile[p.id] ?? null,
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openDetail(row) {
    setDetailRow(row)
    setFeedbackCategory(row.feedback?.feedback_category ?? '')
    setNotes(row.feedback?.notes ?? '')
    setFeedbackError('')
  }

  async function saveFeedback() {
    setFeedbackSaving(true)
    setFeedbackError('')
    const { error: saveError } = await supabase.from('member_feedback').upsert({
      profile_id: detailRow.id,
      feedback_category: feedbackCategory || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    setFeedbackSaving(false)
    if (saveError) { setFeedbackError(saveError.message); return }
    setDetailRow(null)
    load()
  }

  function openEmail(row) {
    setEmailForm({ subject: '', message: '', isHtml: false })
    setEmailError('')
    setEmailSent(false)
    setEmailRow(row)
  }

  async function handleSendEmail(e) {
    e.preventDefault()
    setEmailSending(true)
    setEmailError('')
    try {
      await sendAdminEmail({
        recipients: [{ id: emailRow.id, email: emailRow.email }],
        subject: emailForm.subject,
        message: emailForm.message,
        senderId: admin.id,
        isHtml: emailForm.isHtml,
      })
      setEmailSent(true)
    } catch (err) {
      setEmailError(err.message)
    } finally {
      setEmailSending(false)
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Nonbuyers</h2>
          <p className="page-sub">Registered members who haven't unlocked Checkride Prep yet</p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? <p className="empty-state">Loading…</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Registered</th>
                <th>Checkride</th>
                <th>Last Active</th>
                <th>Lessons</th>
                <th>Checkout</th>
                <th>Feedback</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="empty-state">No nonbuyers found — everyone registered has unlocked Checkride Prep.</td></tr>
              ) : rows.map(r => {
                const active = daysAgo(r.portal_last_active_at)
                return (
                  <tr key={r.id}>
                    <td><strong>{r.full_name}</strong></td>
                    <td>{r.email}</td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>{r.checkride_timing ? TIMING_LABELS[r.checkride_timing] ?? r.checkride_timing : '—'}</td>
                    <td>
                      {active === null ? '—' : active === 0 ? 'Today' : `${active}d ago`}
                      {active !== null && active >= 14 && <span className="badge badge--red" style={{ marginLeft: 6 }}>Cold</span>}
                    </td>
                    <td>{r.lessonsCompleted}</td>
                    <td>
                      {r.lastAttempt
                        ? (r.lastAttempt.completed_at
                            ? <span className="badge badge--green">Completed</span>
                            : <span className="badge badge--yellow">Abandoned</span>)
                        : '—'}
                    </td>
                    <td>{r.feedback?.feedback_category ? (FEEDBACK_OPTIONS.find(o => o.value === r.feedback.feedback_category)?.label ?? r.feedback.feedback_category) : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn-link" onClick={() => openDetail(r)}>Details</button>
                        <button className="btn-link" onClick={() => openEmail(r)}>Email</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailRow && (
        <Modal title={detailRow.full_name} onClose={() => setDetailRow(null)}>
          <div className="modal-form">
            {feedbackError && <div className="form-error">{feedbackError}</div>}

            <div className="form-group">
              <label>Registered</label>
              <p style={{ fontSize: 14 }}>{fmtDate(detailRow.created_at)}</p>
            </div>
            <div className="form-group">
              <label>Checkride Timing</label>
              <p style={{ fontSize: 14 }}>{detailRow.checkride_timing ? TIMING_LABELS[detailRow.checkride_timing] ?? detailRow.checkride_timing : 'Not provided'}</p>
            </div>
            <div className="form-group">
              <label>Last Active</label>
              <p style={{ fontSize: 14 }}>{fmtDate(detailRow.portal_last_active_at)}</p>
            </div>
            <div className="form-group">
              <label>Lessons Completed</label>
              <p style={{ fontSize: 14 }}>{detailRow.lessonsCompleted}</p>
            </div>
            <div className="form-group">
              <label>Checkout Attempts</label>
              <p style={{ fontSize: 14 }}>
                {detailRow.lastAttempt
                  ? `Last: ${detailRow.lastAttempt.purpose} on ${fmtDate(detailRow.lastAttempt.created_at)} — ${detailRow.lastAttempt.completed_at ? 'completed' : 'abandoned'}`
                  : 'None yet'}
              </p>
            </div>
            <div className="form-group">
              <label>Most Recent Email</label>
              <p style={{ fontSize: 14 }}>
                {detailRow.lastEmail ? `${detailRow.lastEmail.email_type} — ${fmtDate(detailRow.lastEmail.sent_at)}` : 'None sent yet'}
              </p>
            </div>

            <div className="form-group">
              <label>What stopped them from purchasing?</label>
              <select value={feedbackCategory} onChange={e => setFeedbackCategory(e.target.value)}>
                {FEEDBACK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Any context worth remembering…" />
            </div>

            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setDetailRow(null)}>Cancel</button>
                <button type="button" className="btn-primary-sm" disabled={feedbackSaving} onClick={saveFeedback}>{feedbackSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {emailRow && (
        <Modal title={`Email ${emailRow.full_name}`} onClose={() => setEmailRow(null)}>
          {emailSent ? (
            <div className="modal-form">
              <div className="form-success">Email sent to {emailRow.email}.</div>
              <div className="modal-form__actions" style={{ marginTop: 16 }}>
                <div style={{ marginLeft: 'auto' }}>
                  <button type="button" className="btn-primary-sm" onClick={() => setEmailRow(null)}>Done</button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSendEmail} className="modal-form">
              {emailError && <div className="form-error">{emailError}</div>}
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Sends directly to {emailRow.email}.
              </p>
              <div className="form-group">
                <label>Subject</label>
                <input type="text" value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} required placeholder="e.g. Still thinking about Checkride Prep?" />
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea
                  value={emailForm.message}
                  onChange={e => setEmailForm(f => ({ ...f, message: e.target.value }))}
                  rows={6}
                  required
                  placeholder={emailForm.isHtml ? '<p>Write your HTML…</p>' : 'Write your message…'}
                  style={emailForm.isHtml ? { fontFamily: 'monospace', fontSize: 13 } : undefined}
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={emailForm.isHtml} onChange={e => setEmailForm(f => ({ ...f, isHtml: e.target.checked }))} />
                  This message is HTML
                </label>
              </div>
              {emailForm.isHtml && emailForm.message && (
                <div className="form-group">
                  <label>Preview</label>
                  <iframe
                    title="Email HTML preview"
                    srcDoc={emailForm.message}
                    sandbox=""
                    style={{ width: '100%', height: 200, border: '1px solid var(--border, #333)', borderRadius: 6, background: '#fff' }}
                  />
                </div>
              )}
              <div className="modal-form__actions">
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-secondary" onClick={() => setEmailRow(null)}>Cancel</button>
                  <button type="submit" className="btn-primary-sm" disabled={emailSending}>{emailSending ? 'Sending…' : 'Send Email'}</button>
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}
    </Layout>
  )
}
