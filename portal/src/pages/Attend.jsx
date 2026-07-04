import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ApexLogo from '../components/ApexLogo'

function fmt(dt) {
  if (!dt) return ''
  return new Date(dt).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function Attend() {
  const { type, token } = useParams() // type: 'in' | 'out'
  const isCheckIn = type === 'in'

  const [status, setStatus] = useState('loading') // loading | success | already | invalid
  const [reg, setReg] = useState(null)
  const [session, setSession] = useState(null)

  useEffect(() => {
    async function process() {
      if (!token || (type !== 'in' && type !== 'out')) {
        setStatus('invalid')
        return
      }

      const tokenCol = isCheckIn ? 'check_in_token' : 'check_out_token'
      const timestampCol = isCheckIn ? 'checked_in_at' : 'checked_out_at'

      const { data: rows } = await supabase
        .from('ground_registrations')
        .select('*, session:ground_sessions(*)')
        .eq(tokenCol, token)

      if (!rows?.length) { setStatus('invalid'); return }
      const row = rows[0]
      setReg(row)
      setSession(row.session)

      // Already recorded
      if (row[timestampCol]) { setStatus('already'); return }

      // Check-out requires check-in first
      if (!isCheckIn && !row.checked_in_at) { setStatus('checkin_first'); return }

      const newStatus = isCheckIn ? 'checked_in' : 'completed'
      const { error } = await supabase
        .from('ground_registrations')
        .update({
          [timestampCol]: new Date().toISOString(),
          attendance_status: newStatus,
        })
        .eq('id', row.id)

      if (error) { setStatus('invalid'); return }
      setStatus('success')
    }
    process()
  }, [token, type])

  const content = () => {
    if (status === 'loading') return (
      <div className="attend-state">
        <div className="spinner" />
        <p>Verifying your link…</p>
      </div>
    )

    if (status === 'invalid') return (
      <div className="attend-state attend-state--error">
        <div className="attend-icon">✗</div>
        <h2>Invalid Link</h2>
        <p>This attendance link is invalid or has expired. Please contact your instructor.</p>
      </div>
    )

    if (status === 'checkin_first') return (
      <div className="attend-state attend-state--error">
        <div className="attend-icon">⚠</div>
        <h2>Check In First</h2>
        <p>You need to use your check-in link before you can check out.</p>
        {reg && <p style={{ marginTop: 8, opacity: 0.7 }}>{reg.full_name} · {session?.title}</p>}
      </div>
    )

    if (status === 'already') return (
      <div className="attend-state attend-state--already">
        <div className="attend-icon">✓</div>
        <h2>Already {isCheckIn ? 'Checked In' : 'Checked Out'}</h2>
        <p>Your attendance has already been recorded for this session.</p>
        {reg && <p style={{ marginTop: 8, opacity: 0.7 }}>{reg.full_name} · {session?.title}</p>}
      </div>
    )

    if (status === 'success') return (
      <div className="attend-state attend-state--success">
        <div className="attend-icon attend-icon--gold">{isCheckIn ? '✈' : '✓'}</div>
        <h2>{isCheckIn ? 'Welcome!' : 'See You Next Time!'}</h2>
        <p>{isCheckIn ? 'You\'re checked in for' : 'You\'ve checked out of'}</p>
        <div className="attend-session-box">
          <p className="attend-session-title">{session?.title}</p>
          <p className="attend-session-time">{fmt(session?.scheduled_at)}</p>
          {session?.location && <p className="attend-session-loc">📍 {session.location}</p>}
        </div>
        <p className="attend-name">{reg?.full_name}</p>
        {isCheckIn && (
          <p style={{ marginTop: 12, fontSize: 14, opacity: 0.7 }}>
            Remember to use your check-out link when the session ends to receive full credit.
          </p>
        )}
        {!isCheckIn && (
          <p style={{ marginTop: 12, fontSize: 14, color: 'var(--gold)', fontWeight: 600 }}>
            Attendance confirmed — credit recorded.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="attend-page">
      <div className="attend-brand">
        <ApexLogo size={36} />
        <div>
          <span className="attend-brand__name">APEX</span>
          <span className="attend-brand__sub"> <em>Advantage</em></span>
        </div>
      </div>
      <div className="attend-card">
        {content()}
      </div>
    </div>
  )
}
