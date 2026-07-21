import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ApexLogo from '../components/ApexLogo'
import CalendarGrid from '../components/CalendarGrid'
import { sendRegistrationConfirmation, sendWaitlistConfirmation, sendWaitlistPromotion, sendBulkMessage } from '../lib/email'

const DURATIONS = [60, 90, 120, 150, 180]
const CATEGORIES = ['general', 'private', 'instrument', 'commercial']
const CATEGORY_LABELS = { general: 'General', private: 'Private Pilot', instrument: 'Instrument', commercial: 'Commercial' }
const CATEGORY_COLORS = { general: '#94a3b8', private: '#60a5fa', instrument: '#a78bfa', commercial: '#4ade80' }
const FREQUENCIES = [{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every 2 Weeks' }, { value: 'monthly', label: 'Monthly' }]

const BLANK_SESSION = {
  title: '', description: '', location: '', meet_link: '', instructor_id: '',
  scheduled_at: '', duration_minutes: 90, max_students: 20, category: 'general',
  repeat: false, frequency: 'weekly', occurrences: 4,
}

const BLANK_REG = { full_name: '', email: '' }

function fmt(dt) {
  return new Date(dt).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function statusBadge(s) {
  if (s === 'completed') return { label: 'Completed', color: '#4ade80' }
  if (s === 'checked_in') return { label: 'Checked In', color: '#60a5fa' }
  if (s === 'no_show') return { label: 'No Show', color: '#f87171' }
  return { label: 'Registered', color: 'var(--muted)' }
}

function addInterval(dateStr, frequency, n) {
  const d = new Date(dateStr)
  if (frequency === 'weekly') d.setDate(d.getDate() + 7 * n)
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14 * n)
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + n)
  return d.toISOString()
}

function minutesBetween(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

function startOfWeek(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

// Extracts a usable error message from a supabase.functions.invoke()
// result -- matches the exact pattern already used for create-free-account
// in site/portal-login.html, since the Edge Functions here return the
// same jsonError({ error: '...' }) shape either way.
function extractInvokeError(res) {
  if (res.data && res.data.error) return Promise.resolve(res.data.error)
  const fallback = (res.error && res.error.message) || 'Could not start checkout. Please try again.'
  if (res.error && res.error.context && typeof res.error.context.json === 'function') {
    return res.error.context.json().then(body => (body && body.error) || fallback).catch(() => fallback)
  }
  return Promise.resolve(fallback)
}

export default function GroundSchedule() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()

  const [sessions, setSessions] = useState([])
  const [pastSessions, setPastSessions] = useState([])
  const [instructors, setInstructors] = useState([])
  const [showPast, setShowPast] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_SESSION)
  const [regForm, setRegForm] = useState(BLANK_REG)
  const [manualAddForm, setManualAddForm] = useState(BLANK_REG)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [regSuccess, setRegSuccess] = useState(false)
  const [registrants, setRegistrants] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [copiedLink, setCopiedLink] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [bulkSubject, setBulkSubject] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkSent, setBulkSent] = useState(false)
  const [manualAddError, setManualAddError] = useState('')
  const [manualAddSaving, setManualAddSaving] = useState(false)
  const [view, setView] = useState('cards') // 'cards' | 'calendar' | 'week'
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()))

  async function load() {
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const sessionSelect = '*, ground_registrations(id, is_waitlisted)'
    const [{ data: upcoming }, { data: past }, { data: scheduledClasses }, { data: instructorData }] = await Promise.all([
      supabase.from('ground_sessions').select(sessionSelect).gte('scheduled_at', now).order('scheduled_at'),
      supabase.from('ground_sessions').select(sessionSelect).lt('scheduled_at', now).order('scheduled_at', { ascending: false }),
      // Admin-scheduled Private Pilot curriculum classes
      // (scheduled_ground_classes/scheduled_ground_class_enrollments) --
      // a separate table from the legacy ground_sessions above. Merged
      // in here the same way site/portal-stable.js's loadGroundSchool()
      // already does for the live public portal, so this page shows the
      // same complete picture instead of only half of what's scheduled.
      supabase.from('scheduled_ground_classes').select('*').eq('status', 'published').gte('class_date', today).order('class_date').order('start_time'),
      isAdmin ? supabase.from('profiles').select('id, full_name, email').eq('role', 'instructor').order('full_name') : Promise.resolve({ data: [] }),
    ])

    const legacyUpcoming = (upcoming ?? []).map(s => ({ ...s, kind: 'legacy' }))
    const scheduledUpcoming = (scheduledClasses ?? []).map(c => ({
      kind: 'scheduled_class',
      id: c.id,
      title: c.title,
      description: c.description,
      location: null,
      meet_link: c.meeting_url,
      instructor_id: c.instructor_id,
      scheduled_at: new Date(`${c.class_date}T${c.start_time}`).toISOString(),
      duration_minutes: minutesBetween(c.start_time, c.end_time),
      max_students: c.capacity,
      category: 'private',
      ground_registrations: [],
      enrolled_count: c.enrolled_count ?? 0,
    }))

    setSessions([...legacyUpcoming, ...scheduledUpcoming].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
    setPastSessions((past ?? []).map(s => ({ ...s, kind: 'legacy' })))
    setInstructors(instructorData ?? [])
    setLoading(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.origin + '/ground-schedule')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyAttendLink(type, token, id) {
    navigator.clipboard.writeText(`${window.location.origin}/attend/${type}/${token}`)
    setCopiedLink(`${type}-${id}`)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  useEffect(() => { load() }, [isAdmin])

  function field(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function regField(k, v) { setRegForm(f => ({ ...f, [k]: v })) }

  function openCreate() { setForm(BLANK_SESSION); setFormError(''); setModal('create') }

  function openEdit(s) {
    setActiveSession(s)
    setForm({
      title: s.title, description: s.description ?? '', location: s.location ?? '',
      meet_link: s.meet_link ?? '', scheduled_at: new Date(s.scheduled_at).toISOString().slice(0, 16),
      duration_minutes: s.duration_minutes, max_students: s.max_students,
      category: s.category ?? 'general', instructor_id: s.instructor_id ?? '', repeat: false, frequency: 'weekly', occurrences: 4,
    })
    setFormError('')
    setModal('edit')
  }

  function openRegister(s) {
    setActiveSession(s)
    setRegForm(BLANK_REG)
    setRegSuccess(false)
    setFormError('')
    setModal('register')
  }

  // Shared click handler for calendar/week events -- same routing as the
  // card view's primary action per role/kind (see gs-card__actions below).
  function handleEventClick(s) {
    if (isAdmin) {
      if (s.kind === 'scheduled_class') { navigate('/admin/ground-school-schedule'); return }
      openEdit(s)
      return
    }
    openRegister(s)
  }

  async function openRegistrants(s) {
    setActiveSession(s)
    await refreshRegistrantsFor(s.id)
    setManualAddForm(BLANK_REG)
    setManualAddError('')
    setBulkSubject('')
    setBulkMessage('')
    setBulkSent(false)
    setModal('registrants')
  }

  async function refreshRegistrantsFor(sessionId) {
    const { data } = await supabase
      .from('ground_registrations')
      .select('*')
      .eq('session_id', sessionId)
      .order('registered_at')
    setRegistrants(data ?? [])
    return data ?? []
  }

  async function refreshRegistrants() {
    if (!activeSession) return
    await refreshRegistrantsFor(activeSession.id)
  }

  function closeModal() { setModal(null); setActiveSession(null); setFormError('') }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const base = {
      title: form.title, description: form.description || null, location: form.location || null,
      meet_link: form.meet_link || null, instructor_id: form.instructor_id || null,
      duration_minutes: parseInt(form.duration_minutes), max_students: parseInt(form.max_students),
      category: form.category,
    }
    if (form.repeat) {
      const inserts = Array.from({ length: parseInt(form.occurrences) }, (_, i) => ({
        ...base,
        scheduled_at: addInterval(form.scheduled_at, form.frequency, i),
      }))
      const { error } = await supabase.from('ground_sessions').insert(inserts)
      setSaving(false)
      if (error) { setFormError(error.message); return }
    } else {
      const { error } = await supabase.from('ground_sessions').insert({ ...base, scheduled_at: form.scheduled_at })
      setSaving(false)
      if (error) { setFormError(error.message); return }
    }
    closeModal()
    load()
  }

  async function handleEdit(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const { error } = await supabase.from('ground_sessions').update({
      title: form.title, description: form.description || null, location: form.location || null,
      meet_link: form.meet_link || null, instructor_id: form.instructor_id || null, scheduled_at: form.scheduled_at,
      duration_minutes: parseInt(form.duration_minutes), max_students: parseInt(form.max_students),
      category: form.category,
    }).eq('id', activeSession.id)
    setSaving(false)
    if (error) { setFormError(error.message); return }
    closeModal()
    load()
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this session?')) return
    await supabase.from('ground_sessions').delete().eq('id', id)
    load()
  }

  async function handleRegister(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')

    // scheduled_ground_classes requires real payment up front (its
    // enrollments table has stripe_session_id not null) -- unlike the
    // legacy free-RSVP-then-pay-at-the-door flow below, this goes
    // through the same Stripe Checkout path site/portal-stable.js
    // already uses, then redirects out to complete payment.
    if (activeSession.kind === 'scheduled_class') {
      const res = await supabase.functions.invoke('create-checkout-session', {
        body: { purpose: 'ground-school-registration', scheduledClassId: activeSession.id, name: regForm.full_name, email: regForm.email },
      })
      if (res.error || !res.data?.url) {
        setSaving(false)
        const message = await extractInvokeError(res)
        setFormError(message)
        return
      }
      window.location.href = res.data.url
      return
    }

    const { data: newReg, error } = await supabase
      .rpc('register_for_ground_school', {
        p_session_id: activeSession.id,
        p_full_name: regForm.full_name,
        p_email: regForm.email,
      })
      .single()

    if (error) {
      setSaving(false)
      setFormError(error.message)
      return
    }

    if (newReg) {
      if (newReg.is_waitlisted) {
        sendWaitlistConfirmation(newReg, activeSession)
      } else {
        sendRegistrationConfirmation(newReg, activeSession)
      }
    }

    setSaving(false)
    setRegSuccess(newReg?.is_waitlisted ? 'waitlist' : 'registered')
    load()
  }

  async function handleManualAdd(e) {
    e.preventDefault()
    setManualAddSaving(true)
    setManualAddError('')
    const { error } = await supabase.from('ground_registrations').insert({
      session_id: activeSession.id,
      full_name: manualAddForm.full_name,
      email: manualAddForm.email,
      is_waitlisted: false,
    })
    if (error) {
      setManualAddSaving(false)
      setManualAddError(error.message.includes('unique') ? 'Already registered.' : error.message)
      return
    }
    const { data: newReg } = await supabase
      .from('ground_registrations')
      .select('*')
      .eq('session_id', activeSession.id)
      .eq('email', manualAddForm.email)
      .single()
    if (newReg) sendRegistrationConfirmation(newReg, activeSession)
    setManualAddSaving(false)
    setManualAddForm(BLANK_REG)
    await refreshRegistrants()
    load()
  }

  async function handlePromoteWaitlist(reg) {
    await supabase.from('ground_registrations').update({ is_waitlisted: false }).eq('id', reg.id)
    sendWaitlistPromotion(reg, activeSession)
    await refreshRegistrants()
    load()
  }

  async function markNoShow(regId) {
    await supabase.from('ground_registrations').update({ attendance_status: 'no_show' }).eq('id', regId)
    await refreshRegistrants()
  }

  async function handleCancelRegistration(reg) {
    if (!window.confirm(`Cancel ${reg.full_name}'s registration for this session?`)) return
    await supabase.from('ground_registrations').delete().eq('id', reg.id)
    const updated = await refreshRegistrantsFor(reg.session_id)
    // The freed confirmed spot goes to whoever has been on the waitlist
    // longest (registrants is ordered by registered_at, so the first
    // waitlisted entry is next in line).
    const nextWaitlisted = updated.find(r => r.is_waitlisted)
    if (nextWaitlisted) {
      await supabase.from('ground_registrations').update({ is_waitlisted: false }).eq('id', nextWaitlisted.id)
      sendWaitlistPromotion(nextWaitlisted, activeSession)
      await refreshRegistrantsFor(reg.session_id)
    }
    load()
  }

  async function handleBulkSend(e) {
    e.preventDefault()
    setSaving(true)
    const confirmed = registrants.filter(r => !r.is_waitlisted)
    await sendBulkMessage(confirmed, activeSession, bulkSubject, bulkMessage)
    setSaving(false)
    setBulkSent(true)
  }

  function exportCSV() {
    const headers = ['Name', 'Email', 'Status', 'Waitlisted', 'Registered At', 'Checked In', 'Checked Out']
    const rows = registrants.map(r => [
      r.full_name,
      r.email,
      r.attendance_status ?? 'registered',
      r.is_waitlisted ? 'Yes' : 'No',
      r.registered_at ? new Date(r.registered_at).toLocaleString() : '',
      r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : '',
      r.checked_out_at ? new Date(r.checked_out_at).toLocaleString() : '',
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeSession.title.replace(/[^a-z0-9]/gi, '_')}_registrants.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const confirmedCount = (s) => s.kind === 'scheduled_class' ? (s.enrolled_count ?? 0) : (s.ground_registrations?.filter(r => !r.is_waitlisted).length ?? 0)
  const waitlistCount = (s) => s.kind === 'scheduled_class' ? 0 : (s.ground_registrations?.filter(r => r.is_waitlisted).length ?? 0)
  const spotsLeft = (s) => s.max_students - confirmedCount(s)

  const attendanceSummary = (regs) => {
    const confirmed = regs.filter(r => !r.is_waitlisted)
    return {
      completed: confirmed.filter(r => r.attendance_status === 'completed').length,
      checkedIn: confirmed.filter(r => r.attendance_status === 'checked_in').length,
      noShow: confirmed.filter(r => r.attendance_status === 'no_show').length,
      total: confirmed.length,
    }
  }

  const filteredSessions = categoryFilter === 'all' ? sessions : sessions.filter(s => s.category === categoryFilter)
  const instructorNameFor = (session) => instructors.find(i => i.id === session.instructor_id)?.full_name

  return (
    <div className="public-page">
      <header className="public-header">
        <div className="public-header__inner">
          <Link to="/" className="public-header__brand">
            <ApexLogo size={30} />
            <div className="public-header__brand-text">
              <span className="public-header__name-apex">APEX</span>
              <span className="public-header__name-sub">— AVIATION —</span>
            </div>
          </Link>
          <div className="public-header__actions">
            <button className="btn-secondary" onClick={copyLink} style={{ minWidth: 110 }}>
              {copied ? '✓ Copied!' : '🔗 Share Link'}
            </button>
            {profile ? (
              <Link to="/dashboard" className="btn-secondary">Back to App</Link>
            ) : (
              <Link to="/login" className="btn-secondary">Sign In</Link>
            )}
            {isAdmin && (
              <button className="btn-primary-sm" onClick={openCreate}>+ Add Session</button>
            )}
          </div>
        </div>
      </header>

      <div className="public-hero">
        <p className="public-hero__eyebrow">Something Extraordinary</p>
        <h1 className="public-hero__title">IS TAKING<br /><em>FLIGHT.</em></h1>
        <div className="public-hero__divider" />
        <p className="public-hero__sub">
          Professional ground school for Private Pilot, Instrument Rating, and Commercial certificates.
          Austin, Texas · $25 per session · Pay at the door.
        </p>
      </div>

      {/* Category Filter */}
      <div className="gs-filter-bar">
        {['all', ...CATEGORIES].map(c => (
          <button
            key={c}
            className={`gs-filter-btn${categoryFilter === c ? ' gs-filter-btn--active' : ''}`}
            onClick={() => setCategoryFilter(c)}
          >
            {c === 'all' ? 'All Sessions' : CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* View mode */}
      <div className="gs-filter-bar" style={{ marginTop: -8 }}>
        {[{ id: 'cards', label: 'Cards' }, { id: 'calendar', label: 'Calendar' }, { id: 'week', label: 'This Week' }].map(v => (
          <button
            key={v.id}
            className={`gs-filter-btn${view === v.id ? ' gs-filter-btn--active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="public-content">
        {loading ? (
          <p className="empty-state">Loading sessions…</p>
        ) : view === 'calendar' ? (
          <CalendarGrid
            events={filteredSessions}
            getEventDate={s => new Date(s.scheduled_at)}
            renderEvent={s => (
              <div key={s.id} className="cal-event" onClick={e => { e.stopPropagation(); handleEventClick(s) }}>
                <span>{new Date(s.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{s.title}</span>
              </div>
            )}
          />
        ) : view === 'week' ? (
          <div className="card">
            <div className="cal-nav" style={{ marginBottom: 16 }}>
              <button type="button" className="cal-nav__btn" onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}>‹</button>
              <span className="cal-nav__label">
                {weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              <button type="button" className="cal-nav__btn" onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}>›</button>
            </div>
            {Array.from({ length: 7 }).map((_, i) => {
              const day = new Date(weekStart.getTime() + i * 86400000)
              const daySessions = filteredSessions.filter(s => new Date(s.scheduled_at).toDateString() === day.toDateString())
              return (
                <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    {day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  {daySessions.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--muted)' }}>No sessions</p>
                  ) : daySessions.map(s => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{s.title}</strong>
                        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{new Date(s.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <button className="btn-link" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => handleEventClick(s)}>
                        {isAdmin ? (s.kind === 'scheduled_class' ? 'Manage →' : 'Edit') : (spotsLeft(s) <= 0 ? 'Waitlist' : 'Sign Up')}
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        ) : filteredSessions.length === 0 && !showPast ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p className="empty-state" style={{ marginBottom: 16 }}>No upcoming sessions scheduled. Check back soon!</p>
            {pastSessions.length > 0 && (
              <button className="btn-secondary" onClick={() => setShowPast(true)}>View Past Sessions</button>
            )}
          </div>
        ) : (
          <>
            <div className="gs-grid">
              {filteredSessions.map(s => {
                const spots = spotsLeft(s)
                const full = spots <= 0
                const wl = waitlistCount(s)
                const cat = s.category ?? 'general'
                return (
                  <div key={s.id} className={`gs-card${full ? ' gs-card--full' : ''}`}>
                    <div className="gs-card__head">
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span className="gs-cat-badge" style={{ background: `${CATEGORY_COLORS[cat]}22`, color: CATEGORY_COLORS[cat], borderColor: `${CATEGORY_COLORS[cat]}44` }}>
                            {CATEGORY_LABELS[cat]}
                          </span>
                        </div>
                        <h3 className="gs-card__title">{s.title}</h3>
                        <p className="gs-card__time">{fmt(s.scheduled_at)}</p>
                      </div>
                      <div className="gs-card__badge">
                        {full ? (wl > 0 ? `Full · ${wl} waiting` : 'Full') : `${spots} spot${spots !== 1 ? 's' : ''} left`}
                      </div>
                    </div>
                    {s.description && <p className="gs-card__desc">{s.description}</p>}
                    <div className="gs-card__meta">
                      {s.location && <span>📍 {s.location}</span>}
                      <span>⏱ {s.duration_minutes} min</span>
                      {instructorNameFor(s) && <span>👨‍✈️ {instructorNameFor(s)}</span>}
                      <span>💵 $25</span>
                    </div>
                    {s.meet_link && (
                      <a href={s.meet_link} target="_blank" rel="noopener noreferrer" className="gs-meet-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                        Join Google Meet
                      </a>
                    )}
                    <div className="gs-card__actions">
                      {isAdmin ? (
                        s.kind === 'scheduled_class' ? (
                          // scheduled_ground_classes is managed entirely in the
                          // admin Class Scheduler (its own roster/enrollment
                          // model, no check-in tokens or bulk-email here) --
                          // point there instead of half-building a second
                          // admin tool for the same data.
                          <Link to="/admin/ground-school-schedule" className="btn-link">
                            {confirmedCount(s)} enrolled · Manage in Class Scheduler →
                          </Link>
                        ) : (
                          <>
                            <button className="btn-link" onClick={() => openRegistrants(s)}>
                              {confirmedCount(s)} registered{wl > 0 ? ` · ${wl} waitlist` : ''}
                            </button>
                            <button className="btn-link" onClick={() => openEdit(s)}>Edit</button>
                            <button className="btn-link" style={{ color: '#f87171' }} onClick={() => handleDelete(s.id)}>Delete</button>
                          </>
                        )
                      ) : (
                        <button className="btn-primary-sm" onClick={() => openRegister(s)}>
                          {full ? 'Join Waitlist' : 'Sign Up'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {pastSessions.length > 0 && (
              <div style={{ marginTop: 48 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)' }}>Past Sessions</h2>
                  <button className="btn-secondary" onClick={() => setShowPast(p => !p)}>
                    {showPast ? 'Hide Past' : 'Show Past'}
                  </button>
                </div>
                {showPast && (
                  <div className="gs-grid">
                    {pastSessions.map(s => (
                      <div key={s.id} className="gs-card gs-card--full">
                        <div className="gs-card__head">
                          <div>
                            <h3 className="gs-card__title">{s.title}</h3>
                            <p className="gs-card__time">{fmt(s.scheduled_at)}</p>
                          </div>
                          <div className="gs-card__badge">{confirmedCount(s)} attended</div>
                        </div>
                        {s.description && <p className="gs-card__desc">{s.description}</p>}
                        <div className="gs-card__meta">
                          {s.location && <span>📍 {s.location}</span>}
                          <span>⏱ {s.duration_minutes} min</span>
                          {instructorNameFor(s) && <span>👨‍✈️ {instructorNameFor(s)}</span>}
                        </div>
                        {isAdmin && (
                          <div className="gs-card__actions">
                            <button className="btn-link" onClick={() => openRegistrants(s)}>{confirmedCount(s)} registered</button>
                            <button className="btn-link" style={{ color: '#f87171' }} onClick={() => handleDelete(s.id)}>Delete</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create/Edit Session Modal */}
      {(modal === 'create' || modal === 'edit') && (
        <Modal title={modal === 'create' ? 'Add Ground Session' : 'Edit Session'} onClose={closeModal}>
          <form onSubmit={modal === 'create' ? handleCreate : handleEdit} className="modal-form">
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-group">
              <label>Session Title</label>
              <input type="text" value={form.title} onChange={e => field('title', e.target.value)} required placeholder="e.g. Private Pilot – Aerodynamics" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select value={form.category} onChange={e => field('category', e.target.value)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Max Students</label>
                <input type="number" value={form.max_students} onChange={e => field('max_students', e.target.value)} min={1} max={100} required />
              </div>
            </div>
            <div className="form-group">
              <label>Assigned Instructor</label>
              <select value={form.instructor_id} onChange={e => field('instructor_id', e.target.value)}>
                <option value="">Unassigned</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
              {isAdmin && <Link to="/instructors" className="form-help-link">Manage instructors</Link>}
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => field('description', e.target.value)} rows={2} placeholder="Optional brief description" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date & Time</label>
                <input type="datetime-local" value={form.scheduled_at} onChange={e => field('scheduled_at', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Duration</label>
                <select value={form.duration_minutes} onChange={e => field('duration_minutes', e.target.value)}>
                  {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Location</label>
                <input type="text" value={form.location} onChange={e => field('location', e.target.value)} placeholder="e.g. Apex Aviation – KHYI" />
              </div>
              <div className="form-group">
                <label>Google Meet Link</label>
                <input type="url" value={form.meet_link} onChange={e => field('meet_link', e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
              </div>
            </div>
            {modal === 'create' && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.repeat} onChange={e => field('repeat', e.target.checked)} />
                  Create as recurring series
                </label>
                {form.repeat && (
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <div className="form-group">
                      <label>Frequency</label>
                      <select value={form.frequency} onChange={e => field('frequency', e.target.value)}>
                        {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Occurrences</label>
                      <input type="number" value={form.occurrences} onChange={e => field('occurrences', e.target.value)} min={2} max={52} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="modal-form__actions">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn-primary-sm" disabled={saving}>
                  {saving ? 'Saving…' : modal === 'create' ? (form.repeat ? `Create ${form.occurrences} Sessions` : 'Create Session') : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Register / Waitlist Modal */}
      {modal === 'register' && (
        <Modal title={`${spotsLeft(activeSession) <= 0 ? 'Join Waitlist' : 'Sign Up'} — ${activeSession?.title}`} onClose={closeModal}>
          {regSuccess ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{regSuccess === 'waitlist' ? '📋' : '✅'}</div>
              <h3 style={{ color: regSuccess === 'waitlist' ? '#fbbf24' : 'var(--gold)', marginBottom: 8 }}>
                {regSuccess === 'waitlist' ? "You're on the waitlist!" : "You're registered!"}
              </h3>
              <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{fmt(activeSession.scheduled_at)}</p>
              {activeSession.location && <p style={{ color: 'var(--muted)', marginBottom: 8 }}>{activeSession.location}</p>}
              {regSuccess === 'waitlist' ? (
                <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
                  This session is full. We'll email you if a spot opens up — no payment needed until you're confirmed.
                </p>
              ) : (
                <>
                  {activeSession.meet_link && (
                    <a href={activeSession.meet_link} target="_blank" rel="noopener noreferrer" className="gs-meet-btn" style={{ margin: '0 auto 16px', display: 'inline-flex' }}>
                      Join Google Meet
                    </a>
                  )}
                  <p style={{ color: 'var(--text)', marginBottom: 8 }}>
                    Please bring <strong style={{ color: 'var(--gold)' }}>$25 cash or card</strong> to the session.
                  </p>
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
                    Check your email for your attendance links to confirm course credit.
                  </p>
                </>
              )}
              <button className="btn-primary-sm" onClick={closeModal}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="modal-form">
              {formError && <div className="form-error">{formError}</div>}
              {spotsLeft(activeSession) <= 0 && (
                <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <p style={{ color: '#fbbf24', fontWeight: 600, marginBottom: 2 }}>This session is full</p>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Join the waitlist and we'll email you if a spot opens up.</p>
                </div>
              )}
              <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 14 }}>
                {fmt(activeSession.scheduled_at)}{activeSession.location ? ` · ${activeSession.location}` : ''}
              </p>
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={regForm.full_name} onChange={e => regField('full_name', e.target.value)} required placeholder="Jane Smith" />
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input type="email" value={regForm.email} onChange={e => regField('email', e.target.value)} required placeholder="jane@example.com" />
              </div>
              {spotsLeft(activeSession) > 0 && (
                <div style={{ background: 'var(--navy-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                  <p style={{ color: 'var(--gold)', fontWeight: 600, marginBottom: 4 }}>💵 $25 due at the door</p>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Payment is collected in-person. Cash or card accepted.</p>
                </div>
              )}
              <div className="modal-form__actions">
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                  <button type="submit" className="btn-primary-sm" disabled={saving}>
                    {saving ? 'Saving…' : spotsLeft(activeSession) <= 0 ? 'Join Waitlist' : 'Register'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Registrants + Admin Tools Modal */}
      {modal === 'registrants' && (
        <Modal title={`Registrants — ${activeSession?.title}`} onClose={closeModal} wide>
          <div style={{ marginBottom: 12 }}>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>{fmt(activeSession.scheduled_at)}</p>
            {registrants.length > 0 && (() => {
              const s = attendanceSummary(registrants)
              return (
                <div className="attend-summary">
                  <span style={{ color: '#4ade80' }}>✓ {s.completed} completed</span>
                  <span style={{ color: '#60a5fa' }}>↑ {s.checkedIn} checked in</span>
                  <span style={{ color: '#f87171' }}>✗ {s.noShow} no-show</span>
                  <span style={{ color: 'var(--muted)' }}>{s.total - s.completed - s.checkedIn - s.noShow} pending</span>
                </div>
              )
            })()}
          </div>

          {/* Confirmed Registrants */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Confirmed ({registrants.filter(r => !r.is_waitlisted).length})
              </h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-link" style={{ fontSize: 12 }} onClick={exportCSV}>⬇ Export CSV</button>
                <button className="btn-link" style={{ fontSize: 12 }} onClick={() => setModal('bulk')}>✉ Message All</button>
              </div>
            </div>
            {registrants.filter(r => !r.is_waitlisted).length === 0 ? (
              <p className="empty-state" style={{ fontSize: 13 }}>No confirmed registrants yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {registrants.filter(r => !r.is_waitlisted).map(r => {
                  const badge = statusBadge(r.attendance_status ?? 'registered')
                  return (
                    <div key={r.id} className="registrant-row">
                      <div className="registrant-row__info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 14 }}>{r.full_name}</strong>
                          <span className="registrant-badge" style={{ color: badge.color, borderColor: badge.color }}>{badge.label}</span>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--muted)' }}>{r.email}</p>
                        {r.checked_in_at && <p style={{ fontSize: 11, color: 'var(--muted)' }}>In: {new Date(r.checked_in_at).toLocaleTimeString()}</p>}
                        {r.checked_out_at && <p style={{ fontSize: 11, color: 'var(--muted)' }}>Out: {new Date(r.checked_out_at).toLocaleTimeString()}</p>}
                      </div>
                      <div className="registrant-row__actions">
                        <button className="attend-link-btn attend-link-btn--in" onClick={() => copyAttendLink('in', r.check_in_token, r.id)} title="Copy check-in link">
                          {copiedLink === `in-${r.id}` ? '✓ Copied' : '↓ Check-In'}
                        </button>
                        <button className="attend-link-btn attend-link-btn--out" onClick={() => copyAttendLink('out', r.check_out_token, r.id)} title="Copy check-out link">
                          {copiedLink === `out-${r.id}` ? '✓ Copied' : '↑ Check-Out'}
                        </button>
                        {(r.attendance_status === 'registered' || !r.attendance_status) && (
                          <button className="btn-link" style={{ fontSize: 12, color: '#f87171' }} onClick={() => markNoShow(r.id)}>No-Show</button>
                        )}
                        <button className="btn-link" style={{ fontSize: 12, color: '#f87171' }} onClick={() => handleCancelRegistration(r)}>Cancel</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Waitlist */}
          {registrants.filter(r => r.is_waitlisted).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Waitlist ({registrants.filter(r => r.is_waitlisted).length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {registrants.filter(r => r.is_waitlisted).map((r, i) => (
                  <div key={r.id} className="registrant-row">
                    <div className="registrant-row__info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>#{i + 1}</span>
                        <strong style={{ fontSize: 14 }}>{r.full_name}</strong>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--muted)' }}>{r.email}</p>
                    </div>
                    <div className="registrant-row__actions">
                      <button
                        className="btn-primary-sm"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => handlePromoteWaitlist(r)}
                        disabled={spotsLeft(activeSession) <= 0}
                      >
                        Promote
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Add */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Manually Add Registrant</h4>
            <form onSubmit={handleManualAdd} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {manualAddError && <div className="form-error" style={{ width: '100%' }}>{manualAddError}</div>}
              <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
                <label style={{ fontSize: 12 }}>Name</label>
                <input type="text" value={manualAddForm.full_name} onChange={e => setManualAddForm(f => ({ ...f, full_name: e.target.value }))} required placeholder="Full name" style={{ fontSize: 13 }} />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
                <label style={{ fontSize: 12 }}>Email</label>
                <input type="email" value={manualAddForm.email} onChange={e => setManualAddForm(f => ({ ...f, email: e.target.value }))} required placeholder="email@example.com" style={{ fontSize: 13 }} />
              </div>
              <button type="submit" className="btn-primary-sm" disabled={manualAddSaving} style={{ marginBottom: 1 }}>
                {manualAddSaving ? 'Adding…' : '+ Add'}
              </button>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, alignItems: 'center' }}>
            <button className="btn-link" style={{ fontSize: 13 }} onClick={refreshRegistrants}>↻ Refresh</button>
            <button className="btn-secondary" onClick={closeModal}>Close</button>
          </div>
        </Modal>
      )}

      {/* Bulk Message Modal */}
      {modal === 'bulk' && (
        <Modal title={`Message Registrants — ${activeSession?.title}`} onClose={() => setModal('registrants')}>
          {bulkSent ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <h3 style={{ color: 'var(--gold)', marginBottom: 8 }}>Messages sent!</h3>
              <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
                Your message was sent to {registrants.filter(r => !r.is_waitlisted).length} confirmed registrant{registrants.filter(r => !r.is_waitlisted).length !== 1 ? 's' : ''}.
              </p>
              <button className="btn-primary-sm" onClick={() => setModal('registrants')}>Back to Registrants</button>
            </div>
          ) : (
            <form onSubmit={handleBulkSend} className="modal-form">
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
                This will email all <strong style={{ color: 'var(--text)' }}>{registrants.filter(r => !r.is_waitlisted).length} confirmed registrant{registrants.filter(r => !r.is_waitlisted).length !== 1 ? 's' : ''}</strong> for this session.
              </p>
              <div className="form-group">
                <label>Subject</label>
                <input type="text" value={bulkSubject} onChange={e => setBulkSubject(e.target.value)} required placeholder="e.g. Important update about tonight's session" />
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea value={bulkMessage} onChange={e => setBulkMessage(e.target.value)} rows={6} required placeholder="Write your message here…" />
              </div>
              <div className="modal-form__actions">
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-secondary" onClick={() => setModal('registrants')}>Cancel</button>
                  <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Sending…' : 'Send Emails'}</button>
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}
