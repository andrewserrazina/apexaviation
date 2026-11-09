import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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
  const [tab, setTab] = useState('monthly')
  const [loading, setLoading] = useState(true)

  // Monthly summary state
  const [monthlyData, setMonthlyData] = useState([])

  // Aircraft hours state
  const [aircraftData, setAircraftData] = useState([])

  useEffect(() => {
    loadMonthly()
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

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Reports</h2>
          <p className="page-sub">Operations summary. For a single student's training record, see <Link to="/training-records" className="btn-link">Training Records</Link>.</p>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 24 }}>
        <button className={`tab-btn${tab === 'monthly' ? ' tab-btn--active' : ''}`} onClick={() => setTab('monthly')}>Monthly Summary</button>
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
