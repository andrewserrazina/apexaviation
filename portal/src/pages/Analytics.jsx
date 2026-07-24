import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

function BarChart({ data, valueKey, labelKey, color = 'var(--gold)', unit = '' }) {
  const max = Math.max(...data.map(d => d[valueKey] ?? 0), 1)
  return (
    <div className="bar-chart">
      {data.map((d, i) => {
        const val = d[valueKey] ?? 0
        const pct = (val / max) * 100
        return (
          <div key={i} className="bar-chart__col">
            <span className="bar-chart__val">{unit}{typeof val === 'number' ? val.toFixed(val % 1 === 0 ? 0 : 1) : val}</span>
            <div className="bar-chart__track">
              <div className="bar-chart__fill" style={{ height: `${pct}%`, background: color }} />
            </div>
            <span className="bar-chart__label">{d[labelKey]}</span>
          </div>
        )
      })}
    </div>
  )
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function last12Months() {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_ABBR[d.getMonth()] })
  }
  return months
}

export default function Analytics() {
  const [revenue, setRevenue] = useState([])
  const [hours, setHours] = useState([])
  const [students, setStudents] = useState({ total: 0, active: 0 })
  const [instructorStats, setInstructorStats] = useState([])
  const [dpeOverall, setDpeOverall] = useState({ totalQuestions: 0, activeStudents: 0, totalCompletions: 0, avgPerStudent: 0 })
  const [dpeCategoryStats, setDpeCategoryStats] = useState([])
  const [dpeMostStudied, setDpeMostStudied] = useState([])
  const [dpeLeastStudied, setDpeLeastStudied] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const months = last12Months()
      const firstMonth = `${months[0].year}-${String(months[0].month + 1).padStart(2, '0')}-01`

      const [invoicesRes, logbookRes, studentsRes, activeRes, instrRes, dpeCatRes, dpeQRes, dpeProgressRes] = await Promise.all([
        supabase.from('invoices').select('amount_cents, status, issued_at').gte('issued_at', firstMonth),
        supabase.from('logbook_entries').select('duration_hours, date').gte('date', firstMonth),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
        supabase.from('lessons').select('student_id').gte('starts_at', new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase.from('profiles').select('id, full_name').eq('role', 'instructor'),
        supabase.from('dpe_categories').select('id, label, sort_order').order('sort_order'),
        supabase.from('dpe_questions').select('id, category, question'),
        supabase.from('portal_question_progress').select('profile_id, question_id, completed'),
      ])

      // ── DPE Question Bank engagement ──
      const dpeCategories = dpeCatRes.data ?? []
      const dpeQuestions = dpeQRes.data ?? []
      const dpeProgress = dpeProgressRes.data ?? []

      const categoryOf = {}
      dpeQuestions.forEach(q => { categoryOf[q.id] = q.category })

      const activeStudentIds = new Set(dpeProgress.map(p => p.profile_id))
      const completions = dpeProgress.filter(p => p.completed)
      const totalCompletions = completions.length

      const completionCountByQuestion = {}
      completions.forEach(p => {
        completionCountByQuestion[p.question_id] = (completionCountByQuestion[p.question_id] ?? 0) + 1
      })
      const completionCountByCategory = {}
      completions.forEach(p => {
        const cat = categoryOf[p.question_id]
        if (!cat) return
        completionCountByCategory[cat] = (completionCountByCategory[cat] ?? 0) + 1
      })
      const questionCountByCategory = {}
      dpeQuestions.forEach(q => {
        questionCountByCategory[q.category] = (questionCountByCategory[q.category] ?? 0) + 1
      })

      setDpeOverall({
        totalQuestions: dpeQuestions.length,
        activeStudents: activeStudentIds.size,
        totalCompletions,
        avgPerStudent: activeStudentIds.size > 0 ? Math.round((totalCompletions / activeStudentIds.size) * 10) / 10 : 0,
      })

      setDpeCategoryStats(dpeCategories.map(cat => {
        const totalQ = questionCountByCategory[cat.id] ?? 0
        const catCompletions = completionCountByCategory[cat.id] ?? 0
        const possible = totalQ * activeStudentIds.size
        const rate = possible > 0 ? Math.round((catCompletions / possible) * 100) : 0
        return { label: cat.label, totalQ, completions: catCompletions, rate }
      }))

      const questionRanking = dpeQuestions
        .map(q => ({ id: q.id, question: q.question, category: categoryOf[q.id], count: completionCountByQuestion[q.id] ?? 0 }))
        .sort((a, b) => b.count - a.count)
      setDpeMostStudied(questionRanking.slice(0, 5))
      setDpeLeastStudied(questionRanking.slice(-5).reverse())

      // Revenue by month
      const revByMonth = months.map(m => {
        const relevant = (invoicesRes.data ?? []).filter(inv => {
          const d = new Date(inv.issued_at)
          return d.getFullYear() === m.year && d.getMonth() === m.month
        })
        const paid = relevant.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount_cents ?? 0), 0) / 100
        const outstanding = relevant.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount_cents ?? 0), 0) / 100
        return { label: m.label, paid, outstanding, total: paid + outstanding }
      })
      setRevenue(revByMonth)

      // Hours by month
      const hrsByMonth = months.map(m => {
        const val = (logbookRes.data ?? [])
          .filter(e => {
            const d = new Date(e.date)
            return d.getFullYear() === m.year && d.getMonth() === m.month
          })
          .reduce((s, e) => s + (e.duration_hours ?? 0), 0)
        return { label: m.label, hours: val }
      })
      setHours(hrsByMonth)

      const activeSet = new Set((activeRes.data ?? []).map(l => l.student_id))
      setStudents({ total: studentsRes.count ?? 0, active: activeSet.size })

      // Instructor lesson counts
      if (instrRes.data?.length) {
        const instrWithLessons = await Promise.all(instrRes.data.map(async inst => {
          const { count } = await supabase.from('lessons').select('*', { count: 'exact', head: true }).eq('instructor_id', inst.id).gte('starts_at', firstMonth)
          const { data: hrs } = await supabase.from('logbook_entries').select('duration_hours').eq('instructor_id', inst.id).gte('date', firstMonth)
          const totalHrs = (hrs ?? []).reduce((s, e) => s + (e.duration_hours ?? 0), 0)
          return { name: inst.full_name, lessons: count ?? 0, hours: totalHrs.toFixed(1) }
        }))
        setInstructorStats(instrWithLessons.sort((a, b) => b.lessons - a.lessons))
      }

      setLoading(false)
    }
    load()
  }, [])

  const totalRevenue = revenue.reduce((s, m) => s + m.paid, 0)
  const totalOutstanding = revenue.reduce((s, m) => s + m.outstanding, 0)
  const totalHours = hours.reduce((s, m) => s + m.hours, 0)

  if (loading) return <Layout><p className="empty-state">Loading analytics…</p></Layout>

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics</h2>
          <p className="page-sub">Last 12 months</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card__label">Revenue Collected</p>
          <p className="stat-card__value" style={{ color: '#4ade80' }}>${totalRevenue.toFixed(2)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Outstanding</p>
          <p className="stat-card__value" style={{ color: totalOutstanding > 0 ? '#f87171' : 'var(--text)' }}>${totalOutstanding.toFixed(2)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Flight Hours</p>
          <p className="stat-card__value">{totalHours.toFixed(1)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Total Students</p>
          <p className="stat-card__value">{students.total}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Active (30 days)</p>
          <p className="stat-card__value">{students.active}</p>
        </div>
      </div>

      <div className="analytics-grid">
        <section className="card">
          <h3 className="card__title">Revenue — Paid ($)</h3>
          <BarChart data={revenue} valueKey="paid" labelKey="label" color="var(--gold)" unit="$" />
        </section>

        <section className="card">
          <h3 className="card__title">Flight Hours</h3>
          <BarChart data={hours} valueKey="hours" labelKey="label" color="#60a5fa" />
        </section>
      </div>

      {instructorStats.length > 0 && (
        <section className="card" style={{ marginTop: 24 }}>
          <h3 className="card__title">Instructor Activity (12 months)</h3>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th>Lessons Scheduled</th>
                  <th>Hours Logged</th>
                </tr>
              </thead>
              <tbody>
                {instructorStats.map(i => (
                  <tr key={i.name}>
                    <td><strong>{i.name}</strong></td>
                    <td>{i.lessons}</td>
                    <td>{i.hours} hrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="page-header" style={{ marginTop: 40 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: 22 }}>DPE Question Bank Engagement</h2>
          <p className="page-sub">All time</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card__label">Total Questions</p>
          <p className="stat-card__value">{dpeOverall.totalQuestions}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Students Who've Started</p>
          <p className="stat-card__value">{dpeOverall.activeStudents}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Total Questions Marked Studied</p>
          <p className="stat-card__value">{dpeOverall.totalCompletions}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Avg. Studied per Active Student</p>
          <p className="stat-card__value">{dpeOverall.avgPerStudent}</p>
        </div>
      </div>

      {dpeCategoryStats.length > 0 && (
        <section className="card" style={{ marginTop: 24 }}>
          <h3 className="card__title">Completion Rate by Category</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4, marginBottom: 4 }}>
            % of (questions × students who've started) marked studied — normalizes for category size
          </p>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {dpeCategoryStats.map(cat => (
              <div key={cat.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{cat.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cat.completions} studied · {cat.totalQ} questions</span>
                  <span className="badge badge--yellow">{cat.rate}%</span>
                </div>
                <div className="progress-bar"><div className="progress-bar__fill" style={{ width: `${cat.rate}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="analytics-grid" style={{ marginTop: 24 }}>
        <section className="card">
          <h3 className="card__title">Most-Studied Questions</h3>
          {dpeMostStudied.length === 0 ? <p className="empty-state" style={{ padding: '12px 0' }}>No activity yet.</p> : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dpeMostStudied.map(q => (
                <div key={q.id} className="activity-row">
                  <div style={{ flex: 1 }}>
                    <p className="activity-row__primary">{q.question}</p>
                    <p className="activity-row__sub">{q.id}</p>
                  </div>
                  <span className="badge">{q.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="card__title">Least-Studied Questions</h3>
          {dpeLeastStudied.length === 0 ? <p className="empty-state" style={{ padding: '12px 0' }}>No activity yet.</p> : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dpeLeastStudied.map(q => (
                <div key={q.id} className="activity-row">
                  <div style={{ flex: 1 }}>
                    <p className="activity-row__primary">{q.question}</p>
                    <p className="activity-row__sub">{q.id}</p>
                  </div>
                  <span className="badge">{q.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}
