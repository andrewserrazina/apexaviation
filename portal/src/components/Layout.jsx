import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ApexLogo from './ApexLogo'
import NotificationBell from './NotificationBell'

const navItems = [
  { to: '/dashboard',       label: 'Dashboard',       roles: ['admin', 'instructor', 'student'] },
  { to: '/analytics',       label: 'Analytics',       roles: ['admin'] },
  { to: '/students',        label: 'Students',        roles: ['admin'] },
  { to: '/instructors',     label: 'Instructors',     roles: ['admin', 'instructor', 'student'] },
  { to: '/aircraft',        label: 'Fleet',           roles: ['admin', 'instructor', 'student'] },
  { to: '/syllabi',         label: 'Syllabi',         roles: ['admin', 'instructor', 'student'] },
  { to: '/schedule',        label: 'Schedule',        roles: ['admin', 'instructor', 'student'] },
  { to: '/logbook',         label: 'Logbook',         roles: ['admin', 'instructor', 'student'] },
  { to: '/billing',         label: 'Billing',         roles: ['admin', 'instructor', 'student'] },
  { to: '/documents',       label: 'Documents',       roles: ['admin', 'instructor', 'student'] },
  { to: '/ground-schedule', label: 'Ground School',   roles: ['admin', 'instructor', 'student'] },
  { to: '/endorsements',    label: 'Endorsements',    roles: ['admin', 'instructor', 'student'] },
  { to: '/instructor-hub',  label: 'Instructor Hub',  roles: ['admin', 'instructor'] },
  { to: '/crm',             label: 'CRM',             roles: ['admin', 'instructor'] },
  { to: '/messages',        label: 'Messages',        roles: ['admin', 'instructor', 'student'] },
  { to: '/announcements',   label: 'Announcements',   roles: ['admin', 'instructor', 'student'] },
  { to: '/reports',         label: 'Reports',         roles: ['admin'] },
  { to: '/operations/dashboard', label: 'Operations', roles: ['admin', 'instructor'] },
]

const SEARCH_TABLES = [
  { table: 'profiles',        labelCol: 'full_name',   sub: 'role',        link: id => `/students` },
  { table: 'lessons',         labelCol: 'lesson_type', sub: 'starts_at',   link: () => '/schedule' },
  { table: 'logbook_entries', labelCol: 'route',       sub: 'date',        link: () => '/logbook' },
  { table: 'invoices',        labelCol: 'description', sub: 'status',      link: () => '/billing' },
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
  const visibleNav = navItems.filter(item => item.roles.includes(role))

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
          <span className="topbar__name">APEX <em>Advantage</em></span>
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
            <span className="sidebar__name-sub">— ADVANTAGE —</span>
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
          {visibleNav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeSidebar}
              className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
            >
              <span>{label}</span>
            </NavLink>
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
