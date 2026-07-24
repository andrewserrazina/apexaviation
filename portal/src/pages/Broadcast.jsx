import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import { sendAdminEmail } from '../lib/email'

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Students' },
  { value: 'flight_student', label: 'Flight Students' },
  { value: 'apex_advantage', label: 'Apex Advantage Students' },
]

function studentQuery(filter) {
  let query = supabase.from('profiles').select('id, email').eq('role', 'student')
  if (filter !== 'all') query = query.eq('student_type', filter)
  return query
}

// A separate query builder, rather than chaining .select('*', {count, head})
// onto studentQuery()'s already-filtered result, because postgrest-js only
// honors the {count, head} options on the *first* select() call on a fresh
// query -- select() called again after .eq() filters silently ignores that
// second argument and runs a second, uncounted request instead, so count
// always came back undefined (read as 0) regardless of how many students
// actually matched.
function studentCountQuery(filter) {
  let query = supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student')
  if (filter !== 'all') query = query.eq('student_type', filter)
  return query
}

export default function Broadcast() {
  const { profile } = useAuth()

  const [filter, setFilter] = useState('all')
  const [recipientCount, setRecipientCount] = useState(null)
  const [countError, setCountError] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  async function loadHistory() {
    const { data } = await supabase
      .from('admin_broadcasts')
      .select('*, sender:sent_by(full_name)')
      .order('created_at', { ascending: false })
      .limit(20)
    setHistory(data ?? [])
    setLoadingHistory(false)
  }

  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    let cancelled = false
    setRecipientCount(null)
    setCountError('')
    studentCountQuery(filter).then(({ count, error: countErr }) => {
      if (cancelled) return
      if (countErr) {
        setCountError(countErr.message)
        setRecipientCount(0)
      } else {
        setRecipientCount(count ?? 0)
      }
    })
    return () => { cancelled = true }
  }, [filter])

  async function handleSend(e) {
    e.preventDefault()
    if (!recipientCount) return
    if (!window.confirm(`Send this email to ${recipientCount} student(s)?`)) return

    setSending(true)
    setError('')
    setResult('')
    try {
      const { data: recipients, error: fetchError } = await studentQuery(filter)
      if (fetchError) throw fetchError
      if (!recipients || recipients.length === 0) throw new Error('No matching students to email.')

      const { sent } = await sendAdminEmail({ recipients, subject, message, senderId: profile.id })
      setResult(`Sent to ${sent} student(s).`)
      setSubject('')
      setMessage('')
      loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Broadcast</h2>
          <p className="page-sub">Email students directly from the portal</p>
        </div>
      </div>

      <form onSubmit={handleSend} className="modal-form" style={{ maxWidth: 640 }}>
        {error && <div className="form-error">{error}</div>}
        {result && <div className="form-success">{result}</div>}

        <div className="form-group">
          <label>Send To</label>
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p style={{ fontSize: 12, color: countError ? '#f87171' : 'var(--muted)', marginTop: 6 }}>
            {recipientCount === null ? 'Counting recipients…' : countError ? `Couldn't count recipients: ${countError}` : `${recipientCount} recipient(s)`}
          </p>
        </div>

        <div className="form-group">
          <label>Subject</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required placeholder="e.g. New feature in your portal" />
        </div>

        <div className="form-group">
          <label>Message</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={8} required placeholder="Write your message…" />
        </div>

        <div className="modal-form__actions">
          <div style={{ marginLeft: 'auto' }}>
            <button type="submit" className="btn-primary-sm" disabled={sending || !recipientCount}>
              {sending ? 'Sending…' : recipientCount ? `Send to ${recipientCount}` : 'Send'}
            </button>
          </div>
        </div>
      </form>

      <h3 style={{ marginTop: 40, marginBottom: 16 }}>Recent Broadcasts</h3>
      {loadingHistory ? <p className="empty-state">Loading…</p> : history.length === 0 ? (
        <p className="empty-state">No broadcasts sent yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Subject</th><th>Recipients</th><th>Sent By</th><th>Date</th></tr>
            </thead>
            <tbody>
              {history.map(b => (
                <tr key={b.id}>
                  <td>{b.subject}</td>
                  <td>{b.recipient_count}</td>
                  <td>{b.sender?.full_name ?? '—'}</td>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
