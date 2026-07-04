import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import Modal from '../components/Modal'

const ENDORSEMENT_TYPES = [
  'Pre-Solo Knowledge Test (61.87b)',
  'Pre-Solo Flight Training (61.87c)',
  'Solo Flight — Local (61.87n)',
  'Solo Cross-Country (61.93)',
  'Solo Night Flying (61.87o)',
  'Complex Aircraft (61.31e)',
  'High-Performance Aircraft (61.31f)',
  'Tailwheel Aircraft (61.31i)',
  'High-Altitude / Pressurized (61.31g)',
  'Instrument Proficiency Check (61.57d)',
  'Checkride Recommendation — Private Pilot',
  'Checkride Recommendation — Instrument',
  'Checkride Recommendation — Commercial',
  'Checkride Recommendation — CFI',
  'Flight Review (61.56)',
  'Other',
]

const STAGE_CHECK_TYPES = [
  'Stage 1 Check', 'Stage 2 Check', 'Stage 3 Check',
  'Pre-Solo Check', 'Pre-XC Check', 'Pre-Checkride Oral',
  'Pre-Checkride Flight', 'Mock Checkride',
]

const WRITTEN_TESTS = [
  'Private Pilot (PAR)', 'Instrument Rating (IRA)', 'Commercial Pilot (CAX)',
  'CFI (FIA)', 'CFII (IGI)', 'ATP (ATM)', 'Ground Instructor (FOI)', 'Other',
]

export default function Endorsements() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const isStudent = profile?.role === 'student'
  const canManage = isAdmin || isInstructor

  const [students, setStudents] = useState([])
  const [selectedStudent, setSelectedStudent] = useState(isStudent ? profile.id : '')
  const [tab, setTab] = useState('endorsements')

  const [endorsements, setEndorsements] = useState([])
  const [stageChecks, setStageChecks] = useState([])
  const [writtenTests, setWrittenTests] = useState([])
  const [loading, setLoading] = useState(false)
  const [instructors, setInstructors] = useState([])

  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [eForm, setEForm] = useState({ endorsement_type: ENDORSEMENT_TYPES[0], endorsement_text: '', date_given: new Date().toISOString().slice(0, 10), instructor_id: '' })
  const [scForm, setScForm] = useState({ stage_name: STAGE_CHECK_TYPES[0], result: 'pass', date: new Date().toISOString().slice(0, 10), notes: '', instructor_id: '' })
  const [wtForm, setWtForm] = useState({ test_type: WRITTEN_TESTS[0], score: '', date_taken: new Date().toISOString().slice(0, 10) })

  useEffect(() => {
    if (canManage) {
      supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name')
        .then(({ data }) => setStudents(data ?? []))
      supabase.from('profiles').select('id, full_name').eq('role', 'instructor').order('full_name')
        .then(({ data }) => setInstructors(data ?? []))
    }
    if (isStudent) loadAll(profile.id)
  }, [])

  useEffect(() => {
    if (selectedStudent) loadAll(selectedStudent)
  }, [selectedStudent])

  async function loadAll(sid) {
    setLoading(true)
    const [{ data: e }, { data: s }, { data: w }] = await Promise.all([
      supabase.from('endorsements').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date_given', { ascending: false }),
      supabase.from('stage_checks').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date', { ascending: false }),
      supabase.from('written_tests').select('*').eq('student_id', sid).order('date_taken', { ascending: false }),
    ])
    setEndorsements(e ?? [])
    setStageChecks(s ?? [])
    setWrittenTests(w ?? [])
    setLoading(false)
  }

  function closeModal() { setModal(null); setFormError('') }

  async function handleAddEndorsement(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('endorsements').insert({
      student_id: selectedStudent,
      instructor_id: eForm.instructor_id || profile.id,
      endorsement_type: eForm.endorsement_type,
      endorsement_text: eForm.endorsement_text || null,
      date_given: eForm.date_given,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); loadAll(selectedStudent)
  }

  async function handleAddStageCheck(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('stage_checks').insert({
      student_id: selectedStudent,
      instructor_id: scForm.instructor_id || profile.id,
      stage_name: scForm.stage_name,
      result: scForm.result,
      date: scForm.date,
      notes: scForm.notes || null,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); loadAll(selectedStudent)
  }

  async function handleAddWrittenTest(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('written_tests').insert({
      student_id: selectedStudent,
      test_type: wtForm.test_type,
      score: parseInt(wtForm.score),
      date_taken: wtForm.date_taken,
    })
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal(); loadAll(selectedStudent)
  }

  const checkridePassing = writtenTests.length > 0 && writtenTests[0]?.score >= 70
  const passedStageChecks = stageChecks.filter(s => s.result === 'pass').length
  const hasCheckrideEndorsement = endorsements.some(e => e.endorsement_type.includes('Checkride'))

  const showContent = isStudent || selectedStudent

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Endorsements & Compliance</h2>
          <p className="page-sub">FAA endorsements, stage checks, and written tests</p>
        </div>
        {showContent && canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'endorsements' && <button className="btn-primary-sm" onClick={() => { setEForm({ endorsement_type: ENDORSEMENT_TYPES[0], endorsement_text: '', date_given: new Date().toISOString().slice(0, 10), instructor_id: '' }); setFormError(''); setModal('endorsement') }}>+ Add Endorsement</button>}
            {tab === 'stage_checks' && <button className="btn-primary-sm" onClick={() => { setScForm({ stage_name: STAGE_CHECK_TYPES[0], result: 'pass', date: new Date().toISOString().slice(0, 10), notes: '', instructor_id: '' }); setFormError(''); setModal('stage_check') }}>+ Log Stage Check</button>}
            {tab === 'written_tests' && <button className="btn-primary-sm" onClick={() => { setWtForm({ test_type: WRITTEN_TESTS[0], score: '', date_taken: new Date().toISOString().slice(0, 10) }); setFormError(''); setModal('written_test') }}>+ Add Test Score</button>}
          </div>
        )}
      </div>

      {canManage && (
        <div style={{ marginBottom: 20 }}>
          <select className="select-input" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
            <option value="">Select a student</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      )}

      {showContent && !loading && (
        <div className="stat-grid stat-grid--sm" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <p className="stat-card__label">Endorsements</p>
            <p className="stat-card__value">{endorsements.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Stage Checks Passed</p>
            <p className="stat-card__value" style={{ color: '#4ade80' }}>{passedStageChecks}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Written Tests</p>
            <p className="stat-card__value">{writtenTests.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Checkride Ready</p>
            <p className="stat-card__value" style={{ fontSize: 20 }}>
              {hasCheckrideEndorsement && checkridePassing ? '✓' : '—'}
            </p>
          </div>
        </div>
      )}

      {showContent && (
        <>
          <div className="tab-bar" style={{ marginBottom: 20 }}>
            <button className={`tab-btn${tab === 'endorsements' ? ' tab-btn--active' : ''}`} onClick={() => setTab('endorsements')}>
              Endorsements ({endorsements.length})
            </button>
            <button className={`tab-btn${tab === 'stage_checks' ? ' tab-btn--active' : ''}`} onClick={() => setTab('stage_checks')}>
              Stage Checks ({stageChecks.length})
            </button>
            <button className={`tab-btn${tab === 'written_tests' ? ' tab-btn--active' : ''}`} onClick={() => setTab('written_tests')}>
              Written Tests ({writtenTests.length})
            </button>
          </div>

          {loading ? <p className="empty-state">Loading…</p> : (
            <>
              {tab === 'endorsements' && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Endorsement</th><th>Date</th><th>Instructor</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {endorsements.length === 0 ? (
                        <tr><td colSpan={4} className="empty-state">No endorsements recorded.</td></tr>
                      ) : endorsements.map(e => (
                        <tr key={e.id}>
                          <td style={{ fontWeight: 600 }}>{e.endorsement_type}</td>
                          <td>{new Date(e.date_given).toLocaleDateString()}</td>
                          <td>{e.instructor?.full_name ?? '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{e.endorsement_text || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === 'stage_checks' && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Stage Check</th><th>Date</th><th>Result</th><th>Instructor</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {stageChecks.length === 0 ? (
                        <tr><td colSpan={5} className="empty-state">No stage checks recorded.</td></tr>
                      ) : stageChecks.map(sc => (
                        <tr key={sc.id}>
                          <td style={{ fontWeight: 600 }}>{sc.stage_name}</td>
                          <td>{new Date(sc.date).toLocaleDateString()}</td>
                          <td>
                            <span className={sc.result === 'pass' ? 'badge badge--green' : sc.result === 'fail' ? 'badge badge--red' : 'badge badge--yellow'}>
                              {sc.result}
                            </span>
                          </td>
                          <td>{sc.instructor?.full_name ?? '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{sc.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === 'written_tests' && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Test</th><th>Date</th><th>Score</th><th>Result</th></tr>
                    </thead>
                    <tbody>
                      {writtenTests.length === 0 ? (
                        <tr><td colSpan={4} className="empty-state">No written test scores recorded.</td></tr>
                      ) : writtenTests.map(wt => (
                        <tr key={wt.id}>
                          <td style={{ fontWeight: 600 }}>{wt.test_type}</td>
                          <td>{new Date(wt.date_taken).toLocaleDateString()}</td>
                          <td style={{ fontWeight: 700, fontSize: 18, color: wt.score >= 70 ? '#4ade80' : '#f87171' }}>{wt.score}%</td>
                          <td><span className={wt.score >= 70 ? 'badge badge--green' : 'badge badge--red'}>{wt.score >= 70 ? 'Pass' : 'Fail'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {!showContent && !loading && (
        <p className="empty-state">Select a student to view their compliance record.</p>
      )}

      {modal === 'endorsement' && (
        <Modal title="Add Endorsement" onClose={closeModal}>
          <form onSubmit={handleAddEndorsement} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Endorsement Type</label>
              <select value={eForm.endorsement_type} onChange={e => setEForm(f => ({ ...f, endorsement_type: e.target.value }))}>
                {ENDORSEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date Given</label>
                <input type="date" value={eForm.date_given} onChange={e => setEForm(f => ({ ...f, date_given: e.target.value }))} required />
              </div>
              {isAdmin && (
                <div className="form-group">
                  <label>Instructor</label>
                  <select value={eForm.instructor_id} onChange={e => setEForm(f => ({ ...f, instructor_id: e.target.value }))}>
                    <option value="">Me</option>
                    {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Endorsement Text / Notes (optional)</label>
              <textarea value={eForm.endorsement_text} onChange={e => setEForm(f => ({ ...f, endorsement_text: e.target.value }))} rows={3} placeholder="I certify that…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Endorsement'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'stage_check' && (
        <Modal title="Log Stage Check" onClose={closeModal}>
          <form onSubmit={handleAddStageCheck} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-row">
              <div className="form-group">
                <label>Stage Check</label>
                <select value={scForm.stage_name} onChange={e => setScForm(f => ({ ...f, stage_name: e.target.value }))}>
                  {STAGE_CHECK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Result</label>
                <select value={scForm.result} onChange={e => setScForm(f => ({ ...f, result: e.target.value }))}>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={scForm.date} onChange={e => setScForm(f => ({ ...f, date: e.target.value }))} required />
              </div>
              {isAdmin && (
                <div className="form-group">
                  <label>Instructor</label>
                  <select value={scForm.instructor_id} onChange={e => setScForm(f => ({ ...f, instructor_id: e.target.value }))}>
                    <option value="">Me</option>
                    {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={scForm.notes} onChange={e => setScForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Areas covered, items to review…" />
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Log Stage Check'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'written_test' && (
        <Modal title="Add Written Test Score" onClose={closeModal}>
          <form onSubmit={handleAddWrittenTest} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Test</label>
              <select value={wtForm.test_type} onChange={e => setWtForm(f => ({ ...f, test_type: e.target.value }))}>
                {WRITTEN_TESTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Score (%)</label>
                <input type="number" min="0" max="100" value={wtForm.score} onChange={e => setWtForm(f => ({ ...f, score: e.target.value }))} required placeholder="70" />
              </div>
              <div className="form-group">
                <label>Date Taken</label>
                <input type="date" value={wtForm.date_taken} onChange={e => setWtForm(f => ({ ...f, date_taken: e.target.value }))} required />
              </div>
            </div>
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Score'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
