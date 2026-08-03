import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

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

function firstOfMonth() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function Payroll() {
  const [instructors, setInstructors] = useState([])
  const [logbook, setLogbook] = useState([])
  const [scheduledClasses, setScheduledClasses] = useState([])
  const [legacySessions, setLegacySessions] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodStart, setPeriodStart] = useState(firstOfMonth())
  const [periodEnd, setPeriodEnd] = useState(today())

  const [rateModal, setRateModal] = useState(null) // { instructor }
  const [rateForm, setRateForm] = useState({ hourly_rate: '', ground_school_rate: '' })
  const [rateSaving, setRateSaving] = useState(false)

  const [adjModal, setAdjModal] = useState(null) // { instructor }
  const [adjForm, setAdjForm] = useState({ description: '', amount: '' })
  const [adjSaving, setAdjSaving] = useState(false)

  const [classesModal, setClassesModal] = useState(null) // { instructor }

  useEffect(() => { load() }, [periodStart, periodEnd])

  async function load() {
    setLoading(true)
    const [
      { data: instructorData },
      { data: logbookData },
      { data: classData },
      { data: sessionData },
      { data: adjData },
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, hourly_rate, ground_school_rate').eq('role', 'instructor').order('full_name'),
      supabase.from('logbook_entries').select('instructor_id, duration_hours, date').gte('date', periodStart).lte('date', periodEnd),
      supabase.from('scheduled_ground_classes').select('instructor_id, title, class_date, start_time, end_time, status, actual_start_time, actual_end_time').gte('class_date', periodStart).lte('class_date', periodEnd),
      supabase.from('ground_sessions').select('instructor_id, scheduled_at, duration_minutes'),
      supabase.from('payroll_adjustments').select('*, instructor:instructor_id(full_name)').gte('created_at', periodStart).lte('created_at', `${periodEnd}T23:59:59`),
    ])
    setInstructors(instructorData ?? [])
    setLogbook(logbookData ?? [])
    setScheduledClasses((classData ?? []).filter(c => c.status !== 'canceled'))
    setLegacySessions((sessionData ?? []).filter(s => {
      const d = s.scheduled_at?.slice(0, 10)
      return d && d >= periodStart && d <= periodEnd
    }))
    setAdjustments(adjData ?? [])
    setLoading(false)
  }

  function flightHoursFor(instructorId) {
    return logbook.filter(l => l.instructor_id === instructorId).reduce((s, l) => s + (l.duration_hours ?? 0), 0)
  }

  // Only counts a scheduled_ground_classes row toward pay once it's
  // actually been clocked complete (actual_end_time set via "Finish
  // Class") -- a class merely being scheduled/published no longer means
  // it was taught. Legacy ground_sessions predates that tracking, so it
  // still counts on scheduling alone (see supabase-portal-schema-v60.sql).
  function completedClassesFor(instructorId) {
    return scheduledClasses.filter(c => c.instructor_id === instructorId && c.actual_end_time)
  }

  function classesFor(instructorId) {
    const scheduled = completedClassesFor(instructorId).length
    const legacy = legacySessions.filter(s => s.instructor_id === instructorId).length
    return scheduled + legacy
  }

  function classDurationVarianceMinutes(row) {
    if (!row.actual_start_time || !row.actual_end_time || !row.class_date || !row.start_time || !row.end_time) return null
    const scheduledMinutes = (new Date(`${row.class_date}T${row.end_time}`) - new Date(`${row.class_date}T${row.start_time}`)) / 60000
    const actualMinutes = (new Date(row.actual_end_time) - new Date(row.actual_start_time)) / 60000
    return Math.round(actualMinutes - scheduledMinutes)
  }

  function adjustmentsFor(instructorId) {
    return adjustments.filter(a => a.instructor_id === instructorId).reduce((s, a) => s + (a.amount ?? 0), 0)
  }

  function payFor(inst) {
    const flightPay = flightHoursFor(inst.id) * (inst.hourly_rate ?? 0)
    const groundPay = classesFor(inst.id) * (inst.ground_school_rate ?? 0)
    return flightPay + groundPay + adjustmentsFor(inst.id)
  }

  function openRateModal(inst) {
    setRateForm({ hourly_rate: inst.hourly_rate ?? '', ground_school_rate: inst.ground_school_rate ?? '' })
    setRateModal({ instructor: inst })
  }

  async function saveRates(e) {
    e.preventDefault()
    setRateSaving(true)
    await supabase.from('profiles').update({
      hourly_rate: rateForm.hourly_rate === '' ? null : parseFloat(rateForm.hourly_rate),
      ground_school_rate: rateForm.ground_school_rate === '' ? null : parseFloat(rateForm.ground_school_rate),
    }).eq('id', rateModal.instructor.id)
    setRateSaving(false)
    setRateModal(null)
    load()
  }

  function openAdjModal(inst) {
    setAdjForm({ description: '', amount: '' })
    setAdjModal({ instructor: inst })
  }

  async function saveAdjustment(e) {
    e.preventDefault()
    setAdjSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('payroll_adjustments').insert({
      instructor_id: adjModal.instructor.id,
      description: adjForm.description,
      amount: parseFloat(adjForm.amount),
      created_by: user?.id ?? null,
    })
    setAdjSaving(false)
    setAdjModal(null)
    load()
  }

  function exportCSV() {
    const csv = toCSV(
      ['Instructor', 'Flight Hours', 'Hourly Rate', 'Classes Taught', 'Ground Rate', 'Adjustments ($)', 'Total Pay ($)'],
      instructors.map(inst => [
        inst.full_name,
        flightHoursFor(inst.id).toFixed(1),
        (inst.hourly_rate ?? 0).toFixed(2),
        classesFor(inst.id),
        (inst.ground_school_rate ?? 0).toFixed(2),
        adjustmentsFor(inst.id).toFixed(2),
        payFor(inst).toFixed(2),
      ])
    )
    downloadCSV(`apex_payroll_${periodStart}_to_${periodEnd}.csv`, csv)
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Payroll</h2>
          <p className="page-sub">Instructor hours & pay by period</p>
        </div>
        <button className="btn-secondary" onClick={exportCSV}>⬇ Export CSV</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
        <div className="form-group">
          <label>Period Start</label>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Period End</label>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
        </div>
      </div>

      {loading ? <p className="empty-state">Loading…</p> : instructors.length === 0 ? (
        <p className="empty-state">No instructors found.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Instructor</th>
                <th>Flight Hours</th>
                <th>Hourly Rate</th>
                <th>Classes Taught</th>
                <th>Ground Rate</th>
                <th>Adjustments</th>
                <th>Total Pay</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {instructors.map(inst => (
                <tr key={inst.id}>
                  <td style={{ fontWeight: 600 }}>{inst.full_name}</td>
                  <td>{flightHoursFor(inst.id).toFixed(1)}</td>
                  <td>{inst.hourly_rate != null ? `$${inst.hourly_rate.toFixed(2)}/hr` : '—'}</td>
                  <td>{classesFor(inst.id)}</td>
                  <td>{inst.ground_school_rate != null ? `$${inst.ground_school_rate.toFixed(2)}/class` : '—'}</td>
                  <td style={{ color: adjustmentsFor(inst.id) < 0 ? '#f87171' : adjustmentsFor(inst.id) > 0 ? '#4ade80' : 'var(--muted)' }}>
                    {adjustmentsFor(inst.id) !== 0 ? `$${adjustmentsFor(inst.id).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ fontWeight: 700, color: '#4ade80' }}>${payFor(inst).toFixed(2)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn-link" style={{ fontSize: 12 }} onClick={() => openRateModal(inst)}>Rates</button>
                      <button className="btn-link" style={{ fontSize: 12 }} onClick={() => openAdjModal(inst)}>+ Adjustment</button>
                      {completedClassesFor(inst.id).length > 0 && (
                        <button className="btn-link" style={{ fontSize: 12 }} onClick={() => setClassesModal({ instructor: inst })}>Classes</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td>Total</td>
                <td>{instructors.reduce((s, i) => s + flightHoursFor(i.id), 0).toFixed(1)}</td>
                <td></td>
                <td>{instructors.reduce((s, i) => s + classesFor(i.id), 0)}</td>
                <td></td>
                <td></td>
                <td style={{ color: '#4ade80' }}>${instructors.reduce((s, i) => s + payFor(i), 0).toFixed(2)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {rateModal && (
        <Modal title={`Pay Rates — ${rateModal.instructor.full_name}`} onClose={() => setRateModal(null)}>
          <form onSubmit={saveRates} className="modal-form">
            <div className="form-group">
              <label>Hourly Rate (flight instruction, $/hr)</label>
              <input type="number" step="0.01" min="0" value={rateForm.hourly_rate} onChange={e => setRateForm(f => ({ ...f, hourly_rate: e.target.value }))} placeholder="35.00" />
            </div>
            <div className="form-group">
              <label>Ground School Rate ($/class)</label>
              <input type="number" step="0.01" min="0" value={rateForm.ground_school_rate} onChange={e => setRateForm(f => ({ ...f, ground_school_rate: e.target.value }))} placeholder="75.00" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setRateModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={rateSaving}>{rateSaving ? 'Saving…' : 'Save Rates'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {adjModal && (
        <Modal title={`Add Adjustment — ${adjModal.instructor.full_name}`} onClose={() => setAdjModal(null)}>
          <form onSubmit={saveAdjustment} className="modal-form">
            <div className="form-group">
              <label>Description</label>
              <input type="text" value={adjForm.description} onChange={e => setAdjForm(f => ({ ...f, description: e.target.value }))} required placeholder="Signing bonus, mock oral session, etc." />
            </div>
            <div className="form-group">
              <label>Amount ($, use negative for a deduction)</label>
              <input type="number" step="0.01" value={adjForm.amount} onChange={e => setAdjForm(f => ({ ...f, amount: e.target.value }))} required placeholder="100.00" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setAdjModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={adjSaving}>{adjSaving ? 'Saving…' : 'Add Adjustment'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {classesModal && (
        <Modal title={`Classes Taught — ${classesModal.instructor.full_name}`} onClose={() => setClassesModal(null)} wide>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            Only classes clocked complete (Start Class / Finish Class in Ground School Bidding) count toward pay. Variance beyond 10 minutes from the scheduled time is flagged.
          </p>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Scheduled</th>
                  <th>Actual</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {completedClassesFor(classesModal.instructor.id).map((row, i) => {
                  const variance = classDurationVarianceMinutes(row)
                  return (
                    <tr key={i}>
                      <td><strong>{row.title}</strong><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{row.class_date}</span></td>
                      <td>{row.start_time?.slice(0, 5)}–{row.end_time?.slice(0, 5)}</td>
                      <td>{new Date(row.actual_start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–{new Date(row.actual_end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                      <td style={{ color: variance !== null && Math.abs(variance) >= 10 ? '#f87171' : 'var(--muted)' }}>
                        {variance === null ? '—' : variance > 0 ? `+${variance} min` : `${variance} min`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="modal-form__actions">
            <button type="button" className="btn-secondary" onClick={() => setClassesModal(null)}>Close</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
