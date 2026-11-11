import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import RatingSyllabus, { RATING_CONFIGS } from '../components/RatingSyllabus.jsx'

// Same fixed destination PortalSelector.jsx uses for Apex Advantage --
// a separate app entirely (vanilla-JS site/portal.html), not part of
// this CRM.
const APEX_ADVANTAGE_URL = 'https://apexaviationtx.com'

function formatLessonTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function FlightStudentDashboard() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [totalHours, setTotalHours] = useState(0)
  const [nextLesson, setNextLesson] = useState(null)
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [debriefs, setDebriefs] = useState([])
  const [programs, setPrograms] = useState([]) // enrolled flight syllabi, with lessons + completion
  const [ratingCategories, setRatingCategories] = useState([]) // flight syllabi with a RatingSyllabus config

  useEffect(() => { if (profile) load() }, [profile])

  async function load() {
    setLoading(true)
    const now = new Date().toISOString()

    const [
      { data: hoursRows },
      { data: upcoming, count: upcomingTotal },
      { data: pastWithDebrief },
      { data: enrollments },
    ] = await Promise.all([
      supabase.from('logbook_entries').select('duration_hours').eq('student_id', profile.id),
      supabase.from('lessons')
        .select('*, instructor:profiles!instructor_id(full_name)', { count: 'exact' })
        .eq('student_id', profile.id)
        .gte('starts_at', now)
        .order('starts_at', { ascending: true })
        .limit(1),
      supabase.from('lessons')
        .select('*, instructor:profiles!instructor_id(full_name)')
        .eq('student_id', profile.id)
        .lt('starts_at', now)
        .not('debrief_notes', 'is', null)
        .order('starts_at', { ascending: false })
        .limit(25),
      supabase.from('student_syllabi')
        .select('*, syllabus:syllabi(id, name, category, type)')
        .eq('student_id', profile.id),
    ])

    setTotalHours((hoursRows ?? []).reduce((sum, r) => sum + (r.duration_hours ?? 0), 0))
    setNextLesson(upcoming?.[0] ?? null)
    setUpcomingCount(upcomingTotal ?? 0)
    setDebriefs(pastWithDebrief ?? [])

    setRatingCategories([...new Set((enrollments ?? [])
      .filter(en => en.syllabus?.type === 'flight' && RATING_CONFIGS[en.syllabus?.category])
      .map(en => en.syllabus.category))])

    // Flight syllabi with a RatingSyllabus config get their own full
    // stage/lesson/FAA-experience view below instead of this generic outline.
    const flightEnrollments = (enrollments ?? []).filter(en => en.syllabus?.type === 'flight' && !RATING_CONFIGS[en.syllabus?.category])
    const enriched = await Promise.all(flightEnrollments.map(async en => {
      const [{ data: lessons }, { data: completions }] = await Promise.all([
        supabase.from('syllabus_lessons').select('*').eq('syllabus_id', en.syllabus.id).order('sort_order'),
        supabase.from('lesson_completions').select('syllabus_lesson_id').eq('student_syllabus_id', en.id),
      ])
      const doneIds = new Set((completions ?? []).map(c => c.syllabus_lesson_id))
      const lessonList = lessons ?? []
      const nextUp = lessonList.find(l => !doneIds.has(l.id))
      return { ...en, lessons: lessonList, doneIds, nextUp }
    }))
    setPrograms(enriched)

    setLoading(false)
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Welcome back, {firstName}</h2>
          <p className="page-sub">Your flight training dashboard</p>
        </div>
        <a className="btn-primary-sm" href={APEX_ADVANTAGE_URL} target="_blank" rel="noopener noreferrer">
          Go To Apex Advantage →
        </a>
      </div>

      {loading ? <p className="empty-state">Loading…</p> : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <p className="stat-card__label">Total Logged Hours</p>
              <p className="stat-card__value">{totalHours.toFixed(1)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">Upcoming Lessons</p>
              <p className="stat-card__value">{upcomingCount}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">Programs In Progress</p>
              <p className="stat-card__value">{programs.length}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginTop: 20 }}>

            <section className="card">
              <h3 className="card__title">Next Lesson</h3>
              {!nextLesson ? (
                <p className="empty-state">No upcoming lessons scheduled yet — check with your instructor.</p>
              ) : (
                <div className="activity-row">
                  <div>
                    <p className="activity-row__primary">{nextLesson.lesson_type ?? 'Lesson'}</p>
                    <p className="activity-row__sub">with {nextLesson.instructor?.full_name ?? 'your instructor'}</p>
                  </div>
                  <div className="activity-row__meta">
                    <span>{formatLessonTime(nextLesson.starts_at)}</span>
                  </div>
                </div>
              )}
            </section>

          </div>

          <section className="card" style={{ marginTop: 20 }}>
            <h3 className="card__title">Debrief History</h3>
            {debriefs.length === 0 ? (
              <p className="empty-state">No debrief notes yet — your instructor will add these after a lesson.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 480, overflowY: 'auto' }}>
                {debriefs.map(d => (
                  <div key={d.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
                    <p className="activity-row__sub" style={{ marginBottom: 6 }}>
                      {d.lesson_type ?? 'Lesson'} · {formatLessonTime(d.starts_at)} · {d.instructor?.full_name ?? 'Instructor'}
                    </p>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{d.debrief_notes}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {ratingCategories.map(category => (
            <div style={{ marginTop: 20 }} key={category}>
              <h3 className="card__title" style={{ marginBottom: 12 }}>My {category} Syllabus</h3>
              <RatingSyllabus studentId={profile.id} category={category} canEdit={false} />
            </div>
          ))}

          <section className="card" style={{ marginTop: 20 }}>
            <h3 className="card__title">Program Outline</h3>
            {programs.length === 0 ? (
              <p className="empty-state">You're not enrolled in a flight syllabus yet — check with your instructor.</p>
            ) : programs.map(program => {
              const total = program.lessons.length
              const done = program.doneIds.size
              return (
                <div key={program.id} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div>
                      <p className="activity-row__primary">{program.syllabus.name}</p>
                      <p className="activity-row__sub">{program.syllabus.category}</p>
                    </div>
                    <span className="activity-row__meta">{done}/{total} complete</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {program.lessons.map(lesson => {
                      const isDone = program.doneIds.has(lesson.id)
                      const isNext = program.nextUp?.id === lesson.id
                      return (
                        <div
                          key={lesson.id}
                          className="activity-row"
                          style={isNext ? { borderColor: 'var(--gold)', background: 'rgba(244,180,0,0.06)' } : undefined}
                        >
                          <div>
                            <p className="activity-row__primary">
                              {isDone ? '✓ ' : isNext ? '→ ' : ''}{lesson.title}
                            </p>
                            {lesson.description && <p className="activity-row__sub">{lesson.description}</p>}
                          </div>
                          <div className="activity-row__meta">
                            {isNext && <span style={{ color: 'var(--gold)', fontWeight: 700 }}>Next Up</span>}
                            {lesson.duration_hours && <span>{lesson.duration_hours} hrs</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        </>
      )}
    </Layout>
  )
}
