import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ApexLogo from './ApexLogo'
import NotificationBell from './NotificationBell'

// Keep in sync with the pilot_ranks seed data in
// supabase-portal-schema-v47.sql -- duplicated here so the sidebar can
// render rank progress without a round trip; ranks change rarely enough
// that this is a reasonable trade-off.
const PILOT_RANKS = [
  { key: 'student_pilot',       label: 'Student Pilot',       minXp: 0 },
  { key: 'pre_solo',             label: 'Pre-Solo',             minXp: 250 },
  { key: 'cross_country_pilot',  label: 'Cross-Country Pilot',  minXp: 750 },
  { key: 'night_rated',          label: 'Night Rated',          minXp: 1500 },
  { key: 'instrument_ready',     label: 'Instrument Ready',     minXp: 2750 },
  { key: 'commercial_candidate', label: 'Commercial Candidate', minXp: 4500 },
  { key: 'checkride_ace',        label: 'Checkride Ace',        minXp: 7000 },
  { key: 'apex_captain',         label: 'Apex Captain',         minXp: 10000 },
  { key: 'legend',               label: 'Legend',               minXp: 15000 },
]

const navGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', roles: ['admin', 'instructor', 'student'] },
      { to: '/analytics', label: 'Analytics',  roles: ['admin'] },
    ],
  },
  {
    label: 'Training',
    items: [
      { to: '/students',        label: 'Students',        roles: ['admin'] },
      { to: '/instructors',     label: 'Instructors',     roles: ['admin', 'instructor', 'student'] },
      { to: '/aircraft',        label: 'Fleet',           roles: ['admin', 'instructor', 'student'] },
      { to: '/syllabi',         label: 'Syllabi',         roles: ['admin', 'instructor', 'student'] },
      { to: '/dpe-content',     label: 'DPE Question Bank', roles: ['admin'] },
      { to: '/schedule',        label: 'Schedule',        roles: ['admin', 'instructor', 'student'] },
      { to: '/logbook',         label: 'Logbook',         roles: ['admin', 'instructor', 'student'] },
      { to: '/endorsements',    label: 'Endorsements',    roles: ['admin', 'instructor', 'student'] },
      { to: '/ground-schedule', label: 'Ground School',   roles: ['admin', 'instructor', 'student'] },
      { to: '/admin/ground-school-schedule', label: 'Class Scheduler', roles: ['admin'] },
      { to: '/instructor-hub',  label: 'Instructor Hub',  roles: ['admin', 'instructor'] },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/crm',      label: 'CRM',      roles: ['admin', 'instructor'] },
      { to: '/billing',  label: 'Billing',  roles: ['admin', 'instructor', 'student'] },
      { to: '/documents', label: 'Documents', roles: ['admin', 'instructor', 'student'] },
      { to: '/reports',  label: 'Reports',  roles: ['admin'] },
      { to: '/payroll',  label: 'Payroll',  roles: ['admin'] },
      { to: '/mock-oral-requests', label: 'Mock Oral Requests', roles: ['admin', 'instructor'] },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/messages',      label: 'Messages',      roles: ['admin', 'instructor', 'student'] },
      { to: '/announcements', label: 'Announcements', roles: ['admin', 'instructor', 'student'] },
      { to: '/broadcast',     label: 'Broadcast',     roles: ['admin'] },
      { to: '/nonbuyers',     label: 'Nonbuyers',     roles: ['admin'] },
      { to: '/xp-ledger',     label: 'XP Ledger',     roles: ['admin'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/operations/dashboard', label: 'Overview',    roles: ['admin', 'instructor'] },
      { to: '/operations/schedule',  label: 'Schedule',    roles: ['admin', 'instructor'] },
      { to: '/operations/simulator', label: 'Simulator',   roles: ['admin', 'instructor'] },
      { to: '/operations/settings',  label: 'Settings',    roles: ['admin'] },
    ],
  },
]


export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef()
  const searchTimer = useRef()

  const role = profile?.role ?? 'student'
  const isFlightStudent = role === 'student' && profile?.student_type === 'flight_student'
  const visibleGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => item.roles.includes(role))
        // Flight students (real students taking lessons with Apex) get
        // their own dashboard -- Apex Advantage students never reach
        // the CRM at all, so this only ever applies to flight students.
        .map(item => item.to === '/dashboard' && isFlightStudent ? { ...item, to: '/flight-dashboard' } : item),
    }))
    .filter(group => group.items.length > 0)

  function rankProgress(totalXp) {
    const xp = totalXp ?? 0
    const idx = PILOT_RANKS.reduce((best, r, i) => (xp >= r.minXp ? i : best), 0)
    const current = PILOT_RANKS[idx]
    const next = PILOT_RANKS[idx + 1]
    return { current, next, xp }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function closeSidebar() { setSidebarOpen(false) }

  // Global search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!query.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      const combined = []

      const [profilesRes, lessonsRes, logbookRes, invoicesRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').ilike('full_name', `%${query}%`).limit(3),
        supabase.from('lessons').select('id, lesson_type, starts_at').ilike('lesson_type', `%${query}%`).limit(3),
        supabase.from('logbook_entries').select('id, route, date').ilike('route', `%${query}%`).limit(3),
        supabase.from('invoices').select('id, description, status').ilike('description', `%${query}%`).limit(3),
      ])

      for (const p of profilesRes.data ?? []) combined.push({ label: p.full_name, sub: p.role, link: p.role === 'student' ? '/students' : '/instructors' })
      for (const l of lessonsRes.data ?? []) combined.push({ label: l.lesson_type ?? 'Lesson', sub: new Date(l.starts_at).toLocaleDateString(), link: '/schedule' })
      for (const e of logbookRes.data ?? []) combined.push({ label: e.route ?? 'Flight', sub: new Date(e.date).toLocaleDateString(), link: '/logbook' })
      for (const i of invoicesRes.data ?? []) combined.push({ label: i.description, sub: i.status, link: '/billing' })

      setResults(combined)
      setSearching(false)
      setSearchOpen(true)
    }, 300)
  }, [query])

  // Daily Dispatch XP: one server-authoritative award per member-local
  // day, requested once per portal session, students only -- staff
  // accounts (admin/instructor) aren't pilots working through the
  // rating ladder, so they shouldn't silently accumulate pilot XP.
  // log_daily_dispatch_open() is idempotent itself (see v47), so
  // calling it again this same session/day is harmless -- the guard
  // here just avoids a redundant network call on every route change.
  const dispatchLogged = useRef(false)
  useEffect(() => {
    if (!profile?.id || profile.role !== 'student' || dispatchLogged.current) return
    dispatchLogged.current = true
    supabase.rpc('log_daily_dispatch_open').then(({ error }) => {
      if (error) console.warn('log_daily_dispatch_open failed:', error)
    })
  }, [profile?.id])

  useEffect(() => {
    function handle(e) { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div className="app-shell">
      {/* Mobile top bar */}
      <header className="topbar">
        <button className="topbar__hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Open menu">
          <span /><span /><span />
        </button>
        <div className="topbar__brand">
          <ApexLogo size={26} />
          <span className="topbar__name">APEX <em>Operations</em></span>
        </div>
        <NotificationBell />
      </header>

      {/* Overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <ApexLogo size={34} />
          <div className="sidebar__brand-text">
            <span className="sidebar__name-apex">APEX</span>
            <span className="sidebar__name-sub">— OPERATIONS —</span>
          </div>
          <button className="sidebar__close" onClick={closeSidebar} aria-label="Close menu">✕</button>
        </div>

        {/* Search */}
        <div className="sidebar__search" ref={searchRef}>
          <input
            className="sidebar__search-input"
            type="text"
            placeholder="Search…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setSearchOpen(true)}
          />
          {searchOpen && results.length > 0 && (
            <div className="search-dropdown">
              {results.map((r, i) => (
                <button
                  key={i}
                  className="search-result"
                  onClick={() => { navigate(r.link); setQuery(''); setSearchOpen(false); closeSidebar() }}
                >
                  <span className="search-result__label">{r.label}</span>
                  <span className="search-result__sub">{r.sub}</span>
                </button>
              ))}
            </div>
          )}
          {searchOpen && query && results.length === 0 && !searching && (
            <div className="search-dropdown">
              <p className="search-empty">No results for "{query}"</p>
            </div>
          )}
        </div>

        <nav className="sidebar__nav">
          {visibleGroups.map(group => (
            <div className="sidebar__nav-group" key={group.label}>
              <p className="sidebar__nav-heading">{group.label}</p>
              {group.items.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={closeSidebar}
                  className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
                >
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__notif">
            <NotificationBell />
          </div>
          <div className="sidebar__user">
            <div className="sidebar__avatar">{profile?.full_name?.[0] ?? '?'}</div>
            <div>
              <p className="sidebar__user-name">{profile?.full_name ?? 'User'}</p>
              <p className="sidebar__user-role">{role}</p>
            </div>
          </div>
          {role === 'student' && (() => {
            const { current, next, xp } = rankProgress(profile?.total_xp)
            return (
              <div className="sidebar__rank" title={next ? `${next.minXp - xp} XP to ${next.label}` : 'Top rank reached'}>
                <div className="sidebar__rank-row">
                  <span className="sidebar__rank-label">{current.label}</span>
                  <span className="sidebar__rank-xp">{xp} XP</span>
                </div>
                {next && (
                  <div className="sidebar__rank-bar">
                    <div
                      className="sidebar__rank-bar-fill"
                      style={{ width: `${Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })()}
          <NavLink to="/profile" onClick={closeSidebar} className="sidebar__profile-link">My Profile</NavLink>
          <button className="sidebar__signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
