import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Table from './ui/Table.jsx'
import StatusBadge from './ui/StatusBadge.jsx'
import Modal from './Modal.jsx'
import { toOne } from '../lib/postgrestEmbed'

const STAGE_NAMES = {
  1: 'Stage 1 — Foundations to First Solo',
  2: 'Stage 2 — Local Independence & Precision',
  3: 'Stage 3 — Cross-Country, Night & Instruments',
  4: 'Stage 4 — Practical-Test Readiness',
}

const RATINGS = ['N', 'A', 'P', 'R']
const RATING_TONE = { N: 'info', A: 'warning', P: 'success', R: 'danger' }
const DISPOSITIONS = ['Not Started', 'In Progress', 'Repeat Required', 'Remediation Assigned', 'Complete', 'Revalidation Required']
const DISPOSITION_TONE = {
  'Not Started': 'info', 'In Progress': 'warning', 'Repeat Required': 'danger',
  'Remediation Assigned': 'danger', 'Complete': 'success', 'Revalidation Required': 'danger',
}

// Rows the rulebook lets us roll up from existing logged hours -- every
// other FAA Experience row (qualifying routes, towered ops, the
// preceding-2-calendar-months window) needs an instructor to actually look
// at the logbook and route, so we never guess a number for those; the
// source syllabus is explicit that computed counts never grant eligibility.
const AUTO_COMPUTABLE = new Set(['total_flight', 'dual_flight', 'solo_flight', 'night_instruction', 'night_landings', 'instrument_reference'])

function fmt(n) {
  const v = Number(n ?? 0)
  return (Math.round(v * 100) / 100).toString()
}

export default function PrivatePilotSyllabus({ studentId, canEdit = false }) {
  const [loading, setLoading] = useState(true)
  const [enrollment, setEnrollment] = useState(null)
  const [lessons, setLessons] = useState([])
  const [progressByLesson, setProgressByLesson] = useState({})
  const [logbookByLesson, setLogbookByLesson] = useState({})
  const [faaRequirements, setFaaRequirements] = useState([])
  const [faaChecks, setFaaChecks] = useState({})
  const [faaActuals, setFaaActuals] = useState({})
  const [remediationCases, setRemediationCases] = useState([])
  const [remediationModal, setRemediationModal] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (studentId) load() }, [studentId])

  async function load() {
    setLoading(true)

    const { data: enrollments } = await supabase
      .from('student_syllabi')
      .select('*, syllabus:syllabi!inner(id, name, type, category)')
      .eq('student_id', studentId)
      .eq('syllabus.type', 'flight')
      .eq('syllabus.category', 'Private Pilot')
      .maybeSingle()

    if (!enrollments) {
      setEnrollment(null)
      setLoading(false)
      return
    }
    const en = { ...enrollments, syllabus: toOne(enrollments.syllabus) }
    setEnrollment(en)

    const [{ data: lessonRows }, { data: progressRows }, { data: logbookRows }, { data: faaReqs }, { data: faaCheckRows }, { data: remRows }] = await Promise.all([
      supabase.from('syllabus_lessons').select('*').eq('syllabus_id', en.syllabus.id).order('sort_order'),
      supabase.from('syllabus_lesson_progress').select('*').eq('student_syllabus_id', en.id),
      supabase.from('logbook_entries').select('syllabus_lesson_id, date, dual_received, solo_time').eq('student_id', studentId).not('syllabus_lesson_id', 'is', null),
      supabase.from('faa_experience_requirements').select('*').order('sort_order'),
      supabase.from('student_faa_experience_checks').select('*').eq('student_id', studentId),
      supabase.from('remediation_cases').select('*, lesson:syllabus_lesson_id(lesson_code, title)').eq('student_syllabus_id', en.id).order('identified_date', { ascending: false }),
    ])

    setLessons(lessonRows ?? [])
    setProgressByLesson(Object.fromEntries((progressRows ?? []).map(p => [p.syllabus_lesson_id, p])))

    const byLesson = {}
    for (const row of logbookRows ?? []) {
      const b = byLesson[row.syllabus_lesson_id] ?? { attempts: 0, actualDual: 0, actualSolo: 0, lastDate: null }
      b.attempts += 1
      b.actualDual += Number(row.dual_received ?? 0)
      b.actualSolo += Number(row.solo_time ?? 0)
      if (!b.lastDate || row.date > b.lastDate) b.lastDate = row.date
      byLesson[row.syllabus_lesson_id] = b
    }
    setLogbookByLesson(byLesson)

    setFaaRequirements(faaReqs ?? [])
    setFaaChecks(Object.fromEntries((faaCheckRows ?? []).map(c => [c.requirement_key, c])))
    setRemediationCases((remRows ?? []).map(r => ({ ...r, lesson: toOne(r.lesson) })))

    // FAA experience actuals: aggregate over ALL of the student's logged
    // flight time, not just lessons tagged to the syllabus -- experience
    // requirements are about the student's total logbook, not one course.
    const { data: allLogbook } = await supabase
      .from('logbook_entries')
      .select('total_time, dual_received, solo_time, night_time, actual_instrument, simulated_instrument, night_landings')
      .eq('student_id', studentId)
    const sum = (key, fallback) => (allLogbook ?? []).reduce((s, r) => s + Number(r[key] ?? fallback?.(r) ?? 0), 0)
    setFaaActuals({
      total_flight: sum('total_time'),
      dual_flight: sum('dual_received'),
      solo_flight: sum('solo_time'),
      night_instruction: sum('night_time'),
      night_landings: sum('night_landings'),
      instrument_reference: (allLogbook ?? []).reduce((s, r) => s + Number(r.actual_instrument ?? 0) + Number(r.simulated_instrument ?? 0), 0),
    })

    setLoading(false)
  }

  function lessonStats(lesson) {
    const progress = progressByLesson[lesson.id]
    const lb = logbookByLesson[lesson.id]
    const actualDual = lb?.actualDual ?? 0
    const actualSolo = lb?.actualSolo ?? 0
    const actualGround = Number(progress?.actual_ground ?? 0)
    const attempts = (lb?.attempts ?? 0) + (lesson.mode === 'Ground' && actualGround > 0 ? 1 : 0)
    const lastDate = [lb?.lastDate, progress?.last_date].filter(Boolean).sort().slice(-1)[0] ?? null
    return { progress, actualDual, actualSolo, actualGround, attempts, lastDate }
  }

  async function updateProgress(lesson, patch) {
    if (!canEdit || !enrollment) return
    setSaving(true)
    const existing = progressByLesson[lesson.id]
    const payload = { student_syllabus_id: enrollment.id, syllabus_lesson_id: lesson.id, ...patch, updated_at: new Date().toISOString() }
    const { data, error } = existing
      ? await supabase.from('syllabus_lesson_progress').update(patch).eq('id', existing.id).select().maybeSingle()
      : await supabase.from('syllabus_lesson_progress').insert(payload).select().maybeSingle()
    setSaving(false)
    if (!error && data) setProgressByLesson(p => ({ ...p, [lesson.id]: data }))
  }

  function openRemediation(lesson) {
    setRemediationModal({ lesson, task: '', evidence: '', likely_cause: '', corrective_ground: '', corrective_flight: '', recheck_standard: '' })
  }

  async function submitRemediation(e) {
    e.preventDefault()
    if (!remediationModal || !enrollment) return
    setSaving(true)
    const { lesson, ...fields } = remediationModal
    const { data, error } = await supabase.from('remediation_cases').insert({
      student_syllabus_id: enrollment.id,
      syllabus_lesson_id: lesson.id,
      ...fields,
    }).select('*, lesson:syllabus_lesson_id(lesson_code, title)').maybeSingle()
    if (!error && data) {
      setRemediationCases(c => [{ ...data, lesson: toOne(data.lesson) }, ...c])
      await updateProgress(lesson, { disposition: 'Remediation Assigned', remediation_case_id: data.id })
    }
    setSaving(false)
    setRemediationModal(null)
  }

  async function closeRemediationCase(caseRow, result) {
    if (!canEdit) return
    const { data, error } = await supabase.from('remediation_cases')
      .update({ status: 'Closed', result, closed_date: new Date().toISOString().slice(0, 10) })
      .eq('id', caseRow.id).select('*, lesson:syllabus_lesson_id(lesson_code, title)').maybeSingle()
    if (!error && data) setRemediationCases(c => c.map(r => r.id === data.id ? { ...data, lesson: toOne(data.lesson) } : r))
  }

  async function toggleFaaVerified(req) {
    if (!canEdit) return
    const existing = faaChecks[req.requirement_key]
    const verified = !existing?.verified
    const payload = {
      student_id: studentId, requirement_key: req.requirement_key, verified,
      verified_date: verified ? new Date().toISOString().slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = existing
      ? await supabase.from('student_faa_experience_checks').update(payload).eq('id', existing.id).select().maybeSingle()
      : await supabase.from('student_faa_experience_checks').insert(payload).select().maybeSingle()
    if (!error && data) setFaaChecks(c => ({ ...c, [req.requirement_key]: data }))
  }

  if (loading) return <p className="empty-state">Loading syllabus…</p>
  if (!enrollment) return <p className="empty-state" style={{ padding: '8px 0' }}>Not enrolled in the Private Pilot syllabus.</p>

  const stages = [1, 2, 3, 4].map(stage => {
    const stageLessons = lessons.filter(l => l.stage === stage)
    const planFlight = stageLessons.reduce((s, l) => s + Number(l.plan_flight_hours ?? 0), 0)
    const planGround = stageLessons.reduce((s, l) => s + Number(l.plan_ground_hours ?? 0), 0)
    const actualFlight = stageLessons.reduce((s, l) => { const st = lessonStats(l); return s + st.actualDual + st.actualSolo }, 0)
    const actualGround = stageLessons.reduce((s, l) => s + lessonStats(l).actualGround, 0)
    return { stage, planFlight, planGround, actualFlight, actualGround }
  })
  const totalPlanFlight = stages.reduce((s, x) => s + x.planFlight, 0)
  const totalPlanGround = stages.reduce((s, x) => s + x.planGround, 0)
  const openCases = remediationCases.filter(c => c.status !== 'Closed')

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="card__title">Stage Summary</p>
        <Table>
          <thead><tr><th>Stage</th><th>Plan Flight</th><th>Plan Ground</th><th>Actual Flight</th><th>Actual Ground</th></tr></thead>
          <tbody>
            {stages.map(s => (
              <tr key={s.stage}>
                <td>{STAGE_NAMES[s.stage]}</td>
                <td>{fmt(s.planFlight)}</td>
                <td>{fmt(s.planGround)}</td>
                <td>{fmt(s.actualFlight)}</td>
                <td>{fmt(s.actualGround)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Total</td>
              <td>{fmt(totalPlanFlight)}</td>
              <td>{fmt(totalPlanGround)}</td>
              <td>{fmt(stages.reduce((s, x) => s + x.actualFlight, 0))}</td>
              <td>{fmt(stages.reduce((s, x) => s + x.actualGround, 0))}</td>
            </tr>
          </tbody>
        </Table>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Planning hours, not a guaranteed number of flights or a completion-time promise.</p>
      </div>

      {[1, 2, 3, 4].map(stage => (
        <div className="card" style={{ marginBottom: 20 }} key={stage}>
          <p className="card__title">{STAGE_NAMES[stage]}</p>
          <Table>
            <thead>
              <tr>
                <th>Unit</th><th>Title</th><th>Mode</th><th>Plan Hrs</th><th>Actual Hrs</th>
                <th>Attempts</th><th>Rating</th><th>Disposition</th><th>Last Date</th>{canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lessons.filter(l => l.stage === stage).map(lesson => {
                const st = lessonStats(lesson)
                const planHrs = Number(lesson.plan_flight_hours ?? 0) + Number(lesson.plan_ground_hours ?? 0)
                const actualHrs = st.actualDual + st.actualSolo + st.actualGround
                const rating = st.progress?.rating ?? 'N'
                const disposition = st.progress?.disposition ?? 'Not Started'
                return (
                  <tr key={lesson.id}>
                    <td>{lesson.lesson_code}</td>
                    <td className="td-notes">{lesson.title.replace(/^[FG]\d+\s*[•-]\s*/, '')}</td>
                    <td>{lesson.mode}</td>
                    <td>{fmt(planHrs)}</td>
                    <td>{fmt(actualHrs)}</td>
                    <td>{st.attempts}</td>
                    <td>
                      {canEdit ? (
                        <select className="select-input" style={{ padding: '4px 8px', fontSize: 12 }} value={rating} onChange={e => updateProgress(lesson, { rating: e.target.value })} disabled={saving}>
                          {RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : <StatusBadge tone={RATING_TONE[rating]}>{rating}</StatusBadge>}
                    </td>
                    <td>
                      {canEdit ? (
                        <select className="select-input" style={{ padding: '4px 8px', fontSize: 12 }} value={disposition} onChange={e => updateProgress(lesson, { disposition: e.target.value })} disabled={saving}>
                          {DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      ) : <StatusBadge tone={DISPOSITION_TONE[disposition]}>{disposition}</StatusBadge>}
                    </td>
                    <td>{st.lastDate ? new Date(st.lastDate).toLocaleDateString() : '—'}</td>
                    {canEdit && (
                      <td><button className="btn-link" style={{ color: '#f87171', fontSize: 12 }} onClick={() => openRemediation(lesson)}>Flag remediation</button></td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      ))}

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="card__title">FAA Experience — §61.109(a)</p>
        <Table>
          <thead><tr><th>Requirement</th><th>Minimum</th><th>Actual</th><th>Remaining</th><th>Verified</th></tr></thead>
          <tbody>
            {faaRequirements.map(req => {
              const check = faaChecks[req.requirement_key]
              const actual = check?.manual_actual_override ?? (AUTO_COMPUTABLE.has(req.requirement_key) ? faaActuals[req.requirement_key] ?? 0 : null)
              const remaining = actual == null ? null : Math.max(0, Number(req.minimum) - actual)
              return (
                <tr key={req.requirement_key}>
                  <td>{req.label}</td>
                  <td>{fmt(req.minimum)}</td>
                  <td>{actual == null ? '— (instructor review)' : fmt(actual)}</td>
                  <td>{remaining == null ? '—' : fmt(remaining)}</td>
                  <td>
                    {canEdit ? (
                      <button className={`check-btn${check?.verified ? ' check-btn--done' : ''}`} onClick={() => toggleFaaVerified(req)}>{check?.verified ? '✓' : ''}</button>
                    ) : (
                      <StatusBadge tone={check?.verified ? 'success' : 'info'}>{check?.verified ? 'Verified' : 'Pending'}</StatusBadge>
                    )}
                    {check?.verified_date && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{new Date(check.verified_date).toLocaleDateString()}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Actual figures roll up from logged flight time where that's possible; every row still requires the instructor to verify the source logbook and route before it counts toward eligibility.</p>
      </div>

      <div className="card">
        <p className="card__title">Remediation Cases</p>
        {openCases.length === 0 ? (
          <p className="empty-state" style={{ padding: '8px 0' }}>No open remediation cases.</p>
        ) : openCases.map(c => (
          <div key={c.id} className="activity-row">
            <div style={{ flex: 1 }}>
              <p className="activity-row__primary">{c.lesson?.lesson_code} — {c.task}</p>
              <p className="activity-row__sub">Identified {new Date(c.identified_date).toLocaleDateString()} · {c.failed_attempts} failed attempt(s) · {c.status}{c.recheck_date ? ` · recheck ${new Date(c.recheck_date).toLocaleDateString()}` : ''}</p>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="btn-link" onClick={() => closeRemediationCase(c, 'Resolved')}>Close — Resolved</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {remediationModal && (
        <Modal title={`Flag Remediation — ${remediationModal.lesson.lesson_code}`} onClose={() => setRemediationModal(null)}>
          <form onSubmit={submitRemediation} className="modal-form">
            <div className="form-group">
              <label>Task</label>
              <input type="text" required value={remediationModal.task} onChange={e => setRemediationModal(m => ({ ...m, task: e.target.value }))} placeholder="e.g. Power-off stall recovery" />
            </div>
            <div className="form-group">
              <label>Evidence</label>
              <textarea rows={2} value={remediationModal.evidence} onChange={e => setRemediationModal(m => ({ ...m, evidence: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Likely cause</label>
              <textarea rows={2} value={remediationModal.likely_cause} onChange={e => setRemediationModal(m => ({ ...m, likely_cause: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Corrective ground</label>
              <textarea rows={2} value={remediationModal.corrective_ground} onChange={e => setRemediationModal(m => ({ ...m, corrective_ground: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Corrective flight</label>
              <textarea rows={2} value={remediationModal.corrective_flight} onChange={e => setRemediationModal(m => ({ ...m, corrective_flight: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Recheck standard</label>
              <textarea rows={2} value={remediationModal.recheck_standard} onChange={e => setRemediationModal(m => ({ ...m, recheck_standard: e.target.value }))} />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setRemediationModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Case'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
