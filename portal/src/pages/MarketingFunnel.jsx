import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

// Keep this in sync with EVENT_ALLOWLIST's length in site/analytics-
// events.js -- there's no live link between the vanilla-JS marketing
// site and this React app to read it automatically, so the data-quality
// card's "documented" half is this hardcoded count instead. Update it
// whenever EVENT_ALLOWLIST gains or loses an entry.
const DOCUMENTED_EVENT_COUNT = 43

const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
]

function rangeToDates(key, customStart, customEnd) {
  const now = new Date()
  if (key === 'all') return { start: null, end: null }
  if (key === 'custom') {
    return {
      start: customStart ? new Date(customStart + 'T00:00:00') : null,
      end: customEnd ? new Date(customEnd + 'T23:59:59.999') : null,
    }
  }
  if (key === 'today') return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now }
  const days = key === '7d' ? 7 : key === '90d' ? 90 : 30
  return { start: new Date(now.getTime() - days * 86400000), end: now }
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '$0'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'N/A'
  return `${n.toFixed(digits)}%`
}
function pct(num, den) {
  if (!den) return null
  return (num / den) * 100
}

// Deterministic-only, per the brief -- no AI, no fabricated confidence.
// A row below the sample floor says so instead of quoting a percentage
// that's really just noise from a handful of visitors.
const MIN_SAMPLE = 10

function FunnelRows({ steps }) {
  const top = steps[0]?.users || 0
  // A drop computed from a step with fewer than MIN_SAMPLE users going
  // in is noise, not a leak -- 2 checkout starts -> 0 purchases is a
  // 100% drop by arithmetic, but calling that "the biggest leak" implies
  // a confidence the sample can't support. Excluded from biggestDrop
  // entirely rather than just relabeled, so a tiny-sample step never
  // outranks a real, well-sampled drop earlier in the same funnel.
  let biggestDrop = null
  steps.forEach((s, i) => {
    if (i === 0) return
    const prev = steps[i - 1]
    if (prev.users < MIN_SAMPLE) return
    const dropPct = prev.users > 0 ? ((prev.users - s.users) / prev.users) * 100 : 0
    if (!biggestDrop || dropPct > biggestDrop.dropPct) biggestDrop = { from: prev.label, to: s.label, dropPct }
  })

  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Users</th>
              <th>Step Conversion</th>
              <th>From Top</th>
              <th>Drop-off</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => {
              const prev = i > 0 ? steps[i - 1] : null
              const stepConv = prev ? pct(s.users, prev.users) : null
              const fromTop = pct(s.users, top)
              const dropPct = prev && prev.users > 0 ? ((prev.users - s.users) / prev.users) * 100 : null
              const isBiggest = biggestDrop && prev && biggestDrop.from === prev.label && biggestDrop.to === s.label && biggestDrop.dropPct > 0
              const smallSample = prev && prev.users < MIN_SAMPLE
              return (
                <tr key={s.label} style={isBiggest ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                  <td><strong>{s.label}</strong></td>
                  <td>{s.users.toLocaleString()}</td>
                  <td>{stepConv === null ? '—' : fmtPct(stepConv)}</td>
                  <td>{fromTop === null ? '—' : fmtPct(fromTop)}</td>
                  <td>
                    {dropPct === null ? '—' : smallSample ? (
                      <span style={{ color: 'var(--muted)' }}>{fmtPct(dropPct)} — small sample (n={prev.users})</span>
                    ) : (
                      <span className={isBiggest ? 'badge badge--red' : ''} style={!isBiggest ? { color: 'var(--muted)' } : undefined}>
                        {fmtPct(dropPct)}{isBiggest ? ' — biggest leak' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {top < MIN_SAMPLE && (
        <p className="empty-state" style={{ padding: '8px 0', fontSize: 12 }}>Insufficient sample (n={top}) — treat these rates as directional only.</p>
      )}
    </>
  )
}

function SectionHeader({ title, sub }) {
  return (
    <div className="page-header" style={{ marginTop: 40 }}>
      <div>
        <h2 className="page-title" style={{ fontSize: 20 }}>{title}</h2>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
    </div>
  )
}

export default function MarketingFunnel() {
  const [rangeKey, setRangeKey] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [executive, setExecutive] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [checkridePrep, setCheckridePrep] = useState(null)
  const [groundSchool, setGroundSchool] = useState(null)
  const [utmRows, setUtmRows] = useState([])
  const [channelRows, setChannelRows] = useState([])
  const [activation, setActivation] = useState(null)
  const [revenue, setRevenue] = useState(null)
  const [dataQuality, setDataQuality] = useState(null)
  const [utmSort, setUtmSort] = useState('revenue')

  const { start, end } = useMemo(() => rangeToDates(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])
  const rangeReady = rangeKey !== 'custom' || (customStart && customEnd)

  useEffect(() => {
    if (!rangeReady) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const p_start = start ? start.toISOString() : null
      const p_end = end ? end.toISOString() : null

      const [execRes, readyRes, cpRes, gsRes, utmRes, chanRes, actRes, revRes, dqRes] = await Promise.all([
        supabase.rpc('get_marketing_executive_funnel', { p_start, p_end }),
        supabase.rpc('get_readiness_funnel_stats', { p_start, p_end }),
        supabase.rpc('get_checkride_prep_funnel_stats', { p_start, p_end }),
        supabase.rpc('get_ground_school_funnel_stats', { p_start, p_end }),
        supabase.rpc('get_utm_campaign_performance', { p_start, p_end }),
        supabase.rpc('get_channel_performance', { p_start, p_end }),
        supabase.rpc('get_portal_activation_funnel', { p_start, p_end }),
        supabase.rpc('get_marketing_revenue_summary', { p_start, p_end }),
        supabase.rpc('get_analytics_data_quality', { p_documented_event_count: DOCUMENTED_EVENT_COUNT }),
      ])
      if (cancelled) return

      const firstError = [execRes, readyRes, cpRes, gsRes, utmRes, chanRes, actRes, revRes, dqRes].find(r => r.error)
      if (firstError) setError(firstError.error.message)

      setExecutive(execRes.data || null)
      setReadiness(readyRes.data || null)
      setCheckridePrep(cpRes.data || null)
      setGroundSchool(gsRes.data || null)
      setUtmRows(utmRes.data || [])
      setChannelRows(chanRes.data || [])
      setActivation(actRes.data || null)
      setRevenue(revRes.data || null)
      setDataQuality(dqRes.data || null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [rangeReady, start?.getTime(), end?.getTime()])

  const sortedUtmRows = useMemo(() => {
    const rows = [...utmRows]
    rows.sort((a, b) => (b[utmSort] || 0) - (a[utmSort] || 0))
    return rows
  }, [utmRows, utmSort])

  // Two independent sequences, not one chain -- Apex Advantage is free to
  // join, activate, and train in without ever purchasing, so "Purchase
  // Completed -> Portal Activated" was never a valid funnel step (most
  // activated members never purchased at all). Both start from the same
  // landing_visitors cohort; get_marketing_executive_funnel() (v85)
  // computes them separately server-side.
  const acquisitionSteps = executive ? [
    { label: 'Landing Visitors', users: executive.acquisition_activation.landing_visitors },
    { label: 'Registration Started', users: executive.acquisition_activation.registration_started },
    { label: 'Registration Completed', users: executive.acquisition_activation.registration_completed },
    { label: 'Portal Activated', users: executive.acquisition_activation.portal_activated },
    { label: 'First Training Started', users: executive.acquisition_activation.first_training_started },
  ] : []
  const monetizationSteps = executive ? [
    { label: 'Landing Visitors', users: executive.monetization.landing_visitors },
    { label: 'Checkout Started', users: executive.monetization.checkout_started },
    { label: 'Purchase Completed', users: executive.monetization.purchase_completed },
  ] : []

  // "Account Created" = readiness_signup_completed with mode:'signup'
  // specifically -- a real new Apex account (create-free-account
  // succeeded). mode:'login' (an existing member re-authenticating to
  // retake the assessment) is a separate, non-registration event shown
  // as its own stat below, not folded into this step -- conflating the
  // two overstated new-account growth from this funnel.
  const readinessSteps = readiness ? [
    { label: 'Assessment Viewed', users: readiness.viewed },
    { label: 'Assessment Started', users: readiness.started },
    { label: 'Assessment Completed', users: readiness.completed },
    { label: 'Score Viewed', users: readiness.score_viewed },
    { label: 'Email Gate Opened', users: readiness.signup_started },
    { label: 'Account Created', users: readiness.account_created },
    { label: 'Checkride Prep Clicked', users: readiness.checkride_prep_clicked },
    { label: 'Checkride Prep Purchased', users: readiness.checkride_prep_purchased },
  ] : []

  const checkrideSteps = checkridePrep ? [
    { label: 'Landing Users', users: checkridePrep.landing_users },
    { label: 'Pricing Viewed', users: checkridePrep.pricing_viewed },
    { label: 'Checkout Started', users: checkridePrep.checkout_started },
    { label: 'Purchased', users: checkridePrep.purchases },
  ] : []

  const gsSteps = groundSchool ? [
    { label: 'Schedule Viewers', users: groundSchool.schedule_viewers },
    { label: 'Class Selected', users: groundSchool.class_selected },
    { label: 'Reserve Form Opened', users: groundSchool.reserve_form_opened },
    { label: 'Checkout Started', users: groundSchool.checkout_started },
    { label: 'Purchased', users: groundSchool.purchases },
  ] : []

  const activationSteps = activation ? [
    { label: 'Signups', users: activation.signups },
    { label: 'Onboarding Started', users: activation.onboarding_started },
    { label: 'Onboarding Completed', users: activation.onboarding_completed },
    { label: 'First Action Started', users: activation.onboarding_first_training },
    { label: 'Activated', users: activation.activated },
    { label: 'Returned D1', users: activation.returned_d1 },
    { label: 'Returned D7', users: activation.returned_d7 },
  ] : []

  // ── Deterministic insights (no AI) ──────────────────────────────
  const insights = []
  if (executive && executive.acquisition_activation.landing_visitors >= MIN_SAMPLE) {
    const regStartedRate = pct(executive.acquisition_activation.registration_started, executive.acquisition_activation.landing_visitors)
    if (regStartedRate !== null) insights.push(`${fmtPct(100 - regStartedRate)} of landing visitors never started registration.`)
  }
  if (readiness && readiness.viewed >= MIN_SAMPLE) {
    const startRate = pct(readiness.started, readiness.viewed)
    if (startRate !== null) insights.push(`Readiness Assessment: ${fmtPct(100 - startRate)} of visitors did not start the assessment.`)
  } else if (readiness) {
    insights.push('Readiness Assessment: insufficient sample to report a reliable start rate yet.')
  }
  if (checkridePrep && checkridePrep.landing_users >= MIN_SAMPLE) {
    const checkoutRate = pct(checkridePrep.checkout_started, checkridePrep.landing_users)
    if (checkoutRate !== null) insights.push(`Checkride Prep: ${fmtPct(checkoutRate)} of page visitors reached checkout.`)
  }
  if (groundSchool && groundSchool.schedule_viewers >= MIN_SAMPLE) {
    insights.push(`Ground School: ${groundSchool.class_selected} of ${groundSchool.schedule_viewers} schedule viewers selected a class.`)
  } else if (groundSchool && groundSchool.schedule_viewers > 0) {
    insights.push(`Ground School: ${groundSchool.class_selected} of ${groundSchool.schedule_viewers} schedule viewers selected a class (small sample — directional only).`)
  }
  if (executive && executive.acquisition_activation.registration_started >= MIN_SAMPLE) {
    const completeRate = pct(executive.acquisition_activation.registration_completed, executive.acquisition_activation.registration_started)
    if (completeRate !== null && completeRate >= 70) insights.push(`Registration performs strongly after users begin signup (${fmtPct(completeRate)} completion).`)
  }
  if (readiness && readiness.checkride_prep_clicked >= MIN_SAMPLE) {
    const convRate = pct(readiness.checkride_prep_purchased, readiness.checkride_prep_clicked)
    if (convRate !== null) insights.push(`Readiness → Checkride Prep: ${fmtPct(convRate)} of members who clicked through eventually purchased.`)
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">Marketing &amp; Funnel</h2>
          <p className="page-sub">Where users come from, how far they get, and whether it turns into revenue — from first-party analytics_events, not GA4.</p>
        </div>
      </div>

      <div className="pill-bar" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {RANGE_PRESETS.map(p => (
          <button key={p.key} className={`pill-btn ${rangeKey === p.key ? 'pill-btn--active' : ''}`} onClick={() => setRangeKey(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {rangeKey === 'custom' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <input type="date" className="select-input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ maxWidth: 180 }} />
          <span style={{ color: 'var(--muted)' }}>to</span>
          <input type="date" className="select-input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ maxWidth: 180 }} />
        </div>
      )}

      {error && <p className="empty-state" style={{ padding: '12px 0' }}>Data not available ({error})</p>}
      {loading && <p className="empty-state" style={{ padding: '12px 0' }}>Loading…</p>}

      {!loading && !error && (
        <>
          {insights.length > 0 && (
            <section className="card" style={{ marginBottom: 8 }}>
              <h3 className="card__title">Funnel Insights</h3>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.map((line, i) => (
                  <p key={i} style={{ fontSize: 13.5, color: 'var(--text)', margin: 0 }}>• {line}</p>
                ))}
              </div>
            </section>
          )}

          {/* ── 1. Executive Funnel ── */}
          <SectionHeader title="Executive Funnel" sub="Two independent journeys, not one chain — Apex Advantage is free to join, activate, and train in without ever purchasing, so purchase is never a prerequisite for activation. Cohort = visitors who landed in this range; later steps count whether that same visitor ever reached them (may occur after the selected range)." />
          <h3 className="card__title" style={{ marginBottom: 8 }}>Acquisition &amp; Activation</h3>
          {executive && <FunnelRows steps={acquisitionSteps} />}
          <h3 className="card__title" style={{ marginBottom: 8, marginTop: 20 }}>Monetization</h3>
          {executive && <FunnelRows steps={monetizationSteps} />}

          {/* ── 2. Readiness Assessment Funnel ── */}
          <SectionHeader title="Readiness Assessment Funnel" sub="Cohort = visitors who viewed the assessment in this range (may convert after it). Checkride Prep Clicked counts either the results-page CTA (returning members who log back in) or the post-signup upgrade-modal deep link (new accounts) — both are real, tracked paths to the same conversion moment." />
          {readiness && <FunnelRows steps={readinessSteps} />}
          {readiness && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-card__label">Readiness → Checkride Prep Purchase</p>
                <p className="stat-card__value">{fmtPct(pct(readiness.checkride_prep_purchased, readiness.checkride_prep_clicked))}</p>
                <p className="stat-card__sub">of members who clicked through to Checkride Prep from their results</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Gate Login Completed</p>
                <p className="stat-card__value">{readiness.gate_login_completed}</p>
                <p className="stat-card__sub">existing members re-authenticating to retake the assessment — not a new account, kept separate from Account Created above</p>
              </div>
            </div>
          )}

          {/* ── 3. Checkride Prep Funnel ── */}
          <SectionHeader title="Checkride Prep Funnel" sub="checkride_prep_page_view/checkride_prep_cta_click are GA4-only legacy events with no first-party row — landing_page_viewed and checkout_started (same clicks, product=checkride_prep) are used here instead" />
          {checkridePrep && <FunnelRows steps={checkrideSteps} />}
          {checkridePrep && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-card__label">Revenue</p>
                <p className="stat-card__value" style={{ color: '#4ade80' }}>{fmtMoney(checkridePrep.revenue)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Revenue / Landing Visitor</p>
                <p className="stat-card__value">{checkridePrep.landing_users > 0 ? fmtMoney(checkridePrep.revenue / checkridePrep.landing_users) : 'N/A'}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Revenue / Checkout Start</p>
                <p className="stat-card__value">{checkridePrep.checkout_started > 0 ? fmtMoney(checkridePrep.revenue / checkridePrep.checkout_started) : 'N/A'}</p>
              </div>
            </div>
          )}

          {/* ── 4. Ground School Funnel ── */}
          <SectionHeader title="Ground School Funnel" sub="Single-class vs. full-course purchases, from real checkout/purchase records" />
          {groundSchool && <FunnelRows steps={gsSteps} />}
          {groundSchool && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-card__label">Revenue</p>
                <p className="stat-card__value" style={{ color: '#4ade80' }}>{fmtMoney(groundSchool.revenue)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Avg. Purchase Value</p>
                <p className="stat-card__value">{groundSchool.avg_purchase_value !== null ? fmtMoney(groundSchool.avg_purchase_value) : 'N/A'}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Single-Class / Full-Course Mix</p>
                <p className="stat-card__value">{groundSchool.single_class_purchases} / {groundSchool.full_course_purchases}</p>
              </div>
            </div>
          )}

          {/* ── 5. Acquisition / UTM Performance ── */}
          <SectionHeader title="Acquisition — Campaign Performance" sub="Each user credited to their earliest tagged touch in range (first-touch), not whichever campaign happened to be most recent by checkout" />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[{ k: 'revenue', l: 'Revenue' }, { k: 'landing_users', l: 'Visitors' }, { k: 'purchases', l: 'Purchases' }].map(o => (
              <button key={o.k} className={`pill-btn ${utmSort === o.k ? 'pill-btn--active' : ''}`} onClick={() => setUtmSort(o.k)}>Sort: {o.l}</button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th><th>Medium</th><th>Campaign</th><th>Channel</th>
                  <th>Landing</th><th>Registrations</th><th>Readiness Starts</th><th>Readiness Completes</th>
                  <th>Checkouts</th><th>Purchases</th><th>Revenue</th>
                  <th>Land→Reg</th><th>Land→Checkout</th><th>Land→Purchase</th><th>Rev/Visitor</th>
                </tr>
              </thead>
              <tbody>
                {sortedUtmRows.length === 0 ? (
                  <tr><td colSpan={15} className="empty-state" style={{ padding: '12px 0' }}>No attributed traffic in this range.</td></tr>
                ) : sortedUtmRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.source}</td>
                    <td>{r.medium}</td>
                    <td>{r.campaign}</td>
                    <td><span className="badge badge--yellow">{r.channel}</span></td>
                    <td>{r.landing_users}</td>
                    <td>{r.registrations}</td>
                    <td>{r.readiness_starts}</td>
                    <td>{r.readiness_completes}</td>
                    <td>{r.checkout_starts}</td>
                    <td>{r.purchases}</td>
                    <td>{fmtMoney(r.revenue)}</td>
                    <td>{fmtPct(pct(r.registrations, r.landing_users))}</td>
                    <td>{fmtPct(pct(r.checkout_starts, r.landing_users))}</td>
                    <td>{fmtPct(pct(r.purchases, r.landing_users))}</td>
                    <td>{r.landing_users > 0 ? fmtMoney(r.revenue / r.landing_users) : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            No ad-spend data is stored in Apex today, so ROAS is intentionally not shown here — only revenue and conversion rates, which are real. Wiring in spend (per-campaign, per-day) would let a future pass compute ROAS/CAC directly on top of this same table.
          </p>

          {/* ── 6. Channel Performance ── */}
          <SectionHeader title="Channel Performance" sub="Source/medium rolled up into higher-level channels — a campaign that doesn't cleanly classify is labeled Unknown / Unattributed, never hidden" />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Channel</th><th>Users</th><th>Registrations</th><th>Checkouts</th><th>Purchases</th><th>Revenue</th><th>Purchase Rate</th></tr></thead>
              <tbody>
                {channelRows.length === 0 ? (
                  <tr><td colSpan={7} className="empty-state" style={{ padding: '12px 0' }}>No data in this range.</td></tr>
                ) : [...channelRows].sort((a, b) => b.revenue - a.revenue).map(r => (
                  <tr key={r.channel}>
                    <td><strong>{r.channel}</strong></td>
                    <td>{r.landing_users}</td>
                    <td>{r.registrations}</td>
                    <td>{r.checkout_starts}</td>
                    <td>{r.purchases}</td>
                    <td>{fmtMoney(r.revenue)}</td>
                    <td>{fmtPct(pct(r.purchases, r.landing_users))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 7. Portal Activation ── */}
          <SectionHeader title="Portal Activation" sub="Signup quality, independent of acquisition — does the account holder actually use Apex Advantage? Activated = completed a real training action (a DPE question, a scenario, or an AI DPE session), never just a login, a page view, or finishing onboarding." />
          {activation && <FunnelRows steps={activationSteps} />}
          {activation && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-card__label">Onboarding Goal Saved</p>
                <p className="stat-card__value">{activation.onboarding_goal_saved}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Onboarding Focus Saved</p>
                <p className="stat-card__value">{activation.onboarding_focus_saved}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">First Lesson Started / Completed</p>
                <p className="stat-card__value">{activation.first_lesson_started} / {activation.first_lesson_completed}</p>
              </div>
            </div>
          )}
          {activation && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-card__label">Purchasers</p>
                <p className="stat-card__value">{activation.purchasers}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Purchase → Activation</p>
                <p className="stat-card__value">{fmtPct(pct(activation.purchasers_activated, activation.purchasers))}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Purchase → First Training</p>
                <p className="stat-card__value">{fmtPct(pct(activation.purchasers_first_training, activation.purchasers))}</p>
              </div>
            </div>
          )}

          {/* ── 8. Revenue ── */}
          <SectionHeader title="Revenue" sub="From verified Apex purchase records (the same data the post-checkout success pages use), never raw GA4 purchase-event totals" />
          {revenue && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <p className="stat-card__label">Total Verified Revenue</p>
                  <p className="stat-card__value" style={{ color: '#4ade80' }}>{fmtMoney(revenue.total_revenue)}</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">Verified Purchases</p>
                  <p className="stat-card__value">{revenue.total_purchases}</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">Average Order Value</p>
                  <p className="stat-card__value">{revenue.average_order_value !== null ? fmtMoney(revenue.average_order_value) : 'N/A'}</p>
                </div>
              </div>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="data-table">
                  <thead><tr><th>Product</th><th>Purchases</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {(revenue.by_product || []).map(row => (
                      <tr key={row.product}><td><strong>{row.product}</strong></td><td>{row.purchases}</td><td>{fmtMoney(row.revenue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Revenue is based on verified Apex purchase records (purchase_completed's own price field, sourced the same way the post-checkout success screens are), not raw GA4 purchase-event totals — historical GA4 revenue may be inflated by the duplicate-tracking bug fixed alongside this dashboard and should not be treated as authoritative.
              </p>
            </>
          )}

          {/* ── 10. Data Quality (collapsed by default) ── */}
          <details style={{ marginTop: 40 }}>
            <summary style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', marginBottom: 12 }}>
              Analytics data quality
            </summary>
            {dataQuality && (
              <div className="stat-grid" style={{ marginTop: 8 }}>
                <div className="stat-card">
                  <p className="stat-card__label">GA4 Purchase Dedupe</p>
                  <p className="stat-card__value" style={{ color: dataQuality.purchase_dedupe_status === 'PASS' ? '#4ade80' : dataQuality.purchase_dedupe_status === 'WARNING' ? '#f87171' : 'var(--muted)' }}>{dataQuality.purchase_dedupe_status}</p>
                  <p className="stat-card__sub">{dataQuality.purchase_events_with_session_id} events with session_id, {dataQuality.purchase_distinct_sessions} distinct sessions</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">portal_first_login Uniqueness</p>
                  <p className="stat-card__value" style={{ color: dataQuality.first_login_status === 'PASS' ? '#4ade80' : dataQuality.first_login_status === 'WARNING' ? '#f87171' : 'var(--muted)' }}>{dataQuality.first_login_status}</p>
                  <p className="stat-card__sub">{dataQuality.first_login_events_total} events, {dataQuality.first_login_distinct_profiles} distinct profiles</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">Unattributed Traffic</p>
                  <p className="stat-card__value">{dataQuality.unattributed_pct !== null ? fmtPct(dataQuality.unattributed_pct) : 'N/A'}</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">Event Allowlist Coverage</p>
                  <p className="stat-card__value">{dataQuality.observed_event_count} observed / {dataQuality.documented_event_count} documented</p>
                  <p className="stat-card__sub">observed = distinct event names in the last 90 days (includes GA4-automatic/server-only events not in EVENT_ALLOWLIST by design)</p>
                </div>
                <div className="stat-card">
                  <p className="stat-card__label">Most Recent Event</p>
                  <p className="stat-card__value" style={{ fontSize: 15 }}>{dataQuality.last_event_at ? new Date(dataQuality.last_event_at).toLocaleString() : 'N/A'}</p>
                </div>
              </div>
            )}
            {dataQuality?.funnel_warnings?.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dataQuality.funnel_warnings.map((w, i) => (
                  <p key={i} style={{ fontSize: 13, color: '#f87171', margin: 0 }}>⚠ {w}</p>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              Dedupe/uniqueness checks only reflect events recorded after the analytics reliability fixes shipped — they can't detect or retroactively correct historical duplicates from before session_id/transaction_id existed on these events. Funnel-definition warnings above are computed live against the last 90 days on every load — a step exceeding 100% of its predecessor always means a broken definition (wrong event, wrong cohort, wrong identity), never a real over-100% conversion rate, and is never silently clamped.
            </p>
          </details>
        </>
      )}
    </Layout>
  )
}
