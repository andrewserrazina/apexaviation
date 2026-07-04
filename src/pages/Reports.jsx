import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toCSV(headers, rows) {
  return [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('monthly')
  const [loading, setLoading] = useState(true)

  // Monthly summary state
  const [monthlyData, setMonthlyData] = useState([])

  // Student record state
  const [students, setStudents] = useState([])
  const [selectedStudent, setSelectedStudent] = useState('')
  const [studentData, setStudentData] = useState(null)
  const [loadingStudent, setLoadingStudent] = useState(false)

  // Aircraft hours state
  const [aircraftData, setAircraftData] = useState([])

  useEffect(() => {
    loadMonthly()
    loadStudents()
    loadAircraftHours()
  }, [])

  async function loadMonthly() {
    setLoading(true)
    const start = new Date()
    start.setMonth(start.getMonth() - 11)
    start.setDate(1)

    const [{ data: lessons }, { data: invoices }] = await Promise.all([
      supabase.from('lessons').select('starts_at, ends_at').gte('starts_at', start.toISOString()),
      supabase.from('invoices').select('issued_at, amount_cents, status').gte('issued_at', start.toISOString()),
    ])

    const byMonth = {}
    for (let i = 0; i < 12; i++) {
      const d = new Date(start)
      d.setMonth(start.getMonth() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      byMonth[key] = { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, lessons: 0, hours: 0, revenue: 0, outstanding: 0 }
    }

    for (const l of lessons ?? []) {
      const d = new Date(l.starts_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (byMonth[key]) {
        byMonth[key].lessons++
        const hrs = l.ends_at ? (new Date(l.ends_at) - new Date(l.starts_at)) / 3600000 : 0
        byMonth[key].hours += hrs
      }
    }

    for (const inv of invoices ?? []) {
      const d = new Date(inv.issued_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (byMonth[key]) {
        if (inv.status === 'paid') byMonth[key].revenue += inv.amount_cents / 100
        else byMonth[key].outstanding += inv.amount_cents / 100
      }
    }

    setMonthlyData(Object.values(byMonth))
    setLoading(false)
  }

  async function loadStudents() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
    setStudents(data ?? [])
  }

  async function loadStudentRecord(sid) {
    setLoadingStudent(true)
    const [
      { data: profile },
      { data: endorsements },
      { data: stageChecks },
      { data: writtenTests },
      { data: logbook },
      { data: groundRegs },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', sid).single(),
      supabase.from('endorsements').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date_given'),
      supabase.from('stage_checks').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date'),
      supabase.from('written_tests').select('*').eq('student_id', sid).order('date_taken'),
      supabase.from('logbook_entries').select('*').eq('student_id', sid).order('date'),
      supabase.from('ground_registrations').select('*, session:ground_sessions(title, scheduled_at)').eq('student_id', sid).order('registered_at'),
    ])
    setStudentData({ profile, endorsements: endorsements ?? [], stageChecks: stageChecks ?? [], writtenTests: writtenTests ?? [], logbook: logbook ?? [], groundRegs: groundRegs ?? [] })
    setLoadingStudent(false)
  }

  useEffect(() => { if (selectedStudent) loadStudentRecord(selectedStudent) }, [selectedStudent])

  async function loadAircraftHours() {
    const { data: aircraft } = await supabase.from('aircraft').select('id, tail_number, make, model, total_hours').order('tail_number')
    const { data: lessons } = await supabase.from('lessons').select('aircraft_id, starts_at, ends_at').not('aircraft_id', 'is', null)

    const hoursByAircraft = {}
    for (const l of lessons ?? []) {
      const hrs = l.ends_at ? (new Date(l.ends_at) - new Date(l.starts_at)) / 3600000 : 0
      hoursByAircraft[l.aircraft_id] = (hoursByAircraft[l.aircraft_id] ?? 0) + hrs
    }

    setAircraftData((aircraft ?? []).map(ac => ({
      ...ac,
      scheduledHours: hoursByAircraft[ac.id] ?? 0,
    })))
  }

  function exportMonthly() {
    const csv = toCSV(
      ['Month', 'Lessons', 'Hours', 'Revenue ($)', 'Outstanding ($)'],
      monthlyData.map(m => [m.label, m.lessons, m.hours.toFixed(1), m.revenue.toFixed(2), m.outstanding.toFixed(2)])
    )
    downloadCSV('apex_monthly_summary.csv', csv)
  }

  function exportStudentRecord() {
    if (!studentData) return
    const { profile: p, endorsements, stageChecks, writtenTests, logbook } = studentData
    const rows = [
      ['STUDENT TRAINING RECORD', '', '', '', ''],
      [p?.full_name ?? '', '', '', '', ''],
      ['', '', '', '', ''],
      ['ENDORSEMENTS', '', '', '', ''],
      ['Type', 'Date', 'Instructor', '', ''],
      ...endorsements.map(e => [e.endorsement_type, e.date_given, e.instructor?.full_name ?? '', '', '']),
      ['', '', '', '', ''],
      ['STAGE CHECKS', '', '', '', ''],
      ['Check', 'Date', 'Result', 'Instructor', 'Notes'],
      ...stageChecks.map(s => [s.stage_name, s.date, s.result, s.instructor?.full_name ?? '', s.notes ?? '']),
      ['', '', '', '', ''],
      ['WRITTEN TESTS', '', '', '', ''],
      ['Test', 'Date', 'Score', '', ''],
      ...writtenTests.map(w => [w.test_type, w.date_taken, `${w.score}%`, '', '']),
      ['', '', '', '', ''],
      ['LOGBOOK SUMMARY', '', '', '', ''],
      ['Total Entries', logbook.length, '', '', ''],
      ['Total Hours', logbook.reduce((s, l) => s + (l.total_time ?? 0), 0).toFixed(1), '', '', ''],
    ]
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadCSV(`${p?.full_name?.replace(/\s+/g, '_') ?? 'student'}_training_record.csv`, csv)
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Reports</h2>
          <p className="page-sub">Operations summary & training records</p>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 24 }}>
        <button className={`tab-btn${tab === 'monthly' ? ' tab-btn--active' : ''}`} onClick={() => setTab('monthly')}>Monthly Summary</button>
        <button className={`tab-btn${tab === 'student' ? ' tab-btn--active' : ''}`} onClick={() => setTab('student')}>Student Records</button>
        <button className={`tab-btn${tab === 'aircraft' ? ' tab-btn--active' : ''}`} onClick={() => setTab('aircraft')}>Aircraft Hours</button>
      </div>

      {tab === 'monthly' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn-secondary" onClick={exportMonthly}>⬇ Export CSV</button>
          </div>
          {loading ? <p className="empty-state">Loading…</p> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Month</th><th>Lessons</th><th>Instructor Hours</th><th>Revenue</th><th>Outstanding</th></tr>
                </thead>
                <tbody>
                  {monthlyData.map(m => (
                    <tr key={m.key}>
                      <td style={{ fontWeight: 600 }}>{m.label}</td>
                      <td>{m.lessons}</td>
                      <td>{m.hours.toFixed(1)}</td>
                      <td style={{ color: '#4ade80' }}>${m.revenue.toFixed(2)}</td>
                      <td style={{ color: m.outstanding > 0 ? '#f87171' : 'var(--muted)' }}>${m.outstanding.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>12-Month Total</td>
                    <td>{monthlyData.reduce((s, m) => s + m.lessons, 0)}</td>
                    <td>{monthlyData.reduce((s, m) => s + m.hours, 0).toFixed(1)}</td>
                    <td style={{ color: '#4ade80' }}>${monthlyData.reduce((s, m) => s + m.revenue, 0).toFixed(2)}</td>
                    <td style={{ color: '#f87171' }}>${monthlyData.reduce((s, m) => s + m.outstanding, 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'student' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            <select className="select-input" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            {studentData && (
              <button className="btn-secondary" onClick={exportStudentRecord}>⬇ Export Training Record</button>
            )}
          </div>

          {loadingStudent ? <p className="empty-state">Loading…</p> : studentData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="stat-grid stat-grid--sm">
                <div className="stat-card"><p className="stat-card__label">Endorsements</p><p className="stat-card__value">{studentData.endorsements.length}</p></div>
                <div className="stat-card"><p className="stat-card__label">Stage Checks Passed</p><p className="stat-card__value">{studentData.stageChecks.filter(s => s.result === 'pass').length}</p></div>
                <div className="stat-card"><p className="stat-card__label">Written Tests</p><p className="stat-card__value">{studentData.writtenTests.length}</p></div>
                <div className="stat-card"><p className="stat-card__label">Logbook Hours</p><p className="stat-card__value">{studentData.logbook.reduce((s, l) => s + (l.total_time ?? 0), 0).toFixed(1)}</p></div>
              </div>

              {studentData.endorsements.length > 0 && (
                <div>
                  <h3 className="report-section-title">Endorsements</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Type</th><th>Date</th><th>Instructor</th></tr></thead>
                      <tbody>
                        {studentData.endorsements.map(e => (
                          <tr key={e.id}><td>{e.endorsement_type}</td><td>{new Date(e.date_given).toLocaleDateString()}</td><td>{e.instructor?.full_name ?? '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {studentData.writtenTests.length > 0 && (
                <div>
                  <h3 className="report-section-title">Written Tests</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Test</th><th>Date</th><th>Score</th><th>Result</th></tr></thead>
                      <tbody>
                        {studentData.writtenTests.map(w => (
                          <tr key={w.id}>
                            <td>{w.test_type}</td>
                            <td>{new Date(w.date_taken).toLocaleDateString()}</td>
                            <td style={{ fontWeight: 700, color: w.score >= 70 ? '#4ade80' : '#f87171' }}>{w.score}%</td>
                            <td><span className={w.score >= 70 ? 'badge badge--green' : 'badge badge--red'}>{w.score >= 70 ? 'Pass' : 'Fail'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="empty-state">Select a student to generate their training record.</p>
          )}
        </>
      )}

      {tab === 'aircraft' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Tail #</th><th>Aircraft</th><th>Total Hours (Airframe)</th><th>Scheduled Hours (App)</th><th>Status</th></tr>
            </thead>
            <tbody>
              {aircraftData.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">No aircraft data.</td></tr>
              ) : aircraftData.map(ac => (
                <tr key={ac.id}>
                  <td style={{ fontWeight: 700 }}>{ac.tail_number}</td>
                  <td>{[ac.make, ac.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{ac.total_hours ?? '—'}</td>
                  <td>{ac.scheduledHours.toFixed(1)}</td>
                  <td><span className={ac.status === 'available' ? 'badge badge--green' : ac.status === 'maintenance' ? 'badge badge--yellow' : 'badge badge--red'}>{ac.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}
