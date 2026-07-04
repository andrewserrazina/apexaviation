import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

function currencyStatus(lastDate, thresholdDays) {
  if (!lastDate) return 'expired'
  const days = daysBetween(lastDate, new Date())
  if (days > thresholdDays) return 'expired'
  if (days > thresholdDays * 0.8) return 'expiring'
  return 'current'
}

function CurrencyBadge({ status }) {
  const cls = status === 'current' ? 'badge badge--green' : status === 'expiring' ? 'badge badge--yellow' : 'badge badge--red'
  const label = status === 'current' ? 'Current' : status === 'expiring' ? 'Expiring Soon' : 'Expired'
  return <span className={cls}>{label}</span>
}

export default function InstructorHub() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'

  const [selectedInstructor, setSelectedInstructor] = useState(isInstructor ? profile.id : '')
  const [instructors, setInstructors] = useState([])
  const [lessons, setLessons] = useState([])
  const [students, setStudents] = useState([])
  const [currency, setCurrency] = useState(null)
  const [loading, setLoading] = useState(false)

  const weekStart = (() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  })()
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)

  useEffect(() => {
    if (isAdmin) {
      supabase.from('profiles').select('id, full_name').eq('role', 'instructor').order('full_name')
        .then(({ data }) => setInstructors(data ?? []))
    }
  }, [isAdmin])

  useEffect(() => {
    if (!selectedInstructor) return
    loadData(selectedInstructor)
  }, [selectedInstructor])

  async function loadData(iid) {
    setLoading(true)
    const [
      { data: weekLessons },
      { data: allLessons },
      { data: profileData },
    ] = await Promise.all([
      supabase.from('lessons')
        .select('*, student:profiles!student_id(full_name, id), aircraft:aircraft_id(tail_number, make, model)')
        .eq('instructor_id', iid)
        .gte('starts_at', weekStart.toISOString())
        .lt('starts_at', weekEnd.toISOString())
        .order('starts_at'),
      supabase.from('lessons')
        .select('student_id, starts_at, ends_at, lesson_type')
        .eq('instructor_id', iid)
        .order('starts_at', { ascending: false })
        .limit(200),
      supabase.from('profiles').select('*').eq('id', iid).single(),
    ])

    setLessons(weekLessons ?? [])

    // Build student roster from all lessons
    const studentMap = {}
    for (const l of allLessons ?? []) {
      if (!l.student_id) continue
      if (!studentMap[l.student_id]) studentMap[l.student_id] = { lastLesson: l.starts_at, count: 0 }
      studentMap[l.student_id].count++
    }
    const { data: studentProfiles } = await supabase.from('profiles')
      .select('id, full_name, email')
      .in('id', Object.keys(studentMap).length ? Object.keys(studentMap) : ['none'])
    const roster = (studentProfiles ?? []).map(sp => ({
      ...sp,
      lastLesson: studentMap[sp.id]?.lastLesson,
      lessonCount: studentMap[sp.id]?.count ?? 0,
    })).sort((a, b) => a.full_name.localeCompare(b.full_name))
    setStudents(roster)

    // Currency calculations from profile fields (logbook data)
    const p = profileData
    setCurrency({
      flightReview: p?.last_flight_review ?? null,
      ipcDate: p?.last_ipc ?? null,
      medicalExpiry: p?.medical_expiry ?? null,
      cfiExpiry: p?.cfi_expiry ?? null,
    })

    setLoading(false)
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  function lessonsOnDay(day) {
    return lessons.filter(l => {
      const d = new Date(l.starts_at)
      return d.toDateString() === day.toDateString()
    })
  }

  const totalWeekHours = lessons.reduce((s, l) => {
    if (!l.ends_at) return s
    return s + (new Date(l.ends_at) - new Date(l.starts_at)) / 3600000
  }, 0)

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Instructor Hub</h2>
          <p className="page-sub">Schedule, roster & currency</p>
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginBottom: 24 }}>
          <select className="select-input" value={selectedInstructor} onChange={e => setSelectedInstructor(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">Select an instructor</option>
            {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </select>
        </div>
      )}

      {!selectedInstructor ? (
        <p className="empty-state">Select an instructor to view their hub.</p>
      ) : loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* Week summary */}
          <div className="stat-grid stat-grid--sm">
            <div className="stat-card"><p className="stat-card__label">Lessons This Week</p><p className="stat-card__value">{lessons.length}</p></div>
            <div className="stat-card"><p className="stat-card__label">Hours This Week</p><p className="stat-card__value">{totalWeekHours.toFixed(1)}</p></div>
            <div className="stat-card"><p className="stat-card__label">Active Students</p><p className="stat-card__value">{students.length}</p></div>
          </div>

          {/* Weekly schedule */}
          <div>
            <h3 className="report-section-title">This Week's Schedule</h3>
            <div className="instructor-week">
              {weekDays.map((day, i) => {
                const dayLessons = lessonsOnDay(day)
                const isToday = day.toDateString() === new Date().toDateString()
                return (
                  <div key={i} className={`instructor-day${isToday ? ' instructor-day--today' : ''}`}>
                    <div className="instructor-day__label">
                      <span className="instructor-day__dow">{DAYS[day.getDay()]}</span>
                      <span className="instructor-day__date">{day.getDate()}</span>
                    </div>
                    <div className="instructor-day__lessons">
                      {dayLessons.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: 12, padding: '4px 0' }}>Off</p>
                      ) : dayLessons.map(l => (
                        <div key={l.id} className="instructor-lesson-block">
                          <p className="instructor-lesson-block__time">
                            {new Date(l.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {l.ends_at ? ` – ${new Date(l.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                          </p>
                          <p className="instructor-lesson-block__student">{l.student?.full_name ?? '—'}</p>
                          {l.aircraft && <p className="instructor-lesson-block__aircraft">{l.aircraft.tail_number}</p>}
                          {l.lesson_type && <p className="instructor-lesson-block__type">{l.lesson_type}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Currency tracking */}
          {currency && (
            <div>
              <h3 className="report-section-title">Instructor Currency</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Item</th><th>Date / Expiry</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>Flight Review (BFR)</td>
                      <td>{currency.flightReview ? new Date(currency.flightReview).toLocaleDateString() : '—'}</td>
                      <td><CurrencyBadge status={currencyStatus(currency.flightReview, 730)} /></td>
                    </tr>
                    <tr>
                      <td>IPC (Instrument)</td>
                      <td>{currency.ipcDate ? new Date(currency.ipcDate).toLocaleDateString() : '—'}</td>
                      <td><CurrencyBadge status={currencyStatus(currency.ipcDate, 180)} /></td>
                    </tr>
                    <tr>
                      <td>Medical Certificate</td>
                      <td>{currency.medicalExpiry ? new Date(currency.medicalExpiry).toLocaleDateString() : '—'}</td>
                      <td><CurrencyBadge status={
                        !currency.medicalExpiry ? 'expired'
                          : new Date(currency.medicalExpiry) < new Date() ? 'expired'
                          : daysBetween(new Date(), currency.medicalExpiry) < 60 ? 'expiring'
                          : 'current'
                      } /></td>
                    </tr>
                    <tr>
                      <td>CFI Certificate</td>
                      <td>{currency.cfiExpiry ? new Date(currency.cfiExpiry).toLocaleDateString() : '—'}</td>
                      <td><CurrencyBadge status={
                        !currency.cfiExpiry ? 'expired'
                          : new Date(currency.cfiExpiry) < new Date() ? 'expired'
                          : daysBetween(new Date(), currency.cfiExpiry) < 60 ? 'expiring'
                          : 'current'
                      } /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Currency dates are pulled from the instructor's profile. Update them under My Profile.
              </p>
            </div>
          )}

          {/* Student roster */}
          <div>
            <h3 className="report-section-title">Student Roster</h3>
            {students.length === 0 ? (
              <p className="empty-state">No students assigned yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Total Lessons</th><th>Last Lesson</th></tr></thead>
                  <tbody>
                    {students.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.full_name}</td>
                        <td>{s.email ?? '—'}</td>
                        <td>{s.lessonCount}</td>
                        <td>{s.lastLesson ? new Date(s.lastLesson).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}
    </Layout>
  )
}
