import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['requested', 'scheduled', 'completed', 'canceled']

function statusBadgeClass(status) {
  if (status === 'completed') return 'status-badge status-badge--success'
  if (status === 'canceled') return 'status-badge status-badge--warning'
  return 'status-badge'
}

export default function MockOralRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('mock_oral_requests')
      .select('*')
      .order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else setRequests(data ?? [])
    setLoading(false)
  }

  async function updateRequest(request, changes) {
    setSavingId(request.id)
    setError('')
    const { error: saveError } = await supabase
      .from('mock_oral_requests')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', request.id)
    setSavingId(null)
    if (saveError) { setError(saveError.message); return }
    await load()
  }

  function updateScheduledAt(request, value) {
    updateRequest(request, { scheduled_at: value ? new Date(value).toISOString() : null, status: value ? 'scheduled' : request.status })
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Business</p>
          <h2 className="page-title">Mock Oral Requests</h2>
          <p className="page-sub">Students who paid for a 60-minute Mock Oral, waiting on a scheduled time.</p>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <p className="empty-state">Loading requests…</p>
      ) : requests.length === 0 ? (
        <div className="empty-state-block">
          <h3>No Mock Oral requests yet</h3>
          <p>Requests will show up here as members pay for a session from the portal.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Email</th>
                <th>Requested</th>
                <th>Scheduled For</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(request => (
                <tr key={request.id}>
                  <td><strong>{request.full_name}</strong></td>
                  <td>{request.email}</td>
                  <td>{new Date(request.created_at).toLocaleDateString()}</td>
                  <td>
                    <input
                      type="datetime-local"
                      disabled={savingId === request.id}
                      defaultValue={request.scheduled_at ? new Date(request.scheduled_at).toISOString().slice(0, 16) : ''}
                      onBlur={e => updateScheduledAt(request, e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className={statusBadgeClass(request.status)}
                      value={request.status}
                      disabled={savingId === request.id}
                      onChange={e => updateRequest(request, { status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      defaultValue={request.notes ?? ''}
                      disabled={savingId === request.id}
                      placeholder="Optional notes…"
                      onBlur={e => updateRequest(request, { notes: e.target.value || null })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
