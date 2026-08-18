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

// get_retention_kpis() (v69.sql) returns null for any ratio whose
// denominator is 0 (e.g. no profiles old enough yet for D30) -- shown as
// "N/A" rather than a misleading 0%, per this sprint's own guidance
// against false precision.
function fmtKpi(value, suffix) {
  return value === null || value === undefined ? 'N/A' : `${value}${suffix}`
}
function fmtMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'N/A'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`
  return `${(minutes / 1440).toFixed(1)}d`
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
  const [dpeOverall, setDpeOverall] = useState({ totalQuestions: 0, activeStudents: 0, totalCompletions: 0, totalMarkedStudied: 0, avgPerStudent: 0 })
  const [dpeCategoryStats, setDpeCategoryStats] = useState([])
  const [dpeMostStudied, setDpeMostStudied] = useState([])
  const [dpeLeastStudied, setDpeLeastStudied] = useState([])
  const [retentionKpis, setRetentionKpis] = useState(null)
  const [retentionError, setRetentionError] = useState(null)
  const [activationKpis, setActivationKpis] = useState(null)
  const [activationError, setActivationError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const months = last12Months()
      const firstMonth = `${months[0].year}-${String(months[0].month + 1).padStart(2, '0')}-01`

      const [invoicesRes, logbookRes, studentsRes, activeRes, instrRes, dpeCatRes, dpeQRes, dpeProgressRes, retentionRes, activationRes] = await Promise.all([
        supabase.from('invoices').select('amount_cents, status, issued_at').gte('issued_at', firstMonth),
        supabase.from('logbook_entries').select('duration_hours, date').gte('date', firstMonth),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
        supabase.from('lessons').select('student_id').gte('starts_at', new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase.from('profiles').select('id, full_name').eq('role', 'instructor'),
        supabase.from('dpe_categories').select('id, label, sort_order').order('sort_order'),
        supabase.from('dpe_questions').select('id, category, question'),
        supabase.from('portal_question_progress').select('profile_id, question_id, completed, answered_count'),
        // supabase-portal-schema-v69.sql -- one batched RPC for every
        // retention/activation KPI, rather than 10 separate round trips.
        supabase.rpc('get_retention_kpis'),
        // supabase-portal-schema-v72.sql -- the new-member activation
        // EMAIL sequence's own funnel (distinct from get_retention_kpis()
        // above, which covers general retention, not this specific
        // sequence). Default 30-day window.
        supabase.rpc('get_activation_email_kpis'),
      ])

      if (retentionRes.error) setRetentionError(retentionRes.error.message)
      else setRetentionKpis(retentionRes.data)
      if (activationRes.error) setActivationError(activationRes.error.message)
      else setActivationKpis(activationRes.data)

      // ── DPE Question Bank engagement ──
      // "Engaged" = completed (explicit "Mark as Studied") OR answered_count
      // > 0 (the student revealed/answered the question at least once) --
      // NOT completed alone. completed is a separate, much rarer explicit
      // action (toggleStudied(), site/portal-stable.js) that most real
      // activity (viewing a question, revealing the QOTD answer -- see
      // touchLastViewed()/qotdRevealBtn, same file) never touches, which is
      // why this stat previously showed near-0 despite real usage: it was
      // counting only the checkbox click, not the actual studying.
      // "Marked as Fully Studied" below keeps the old, stricter signal as
      // its own distinct stat rather than discarding it.
      const dpeCategories = dpeCatRes.data ?? []
      const dpeQuestions = dpeQRes.data ?? []
      const dpeProgress = dpeProgressRes.data ?? []

      const categoryOf = {}
      dpeQuestions.forEach(q => { categoryOf[q.id] = q.category })

      const activeStudentIds = new Set(dpeProgress.map(p => p.profile_id))
      const engaged = dpeProgress.filter(p => p.completed || (p.answered_count ?? 0) > 0)
      const totalEngaged = engaged.length
      const totalMarkedStudied = dpeProgress.filter(p => p.completed).length

      const engagedCountByQuestion = {}
      engaged.forEach(p => {
        engagedCountByQuestion[p.question_id] = (engagedCountByQuestion[p.question_id] ?? 0) + 1
      })
      const engagedCountByCategory = {}
      engaged.forEach(p => {
        const cat = categoryOf[p.question_id]
        if (!cat) return
        engagedCountByCategory[cat] = (engagedCountByCategory[cat] ?? 0) + 1
      })
      const questionCountByCategory = {}
      dpeQuestions.forEach(q => {
        questionCountByCategory[q.category] = (questionCountByCategory[q.category] ?? 0) + 1
      })

      setDpeOverall({
        totalQuestions: dpeQuestions.length,
        activeStudents: activeStudentIds.size,
        totalCompletions: totalEngaged,
        totalMarkedStudied,
        avgPerStudent: activeStudentIds.size > 0 ? Math.round((totalEngaged / activeStudentIds.size) * 10) / 10 : 0,
      })

      setDpeCategoryStats(dpeCategories.map(cat => {
        const totalQ = questionCountByCategory[cat.id] ?? 0
        const catEngaged = engagedCountByCategory[cat.id] ?? 0
        const possible = totalQ * activeStudentIds.size
        const rate = possible > 0 ? Math.round((catEngaged / possible) * 100) : 0
        return { label: cat.label, totalQ, completions: catEngaged, rate }
      }))

      const questionRanking = dpeQuestions
        .map(q => ({ id: q.id, question: q.question, category: categoryOf[q.id], count: engagedCountByQuestion[q.id] ?? 0 }))
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
          <h2 className="page-title" style={{ fontSize: 22 }}>Retention &amp; Activation</h2>
          <p className="page-sub">get_retention_kpis() (supabase-portal-schema-v69.sql) — see that file for exact definitions</p>
        </div>
      </div>

      {retentionError ? (
        <p className="empty-state" style={{ padding: '12px 0' }}>Data not available ({retentionError})</p>
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <p className="stat-card__label">Active Users (7d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.active_users_7d, '')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Active Users (30d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.active_users_30d, '')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Activation Rate (24h)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.activation_rate_24h_pct, '%')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Time to First Value</p>
            <p className="stat-card__value">{fmtMinutes(retentionKpis?.time_to_first_value_median_minutes)}</p>
          </div>
        </div>
      )}

      {!retentionError && (
        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat-card">
            <p className="stat-card__label">D1 Retention</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.d1_retention_pct, '%')}</p>
            <p className="stat-card__sub">n={retentionKpis?.d1_retention_eligible_cohort_size ?? 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">D7 Retention</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.d7_retention_pct, '%')}</p>
            <p className="stat-card__sub">n={retentionKpis?.d7_retention_eligible_cohort_size ?? 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">D30 Retention</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.d30_retention_pct, '%')}</p>
            <p className="stat-card__sub">n={retentionKpis?.d30_retention_eligible_cohort_size ?? 0}</p>
          </div>
        </div>
      )}

      {!retentionError && (
        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat-card">
            <p className="stat-card__label">Questions / Active User (7d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.questions_per_active_user_7d, '')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Scenarios / Active User (7d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.scenarios_per_active_user_7d, '')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">AI DPE Sessions / Active User (7d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.ai_dpe_sessions_per_active_user_7d, '')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Active Days / WAU (7d)</p>
            <p className="stat-card__value">{fmtKpi(retentionKpis?.avg_active_days_per_wau_7d, '')}</p>
          </div>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        "Meaningful activity" = answering/completing a DPE question, completing a scenario, a practice-set attempt, or an AI DPE session — not just a page view. Ground School attendance isn't included yet (see v69.sql). Signup-day cohorts use UTC calendar dates, not per-member timezone.
      </p>

      <div className="page-header" style={{ marginTop: 40 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: 22 }}>New Member Activation</h2>
          <p className="page-sub">get_activation_email_kpis() (supabase-portal-schema-v72.sql) — signups in the last {activationKpis?.window_days ?? 30} days</p>
        </div>
      </div>

      {activationError ? (
        <p className="empty-state" style={{ padding: '12px 0' }}>Data not available ({activationError})</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <p className="stat-card__label">New Signups</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.new_signups, '')}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">Welcome Email Sent</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.welcome_email_sent, '')}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">Welcome CTA Click Rate</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.welcome_cta_click_rate_pct, '%')}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">Email-Assisted Activation</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.email_assisted_activation_rate_pct, '%')}</p>
            </div>
          </div>
          <div className="stat-grid" style={{ marginTop: 16 }}>
            <div className="stat-card">
              <p className="stat-card__label">24h Activation Rate</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.activation_rate_24h_pct, '%')}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card__label">7d Activation Rate</p>
              <p className="stat-card__value">{fmtKpi(activationKpis?.activation_rate_7d_pct, '%')}</p>
            </div>
          </div>
          {(activationKpis?.activation_by_training_stage?.length > 0 || activationKpis?.activation_by_focus_area?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
              {activationKpis?.activation_by_training_stage?.length > 0 && (
                <div>
                  <p className="stat-card__label" style={{ marginBottom: 8 }}>Activation by Training Stage</p>
                  <table className="data-table">
                    <thead><tr><th>Stage</th><th>n</th><th>Activated</th></tr></thead>
                    <tbody>
                      {activationKpis.activation_by_training_stage.map(row => (
                        <tr key={row.training_stage}>
                          <td>{row.training_stage}</td>
                          <td>{row.total}</td>
                          <td>{fmtKpi(row.activation_rate_pct, '%')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {activationKpis?.activation_by_focus_area?.length > 0 && (
                <div>
                  <p className="stat-card__label" style={{ marginBottom: 8 }}>Activation by Focus Area</p>
                  <table className="data-table">
                    <thead><tr><th>Focus Area</th><th>n</th><th>Activated</th></tr></thead>
                    <tbody>
                      {activationKpis.activation_by_focus_area.map(row => (
                        <tr key={row.focus_area}>
                          <td>{row.focus_area}</td>
                          <td>{row.total}</td>
                          <td>{fmtKpi(row.activation_rate_pct, '%')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            "n" below 10-15 in any row means treat that row's rate as directional, not precise — small-sample noise, not a real trend.
          </p>
        </>
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
          <p className="stat-card__label">Total Questions Engaged</p>
          <p className="stat-card__value">{dpeOverall.totalCompletions}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Avg. Engaged per Active Student</p>
          <p className="stat-card__value">{dpeOverall.avgPerStudent}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Marked as Fully Studied</p>
          <p className="stat-card__value">{dpeOverall.totalMarkedStudied}</p>
        </div>
      </div>

      {dpeCategoryStats.length > 0 && (
        <section className="card" style={{ marginTop: 24 }}>
          <h3 className="card__title">Engagement Rate by Category</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4, marginBottom: 4 }}>
            % of (questions × students who've started) answered or marked studied — normalizes for category size
          </p>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {dpeCategoryStats.map(cat => (
              <div key={cat.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{cat.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cat.completions} engaged · {cat.totalQ} questions</span>
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
          <h3 className="card__title">Most-Engaged Questions</h3>
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
          <h3 className="card__title">Least-Engaged Questions</h3>
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
