import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import { PageHeader, StatsRow, Button } from '../components/ui'
import PrivatePilotSyllabus from '../components/PrivatePilotSyllabus.jsx'
import { toOne } from '../lib/postgrestEmbed'

function toCSV(rows) {
  return rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// One per-student record pulling together the pieces that used to
// require five separate page visits (Syllabi, Logbook, Endorsements,
// XP Ledger, Pilot Journey) to see a full training picture for a
// single student. Each of those pages still owns its own CRUD and
// stays linked-to for the full detail/edit view -- this page
// aggregates for a glance, it doesn't replace them. Replaces the
// "Student Records" tab that used to live inside Reports.jsx (now
// just Monthly Summary + Aircraft Hours).
export default function TrainingRecords() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'

  const [students, setStudents] = useState([])
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [record, setRecord] = useState(null)

  useEffect(() => {
    if (!profile) return
    if (isAdmin) {
      supabase.from('profiles').select('id, full_name').eq('role', 'student').order('full_name').then(({ data }) => setStudents(data ?? []))
    } else if (isInstructor) {
      supabase.from('lessons').select('student_id, student:profiles!student_id(id, full_name)').eq('instructor_id', profile.id).then(({ data }) => {
        const seen = new Set(); const unique = []
        for (const l of data ?? []) {
          const s = toOne(l.student)
          if (s && !seen.has(s.id)) { seen.add(s.id); unique.push(s) }
        }
        setStudents(unique.sort((a, b) => a.full_name.localeCompare(b.full_name)))
      })
    }
  }, [profile])

  useEffect(() => { if (studentId) load(studentId) }, [studentId])

  async function load(sid) {
    setLoading(true)
    const [
      { data: studentProfile },
      { data: endorsements },
      { data: stageChecks },
      { data: writtenTests },
      { data: logbook },
      { data: studentSyllabi },
      { data: milestones },
      { data: milestoneTypes },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', sid).single(),
      supabase.from('endorsements').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date_given', { ascending: false }),
      supabase.from('stage_checks').select('*, instructor:instructor_id(full_name)').eq('student_id', sid).order('date', { ascending: false }),
      supabase.from('written_tests').select('*').eq('student_id', sid).order('date_taken', { ascending: false }),
      supabase.from('logbook_entries').select('*').eq('student_id', sid).order('date', { ascending: false }),
      supabase.from('student_syllabi').select('*, syllabus:syllabi(name, category, type)').eq('student_id', sid),
      supabase.from('member_milestones').select('milestone_key, achieved_on').eq('profile_id', sid).order('achieved_on', { ascending: false }).limit(5),
      supabase.from('journey_milestone_types').select('milestone_key, label'),
    ])

    const syllabusIds = (studentSyllabi ?? []).map(s => s.syllabus_id)
    const { data: completions } = syllabusIds.length
      ? await supabase.from('lesson_completions').select('student_syllabus_id, syllabus_lesson_id').in('student_syllabus_id', (studentSyllabi ?? []).map(s => s.id))
      : { data: [] }
    const { data: syllabusLessons } = syllabusIds.length
      ? await supabase.from('syllabus_lessons').select('id, syllabus_id').in('syllabus_id', syllabusIds)
      : { data: [] }

    const labelByKey = Object.fromEntries((milestoneTypes ?? []).map(t => [t.milestone_key, t.label]))

    setRecord({
      profile: studentProfile,
      endorsements: endorsements ?? [],
      stageChecks: stageChecks ?? [],
      writtenTests: writtenTests ?? [],
      logbook: logbook ?? [],
      syllabusProgress: (studentSyllabi ?? [])
        .map(en => ({ ...en, syllabus: toOne(en.syllabus) }))
        // The Private Pilot flight syllabus gets its own full stage/lesson/FAA-experience
        // view below (<PrivatePilotSyllabus />) instead of this generic progress-bar card.
        .filter(en => !(en.syllabus?.type === 'flight' && en.syllabus?.category === 'Private Pilot'))
        .map(en => {
          const totalLessons = (syllabusLessons ?? []).filter(l => l.syllabus_id === en.syllabus_id).length
          const doneLessons = (completions ?? []).filter(c => c.student_syllabus_id === en.id).length
          return { ...en, totalLessons, doneLessons }
        }),
      milestones: (milestones ?? []).map(m => ({ ...m, label: labelByKey[m.milestone_key] ?? m.milestone_key })),
    })
    setLoading(false)
  }

  function exportRecord() {
    if (!record) return
    const { profile: p, endorsements, stageChecks, writtenTests, logbook } = record
    const rows = [
      ['STUDENT TRAINING RECORD'],
      [p?.full_name ?? ''],
      [],
      ['ENDORSEMENTS'],
      ['Type', 'Date', 'Instructor'],
      ...endorsements.map(e => [e.endorsement_type, e.date_given, e.instructor?.full_name ?? '']),
      [],
      ['STAGE CHECKS'],
      ['Check', 'Date', 'Result', 'Instructor', 'Notes'],
      ...stageChecks.map(s => [s.stage_name, s.date, s.result, s.instructor?.full_name ?? '', s.notes ?? '']),
      [],
      ['WRITTEN TESTS'],
      ['Test', 'Date', 'Score'],
      ...writtenTests.map(w => [w.test_type, w.date_taken, `${w.score}%`]),
      [],
      ['LOGBOOK SUMMARY'],
      ['Total Entries', logbook.length],
      ['Total Hours', logbook.reduce((s, l) => s + (l.duration_hours ?? 0), 0).toFixed(1)],
    ]
    downloadCSV(`${p?.full_name?.replace(/\s+/g, '_') ?? 'student'}_training_record.csv`, toCSV(rows))
  }

  const totalHours = record?.logbook.reduce((s, l) => s + (l.duration_hours ?? 0), 0) ?? 0

  return (
    <Layout>
      <PageHeader
        eyebrow="Apex Operations"
        title="Training Records"
        description="One student's syllabus progress, logbook, endorsements, and milestones."
        actions={record && <Button onClick={exportRecord}>⬇ Export CSV</Button>}
      />

      <div style={{ marginBottom: 24 }}>
        <select className="select-input" value={studentId} onChange={e => setStudentId(e.target.value)}>
          <option value="">Select a student</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>

      {!studentId ? (
        <p className="empty-state">Select a student to view their training record.</p>
      ) : loading || !record ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          <StatsRow
            size="sm"
            stats={[
              { label: 'Rank', value: (record.profile?.current_rank ?? '—').replace(/_/g, ' ') },
              { label: 'Total XP', value: record.profile?.total_xp ?? 0 },
              { label: 'Logbook Hours', value: totalHours.toFixed(1) },
              { label: 'Endorsements', value: record.endorsements.length },
            ]}
          />

          <div style={{ marginBottom: 20 }}>
            <PrivatePilotSyllabus studentId={studentId} canEdit />
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <p className="card__title">Other Syllabus Progress <Link to="/syllabi" className="btn-link" style={{ fontSize: 12, marginLeft: 8 }}>Manage in Syllabi →</Link></p>
            {record.syllabusProgress.length === 0 ? (
              <p className="empty-state" style={{ padding: '8px 0' }}>Not enrolled in any other syllabus.</p>
            ) : record.syllabusProgress.map(en => {
              const pct = en.totalLessons > 0 ? Math.round((en.doneLessons / en.totalLessons) * 100) : 0
              return (
                <div key={en.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>{en.syllabus?.name ?? 'Syllabus'}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{en.doneLessons}/{en.totalLessons} ({pct}%)</span>
                  </div>
                  <div className="progress-bar"><div className="progress-bar__fill" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <p className="card__title">Recent Logbook Entries <Link to="/logbook" className="btn-link" style={{ fontSize: 12, marginLeft: 8 }}>Full Logbook →</Link></p>
            {record.logbook.length === 0 ? (
              <p className="empty-state" style={{ padding: '8px 0' }}>No logbook entries yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="admin-table">
                  <thead><tr><th>Date</th><th>Route</th><th>Total Time</th><th>Remarks</th></tr></thead>
                  <tbody>
                    {record.logbook.slice(0, 5).map(l => (
                      <tr key={l.id}>
                        <td>{new Date(l.date).toLocaleDateString()}</td>
                        <td>{l.route || '—'}</td>
                        <td>{l.total_time ?? l.duration_hours}</td>
                        <td className="td-notes">{l.remarks || l.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <p className="card__title">Endorsements & Checks <Link to="/endorsements" className="btn-link" style={{ fontSize: 12, marginLeft: 8 }}>Manage →</Link></p>
            {record.endorsements.length === 0 && record.stageChecks.length === 0 && record.writtenTests.length === 0 ? (
              <p className="empty-state" style={{ padding: '8px 0' }}>No endorsements, stage checks, or written tests logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {record.endorsements.map(e => (
                  <div key={e.id} className="activity-row">
                    <span className="activity-row__primary">{e.endorsement_type}</span>
                    <span className="activity-row__sub">{new Date(e.date_given).toLocaleDateString()} · {e.instructor?.full_name ?? '—'}</span>
                  </div>
                ))}
                {record.stageChecks.map(s => (
                  <div key={s.id} className="activity-row">
                    <span className="activity-row__primary">{s.stage_name} — {s.result}</span>
                    <span className="activity-row__sub">{new Date(s.date).toLocaleDateString()} · {s.instructor?.full_name ?? '—'}</span>
                  </div>
                ))}
                {record.writtenTests.map(w => (
                  <div key={w.id} className="activity-row">
                    <span className="activity-row__primary">{w.test_type} — {w.score}%</span>
                    <span className="activity-row__sub">{new Date(w.date_taken).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <p className="card__title">Recent Milestones {isAdmin || isInstructor ? <Link to="/pilot-journey" className="btn-link" style={{ fontSize: 12, marginLeft: 8 }}>Full Journey →</Link> : null}</p>
            {record.milestones.length === 0 ? (
              <p className="empty-state" style={{ padding: '8px 0' }}>No milestones recorded yet.</p>
            ) : record.milestones.map((m, i) => (
              <div key={i} className="activity-row">
                <span className="activity-row__primary">{m.label}</span>
                <span className="activity-row__sub">{new Date(m.achieved_on).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  )
}
