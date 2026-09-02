import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = [
  ['pilot_qualifications', 'Pilot Qualifications'],
  ['airworthiness', 'Airworthiness Requirements'],
  ['weather', 'Weather'],
  ['cross_country_planning', 'Cross-Country Flight Planning'],
  ['national_airspace_system', 'National Airspace System'],
  ['aircraft_systems', 'Aircraft Systems'],
  ['performance_limitations', 'Performance & Limitations'],
  ['aerodynamics', 'Aerodynamics'],
  ['airport_operations', 'Airport Operations'],
  ['regulations', 'Regulations'],
  ['aeronautical_decision_making', 'Aeronautical Decision Making / Risk Management'],
  ['emergency_abnormal', 'Emergency / Abnormal Scenarios'],
]

const RATINGS = [
  ['not_evaluated', 'Not Evaluated'],
  ['strong', 'Strong'],
  ['satisfactory', 'Satisfactory'],
  ['needs_review', 'Needs Review'],
  ['unsatisfactory', 'Unsatisfactory'],
]

const READINESS_OPTIONS = [
  ['checkride_ready', 'Checkride Ready', 'Consistently demonstrates ACS-level knowledge, application, judgment, and resource management.'],
  ['nearly_ready', 'Nearly Ready', 'Fundamentally prepared with minor deficiencies that should be reviewed before the practical test.'],
  ['needs_targeted_review', 'Needs Targeted Review', 'Multiple knowledge/application areas should be corrected before attempting the practical test.'],
  ['not_yet_ready', 'Not Yet Ready', 'Significant deficiencies exist that make additional preparation strongly advisable before the practical test.'],
]

const DIFFICULTY_LABEL = { 1: 'Foundation', 2: 'Understanding', 3: 'Application', 4: 'Scenario / Judgment' }

function ratingClass(r) {
  return { strong: 'badge badge--green', satisfactory: 'badge badge--blue', needs_review: 'badge badge--yellow', unsatisfactory: 'badge badge--red', not_evaluated: 'badge' }[r] || 'badge'
}

// Apex Advantage Mock Orals — the instructor assessment engine. This is
// a standardization aid, not a script: the question bank below is
// suggestions an instructor can glance at, never a required verbatim
// reading list (per the brief's explicit philosophy). Category ratings
// and notes autosave (debounced) so nothing is lost mid-session and the
// instructor never has to think about "saving."
export default function MockOralAssessment() {
  const { bookingId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [booking, setBooking] = useState(null)
  const [assessment, setAssessment] = useState(null)
  const [scores, setScores] = useState({}) // category -> { rating, notes, weakness_tags }
  const [questionsByCategory, setQuestionsByCategory] = useState({})
  const [openCategory, setOpenCategory] = useState(null)
  const [priorAssessment, setPriorAssessment] = useState(null) // for a recheck: the original mock oral's results
  const [priorBookingsCount, setPriorBookingsCount] = useState(0)
  const [ktrUrl, setKtrUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  const saveTimers = useRef({})

  useEffect(() => { load() }, [bookingId])
  useEffect(() => {
    if (!assessment || assessment.status !== 'in_progress') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [assessment?.status])

  async function load() {
    setLoading(true)
    setError('')
    const { data: b, error: bErr } = await supabase
      .from('mock_oral_bookings')
      .select(`
        *,
        product:mock_oral_products(name, duration_minutes, includes_recheck),
        availability:mock_oral_availability(class_date, start_time, end_time, timezone),
        intake:mock_oral_intakes(*)
      `)
      .eq('id', bookingId)
      .maybeSingle()
    if (bErr || !b) { setError(bErr?.message || 'Booking not found, or you are not authorized to view it.'); setLoading(false); return }
    b.intake = b.intake?.[0] ?? null
    setBooking(b)

    const { data: a } = await supabase.from('mock_oral_assessments').select('*').eq('booking_id', bookingId).maybeSingle()
    setAssessment(a || null)

    if (a) {
      const { data: cs } = await supabase.from('mock_oral_category_scores').select('*').eq('assessment_id', a.id)
      const map = {}
      CATEGORIES.forEach(([cat]) => { map[cat] = { rating: 'not_evaluated', notes: '', weakness_tags: [] } })
      ;(cs || []).forEach(row => { map[row.category] = { rating: row.rating, notes: row.notes || '', weakness_tags: row.weakness_tags || [] } })
      setScores(map)
    }

    // Prior Apex Mock Oral history for this student -- how many total,
    // and (if this booking is itself a recheck) the specific original
    // assessment's results so the instructor sees it immediately.
    const { data: history } = await supabase
      .from('mock_oral_bookings')
      .select('id')
      .eq('profile_id', b.profile_id)
      .neq('id', bookingId)
    setPriorBookingsCount(history?.length || 0)

    if (b.original_booking_id) {
      const { data: origAssessment } = await supabase
        .from('mock_oral_assessments')
        .select('*, category_scores:mock_oral_category_scores(*)')
        .eq('booking_id', b.original_booking_id)
        .maybeSingle()
      setPriorAssessment(origAssessment || null)
    }

    const { data: questions } = await supabase.from('mock_oral_questions').select('*').eq('active', true).eq('certificate_type', 'private_pilot')
    const byCategory = {}
    ;(questions || []).forEach(q => { (byCategory[q.category] = byCategory[q.category] || []).push(q) })
    setQuestionsByCategory(byCategory)

    setLoading(false)
  }

  async function loadKtr() {
    if (!booking?.intake?.knowledge_test_report_path) return
    const { data } = await supabase.storage.from('mock-oral-uploads').createSignedUrl(booking.intake.knowledge_test_report_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function beginAssessment() {
    setSaving(true)
    const payload = { booking_id: bookingId, instructor_id: profile.id, status: 'in_progress', started_at: new Date().toISOString() }
    const { data, error: upsertError } = await supabase.from('mock_oral_assessments').upsert(payload, { onConflict: 'booking_id' }).select().single()
    setSaving(false)
    if (upsertError) { setError(upsertError.message); return }
    setAssessment(data)
    const map = {}
    CATEGORIES.forEach(([cat]) => { map[cat] = { rating: 'not_evaluated', notes: '', weakness_tags: [] } })
    setScores(map)
    // Same analytics_events table apexTrack() writes to from the public
    // site (site/analytics-events.js) -- this is an instructor-side
    // action in the React app, which doesn't load that client helper,
    // so it's inserted directly here in the same shape.
    supabase.from('analytics_events').insert({ event_name: 'mock_oral_session_started', profile_id: booking.profile_id, properties: { certificate_type: 'private_pilot' } }).then(() => {})
  }

  function updateScore(category, field, value) {
    setScores(prev => ({ ...prev, [category]: { ...prev[category], [field]: value } }))
    // Debounced autosave per category -- fast typing in notes doesn't
    // fire a write per keystroke, but nothing is lost if the tab closes
    // (each category saves independently within ~800ms of the last edit).
    clearTimeout(saveTimers.current[category])
    saveTimers.current[category] = setTimeout(() => saveCategory(category), 800)
  }

  async function saveCategory(category) {
    if (!assessment) return
    const s = scores[category]
    await supabase.from('mock_oral_category_scores').upsert({
      assessment_id: assessment.id,
      category,
      rating: s.rating,
      notes: s.notes || null,
      weakness_tags: s.weakness_tags || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'assessment_id,category' })
  }

  function updateAssessmentField(field, value) {
    setAssessment(prev => ({ ...prev, [field]: value }))
    clearTimeout(saveTimers.current['__assessment'])
    saveTimers.current['__assessment'] = setTimeout(() => {
      supabase.from('mock_oral_assessments').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', assessment.id)
    }, 800)
  }

  const nextStepLines = (assessment?.recommended_next_steps || []).map(s => s.label).join('\n')
  function updateNextSteps(text) {
    const steps = text.split('\n').map(l => l.trim()).filter(Boolean).map(label => ({ label }))
    updateAssessmentField('recommended_next_steps', steps)
  }

  async function finishAssessment() {
    if (!assessment.overall_readiness) { setError('Choose an overall readiness rating before finishing.'); return }
    if (!window.confirm('Finish this Mock Oral assessment? The student will be notified their report is ready.')) return
    setSaving(true)
    const elapsed = assessment.started_at ? Math.round((Date.now() - new Date(assessment.started_at).getTime()) / 1000) : 0
    const { error: updateError } = await supabase.from('mock_oral_assessments').update({
      status: 'completed', completed_at: new Date().toISOString(), elapsed_seconds: elapsed, updated_at: new Date().toISOString(),
    }).eq('id', assessment.id)
    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    setAssessment(prev => ({ ...prev, status: 'completed', completed_at: new Date().toISOString(), elapsed_seconds: elapsed }))
    supabase.from('analytics_events').insert({ event_name: 'mock_oral_session_completed', profile_id: booking.profile_id, properties: { certificate_type: 'private_pilot', overall_readiness: assessment.overall_readiness } }).then(() => {})

    // Immediate notification -- doesn't wait for the daily lifecycle-
    // email cron, since "your results are ready" is time-sensitive.
    // send-email is the same Resend passthrough the rest of Apex
    // Advantage already calls directly from the client (see
    // sendPortalEmail() in site/portal-stable.js).
    if (booking?.email) {
      // Recheck recommendation folded into this same email (rather than
      // a wholly separate send) whenever the product includes one and
      // the result suggests it's worth using -- avoids a second,
      // redundant email arriving moments after the first.
      var suggestRecheck = booking.product?.includes_recheck && ['needs_targeted_review', 'not_yet_ready'].includes(assessment.overall_readiness)
      var recheckBlock = suggestRecheck
        ? `<p style="margin-top:16px">Your assessment identified a few areas worth rechecking before checkride day.</p>
           <a href="https://advantage.apexaviationtx.com/portal.html#mock-oral" style="display:inline-block;margin-top:4px;background:transparent;border:1.5px solid #F4B400;color:#F4B400;border-radius:8px;padding:10px 20px;text-decoration:none;font-weight:700">Book My Recheck →</a>`
        : ''
      supabase.functions.invoke('send-email', {
        body: {
          to: booking.email,
          subject: 'Your Apex Mock Oral Results Are Ready',
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#06080f;color:#e0e0e0">
            <h2 style="color:#F4B400">Your results are ready, ${(booking.full_name || '').split(' ')[0]}!</h2>
            <p>Your Apex Advantage Mock Oral Performance Report is ready to view in your portal.</p>
            <a href="https://advantage.apexaviationtx.com/portal.html#mock-oral" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700">View My Readiness Report →</a>
            ${recheckBlock}
          </div>`,
        },
      }).catch(() => {})
    }
  }

  const elapsedLabel = useMemo(() => {
    if (!assessment?.started_at) return null
    var totalSec = assessment.status === 'completed' ? (assessment.elapsed_seconds || 0) : Math.round((now - new Date(assessment.started_at).getTime()) / 1000)
    var m = Math.floor(totalSec / 60), s = totalSec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }, [assessment, now])

  if (loading) return <Layout><p className="empty-state">Loading applicant…</p></Layout>
  if (error && !booking) return <Layout><div className="form-error">{error}</div></Layout>
  if (!booking) return null

  const inProgress = assessment && assessment.status !== 'not_started' && assessment.status !== 'completed'
  const completed = assessment?.status === 'completed'

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="page-header__eyebrow">Mock Oral</p>
          <h2 className="page-title">{booking.full_name}{booking.original_booking_id ? ' — Recheck' : ''}</h2>
          <p className="page-sub">Private Pilot · {booking.availability ? new Date(`${booking.availability.class_date}T${booking.availability.start_time}`).toLocaleString() : ''}</p>
        </div>
        {elapsedLabel && <div style={{ fontSize: 22, fontWeight: 800, color: '#F4B400' }}>{elapsedLabel}</div>}
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ── Applicant view — shown always, above the assessment once started ── */}
      <div className="portal-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Applicant Information</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, fontSize: 14 }}>
          <div><strong>Certificate sought</strong><br />{booking.intake?.certificate_sought || 'Private Pilot'}</div>
          <div><strong>Checkride date</strong><br />{booking.intake?.checkride_date ? new Date(booking.intake.checkride_date).toLocaleDateString() : 'Not provided'}</div>
          <div><strong>DPE</strong><br />{booking.intake?.dpe_name || '—'} {booking.intake?.dpe_location ? `(${booking.intake.dpe_location})` : ''}</div>
          <div><strong>Flight school</strong><br />{booking.intake?.flight_school || '—'}</div>
          <div><strong>Primary instructor</strong><br />{booking.intake?.primary_instructor_name || '—'}</div>
          <div><strong>Aircraft</strong><br />{[booking.intake?.aircraft_make, booking.intake?.aircraft_model, booking.intake?.aircraft_year].filter(Boolean).join(' ') || '—'} {booking.intake?.tail_number ? `(${booking.intake.tail_number})` : ''}</div>
          <div><strong>Avionics</strong><br />{booking.intake?.avionics_type || '—'} {booking.intake?.avionics_notes ? `— ${booking.intake.avionics_notes}` : ''}</div>
          <div><strong>Flight hours</strong><br />{booking.intake?.flight_hours ?? '—'}</div>
          <div><strong>Knowledge Test score</strong><br />{booking.intake?.knowledge_test_score ?? '—'} {booking.intake?.knowledge_test_report_path && <button className="btn-link" onClick={loadKtr}>(view report)</button>}</div>
          <div><strong>Previous Apex Mock Orals</strong><br />{priorBookingsCount}</div>
        </div>
        {(booking.intake?.strongest_areas || booking.intake?.weakest_areas || booking.intake?.special_requests) && (
          <div style={{ marginTop: 16, display: 'grid', gap: 10, fontSize: 14 }}>
            {booking.intake?.strongest_areas && <div><strong>Self-identified strengths:</strong> {booking.intake.strongest_areas}</div>}
            {booking.intake?.weakest_areas && <div><strong>Self-identified weaknesses:</strong> {booking.intake.weakest_areas}</div>}
            {booking.intake?.special_requests && <div><strong>Wants evaluated:</strong> {booking.intake.special_requests}</div>}
          </div>
        )}
        {!booking.intake && <p style={{ color: 'var(--muted)', marginTop: 12 }}>This student hasn't completed intake yet.</p>}
      </div>

      {priorAssessment && (
        <div className="portal-card" style={{ marginBottom: 20, borderColor: 'rgba(244,180,0,0.3)' }}>
          <h3 style={{ marginBottom: 8 }}>Original Mock Oral</h3>
          <p><strong>Overall rating:</strong> {READINESS_OPTIONS.find(r => r[0] === priorAssessment.overall_readiness)?.[1] || '—'}</p>
          <p><strong>Weak categories:</strong> {(priorAssessment.category_scores || []).filter(c => ['needs_review', 'unsatisfactory'].includes(c.rating)).map(c => CATEGORIES.find(cc => cc[0] === c.category)?.[1]).filter(Boolean).join(', ') || 'None flagged'}</p>
          {priorAssessment.priority_review_areas && <p><strong>Priority review areas:</strong> {priorAssessment.priority_review_areas}</p>}
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>This recheck should concentrate on these areas rather than repeating the full assessment.</p>
        </div>
      )}

      {!assessment || assessment.status === 'not_started' ? (
        <div className="portal-card" style={{ maxWidth: 520 }}>
          <p style={{ fontWeight: 700, marginBottom: 10 }}>THIS IS AN ASSESSMENT FIRST.</p>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6, marginBottom: 18 }}>
            Ask realistic DPE-style questions. Probe with follow-ups — "why?", "what would you do?" Evaluate understanding, not memorization.
            Don't try to stump the applicant, rapid-fire trivia, or teach after every missed question — save detailed teaching for the debrief.
          </p>
          <button className="btn btn--primary" onClick={beginAssessment} disabled={saving}>Begin Mock Oral</button>
        </div>
      ) : (
        <>
          <div className="portal-card" style={{ marginBottom: 20 }}>
            {CATEGORIES.map(([cat, label]) => {
              const s = scores[cat] || { rating: 'not_evaluated', notes: '' }
              const qs = questionsByCategory[cat] || []
              return (
                <div key={cat} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '16px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <strong>{label}</strong>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span className={ratingClass(s.rating)}>{RATINGS.find(r => r[0] === s.rating)?.[1]}</span>
                      <select value={s.rating} disabled={completed} onChange={e => updateScore(cat, 'rating', e.target.value)}>
                        {RATINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      {qs.length > 0 && !completed && (
                        <button type="button" className="btn-link" onClick={() => setOpenCategory(openCategory === cat ? null : cat)}>
                          {openCategory === cat ? 'Hide prompts' : `Prompts (${qs.length})`}
                        </button>
                      )}
                    </div>
                  </div>
                  {openCategory === cat && (
                    <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                      {qs.map(q => (
                        <div key={q.id} style={{ marginBottom: 10, fontSize: 13 }}>
                          <span className="badge" style={{ marginRight: 8 }}>{DIFFICULTY_LABEL[q.difficulty]}</span>
                          {q.question || q.scenario}
                          {q.follow_ups?.length > 0 && <div style={{ color: 'var(--muted)', marginTop: 2 }}>Follow-up: {q.follow_ups.join(' / ')}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    placeholder="Instructor notes (optional)"
                    value={s.notes}
                    disabled={completed}
                    onChange={e => updateScore(cat, 'notes', e.target.value)}
                    rows={2}
                    style={{ width: '100%', marginTop: 10 }}
                  />
                </div>
              )
            })}
          </div>

          <div className="portal-card">
            <h3 style={{ marginBottom: 14 }}>Overall Readiness</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
              {READINESS_OPTIONS.map(([v, label, desc]) => (
                <label key={v} style={{ border: assessment.overall_readiness === v ? '2px solid #F4B400' : '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, cursor: completed ? 'default' : 'pointer' }}>
                  <input type="radio" name="readiness" disabled={completed} checked={assessment.overall_readiness === v} onChange={() => updateAssessmentField('overall_readiness', v)} style={{ marginRight: 8 }} />
                  <strong>{label}</strong>
                  <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px 0 0' }}>{desc}</p>
                </label>
              ))}
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              Your strongest areas
              <textarea rows={2} disabled={completed} value={assessment.strongest_areas || ''} onChange={e => updateAssessmentField('strongest_areas', e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 14 }}>
              Priority review areas
              <textarea rows={2} disabled={completed} value={assessment.priority_review_areas || ''} onChange={e => updateAssessmentField('priority_review_areas', e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 14 }}>
              Recommended next steps (one per line — e.g. "Module 5 — Airspace Mastery")
              <textarea rows={3} disabled={completed} defaultValue={nextStepLines} onBlur={e => updateNextSteps(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginBottom: 20 }}>
              Instructor summary (optional, shown to student)
              <textarea rows={3} disabled={completed} value={assessment.instructor_summary || ''} onChange={e => updateAssessmentField('instructor_summary', e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            </label>

            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              This assessment represents Apex Aviation's training opinion based on the material evaluated during this Mock Oral. It does not guarantee practical-test performance or replace required instructor endorsements.
            </p>

            {completed ? (
              <span className="status-badge status-badge--success">Assessment Completed</span>
            ) : (
              <button className="btn btn--primary" onClick={finishAssessment} disabled={saving}>Finish Assessment</button>
            )}
            <button className="btn-link" style={{ marginLeft: 16 }} onClick={() => navigate('/mock-orals')}>Back to Mock Orals</button>
          </div>
        </>
      )}
    </Layout>
  )
}
