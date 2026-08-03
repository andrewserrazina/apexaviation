import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// How far out "the month ahead" reaches for the biddable list -- classes
// scheduled further out than this simply haven't shown up here yet (they
// will as the date approaches), rather than needing an explicit
// publish-a-batch/deadline "round" concept (see supabase-portal-schema-v59.sql
// for why: bidding is just "is this class published and unassigned",
// continuously, not a scheduled event of its own).
const WINDOW_DAYS = 35

function formatDateTime(row) {
  if (!row.class_date || !row.start_time) return 'Date TBD'
  const start = new Date(`${row.class_date}T${row.start_time}`)
  const date = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

function bidStatusBadgeClass(status) {
  if (status === 'selected') return 'status-badge status-badge--success'
  if (status === 'pending') return 'status-badge status-badge--warning'
  return 'status-badge'
}

function fmtClock(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
}

// Scheduled duration vs actual duration, in minutes -- surfaced right
// where the instructor clocks out so a significant variance from the
// published class time is visible immediately, not just later in
// Payroll's aggregate compliance view.
function durationVarianceMinutes(row) {
  if (!row.actual_start_time || !row.actual_end_time) return null
  const scheduledMinutes = (new Date(`${row.class_date}T${row.end_time}`) - new Date(`${row.class_date}T${row.start_time}`)) / 60000
  const actualMinutes = (new Date(row.actual_end_time) - new Date(row.actual_start_time)) / 60000
  return Math.round(actualMinutes - scheduledMinutes)
}

export default function GroundSchoolBidding() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [noteDrafts, setNoteDrafts] = useState({}) // classId -> in-progress note text

  const [myClasses, setMyClasses] = useState([])
  const [myClassesLoading, setMyClassesLoading] = useState(true)
  const [myClassesError, setMyClassesError] = useState('')
  const [clockSavingId, setClockSavingId] = useState(null)

  const todayStr = new Date().toISOString().slice(0, 10)
  const windowEndStr = new Date(Date.now() + WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  // A day of grace behind "today" so a class that started last night (or
  // just after midnight) doesn't disappear from view before it's finished.
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  async function load() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('scheduled_ground_classes')
      .select('*, ground_school_class_bids(*, instructor:profiles(id, full_name))')
      .eq('status', 'published')
      .is('instructor_id', null)
      .gte('class_date', todayStr)
      .lte('class_date', windowEndStr)
      .order('class_date', { ascending: true })
      .order('start_time', { ascending: true })

    if (loadError) setError(loadError.message)
    else setClasses(data ?? [])
    setLoading(false)
  }

  async function loadMyClasses() {
    if (!profile?.id) return
    setMyClassesLoading(true)
    const { data, error: loadError } = await supabase
      .from('scheduled_ground_classes')
      .select('*')
      .eq('instructor_id', profile.id)
      .in('status', ['published', 'completed'])
      .gte('class_date', yesterdayStr)
      .lte('class_date', windowEndStr)
      .order('class_date', { ascending: true })
      .order('start_time', { ascending: true })

    if (loadError) setMyClassesError(loadError.message)
    else setMyClasses(data ?? [])
    setMyClassesLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { loadMyClasses() }, [profile?.id])

  async function startClass(row) {
    setClockSavingId(row.id)
    setMyClassesError('')
    const { error: startError } = await supabase.rpc('start_scheduled_ground_class', { p_class_id: row.id })
    setClockSavingId(null)
    if (startError) { setMyClassesError(startError.message); return }
    await loadMyClasses()
  }

  async function finishClass(row) {
    if (!window.confirm(`Finish "${row.title}"? This marks the class complete and records the end time for payroll.`)) return
    setClockSavingId(row.id)
    setMyClassesError('')
    const { error: finishError } = await supabase.rpc('finish_scheduled_ground_class', { p_class_id: row.id })
    setClockSavingId(null)
    if (finishError) { setMyClassesError(finishError.message); return }
    await loadMyClasses()
  }

  const rows = useMemo(() => classes.map(row => ({
    ...row,
    bids: (row.ground_school_class_bids ?? []).filter(b => b.status !== 'withdrawn'),
  })), [classes])

  function myBidFor(row) {
    return row.bids.find(b => b.instructor_id === profile?.id)
  }

  async function placeBid(classId) {
    setSavingId(classId)
    setError('')
    setNotice('')
    const { error: bidError } = await supabase.rpc('submit_ground_school_class_bid', {
      p_scheduled_ground_class_id: classId,
      p_note: noteDrafts[classId]?.trim() || null,
    })
    setSavingId(null)
    if (bidError) { setError(bidError.message); return }
    setNoteDrafts(current => ({ ...current, [classId]: '' }))
    setNotice('Bid submitted.')
    await load()
  }

  async function withdrawBid(bid) {
    setSavingId(bid.id)
    setError('')
    setNotice('')
    const { error: withdrawError } = await supabase.rpc('withdraw_ground_school_class_bid', { p_bid_id: bid.id })
    setSavingId(null)
    if (withdrawError) { setError(withdrawError.message); return }
    setNotice('Bid withdrawn.')
    await load()
  }

  async function assignBid(bid) {
    if (!window.confirm(`Assign ${bid.instructor?.full_name ?? 'this instructor'} to this class?`)) return
    setSavingId(bid.id)
    setError('')
    setNotice('')
    const { error: assignError } = await supabase.rpc('assign_ground_school_class_bid', { p_bid_id: bid.id })
    setSavingId(null)
    if (assignError) { setError(assignError.message); return }
    setNotice('Instructor assigned.')
    await load()
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Training</p>
          <h2 className="page-title">Ground School Bidding</h2>
          <p className="page-sub">
            {isAdmin
              ? 'Published classes still needing an instructor, and who has bid to teach them.'
              : 'Published classes in the next month that don’t have an instructor yet. Bid on the ones you want to teach.'}
          </p>
        </div>
      </div>

      {myClassesError && <div className="form-error" style={{ marginBottom: 16 }}>{myClassesError}</div>}

      {!myClassesLoading && myClasses.length > 0 && (
        <section className="card" style={{ marginBottom: 24 }}>
          <h3 className="card__title" style={{ marginBottom: 14 }}>My Assigned Classes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {myClasses.map(row => {
              const variance = durationVarianceMinutes(row)
              return (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong>{row.title}</strong>
                    <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
                      {formatDateTime(row)}
                      {row.actual_start_time && ` · Started ${fmtClock(row.actual_start_time)}`}
                      {row.actual_end_time && ` · Finished ${fmtClock(row.actual_end_time)}`}
                      {variance !== null && Math.abs(variance) >= 10 && (
                        <span style={{ color: '#f87171' }}> · {variance > 0 ? `Ran ${variance} min over` : `Ended ${Math.abs(variance)} min early`}</span>
                      )}
                    </p>
                  </div>
                  {row.status === 'completed' ? (
                    <span className="status-badge status-badge--success">Completed</span>
                  ) : row.actual_start_time ? (
                    <button className="btn-primary-sm" disabled={clockSavingId === row.id} onClick={() => finishClass(row)}>
                      {clockSavingId === row.id ? 'Finishing…' : 'Finish Class'}
                    </button>
                  ) : (
                    <button className="btn-primary-sm" disabled={clockSavingId === row.id} onClick={() => startClass(row)}>
                      {clockSavingId === row.id ? 'Starting…' : 'Start Class'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="form-success" style={{ marginBottom: 16 }}>{notice}</div>}

      {loading ? (
        <p className="empty-state">Loading classes…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state-block">
          <h3>No open classes right now</h3>
          <p>Every published class in the next {WINDOW_DAYS} days already has an instructor assigned.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {rows.map(row => {
            const mine = myBidFor(row)
            const pendingBids = row.bids.filter(b => b.status === 'pending')
            return (
              <section className="card" key={row.id}>
                <div className="page-header" style={{ marginBottom: pendingBids.length || !isAdmin ? 14 : 0 }}>
                  <div>
                    <h3 className="card__title" style={{ marginBottom: 4 }}>{row.title}</h3>
                    <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                      {row.module_id ? `${row.module_id} · ` : ''}{row.lesson_title} · {formatDateTime(row)} · {row.timezone}
                    </p>
                  </div>
                  {mine && <span className={bidStatusBadgeClass(mine.status)}>{mine.status === 'pending' ? 'You bid on this' : mine.status}</span>}
                </div>

                {isAdmin && (
                  pendingBids.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 13 }}>No bids yet.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Instructor</th>
                            <th>Note</th>
                            <th>Bid Date</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingBids.map(bid => (
                            <tr key={bid.id}>
                              <td><strong>{bid.instructor?.full_name ?? 'Unknown'}</strong></td>
                              <td>{bid.note || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                              <td>{new Date(bid.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td>
                              <td>
                                <button className="btn-link" disabled={savingId === bid.id} onClick={() => assignBid(bid)}>
                                  {savingId === bid.id ? 'Assigning…' : 'Assign'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {!mine && (
                  <div className="form-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Note (optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. prefer evenings, can't do the 15th"
                        value={noteDrafts[row.id] ?? ''}
                        onChange={e => setNoteDrafts(current => ({ ...current, [row.id]: e.target.value }))}
                      />
                    </div>
                    <button
                      className="btn-primary-sm"
                      disabled={savingId === row.id}
                      onClick={() => placeBid(row.id)}
                    >
                      {savingId === row.id ? 'Submitting…' : 'Bid for This Class'}
                    </button>
                  </div>
                )}

                {mine && mine.status === 'pending' && (
                  <div style={{ marginTop: 14 }}>
                    {mine.note && <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>Your note: {mine.note}</p>}
                    <button className="btn-secondary" disabled={savingId === mine.id} onClick={() => withdrawBid(mine)}>
                      {savingId === mine.id ? 'Withdrawing…' : 'Withdraw Bid'}
                    </button>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
