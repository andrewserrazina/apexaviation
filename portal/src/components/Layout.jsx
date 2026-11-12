import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ApexLogo from './ApexLogo'
import NotificationBell from './NotificationBell'

// Rebuilt as part of the Apex Operations portal overhaul: the old nav
// was 5 groups / 33 items, with Mock Oral and Private Instruction each
// claiming 2-3 entries for what's structurally the same
// availability+booking pattern, and a 4-item "Operations" group that
// mostly duplicated other groups (see the retired operations/
// subfolder). This groups by what an ops-team member is actually
// trying to do, with Scheduling consolidated around the new unified
// calendar (OperationsCalendar) instead of one nav item per booking
// product.
const navGroups = [
  {
    label: 'Home',
    items: [
      { to: '/dashboard', label: 'Dashboard', roles: ['admin', 'instructor', 'student'] },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { to: '/scheduling', label: 'Calendar', roles: ['admin', 'instructor', 'office_manager'] },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/aircraft', label: 'Aircraft', roles: ['admin', 'instructor', 'student'] },
    ],
  },
  {
    label: 'Billing & Payroll',
    items: [
      { to: '/billing',    label: 'Billing',   roles: ['admin', 'instructor', 'student'] },
      { to: '/payroll',    label: 'Payroll',   roles: ['admin'] },
      { to: '/documents',  label: 'Documents', roles: ['admin', 'instructor', 'student'] },
    ],
  },
  {
    label: 'Training Records',
    items: [
      { to: '/training-records', label: 'Training Records', roles: ['admin', 'instructor'] },
      { to: '/syllabi',          label: 'Syllabi',           roles: ['admin', 'instructor', 'student'] },
      { to: '/logbook',          label: 'Logbook',           roles: ['admin', 'instructor', 'student'] },
      { to: '/endorsements',     label: 'Endorsements',      roles: ['admin', 'instructor', 'student'] },
      { to: '/dpe-content',      label: 'DPE Question Bank', roles: ['admin'] },
      { to: '/xp-ledger',        label: 'XP Ledger',         roles: ['admin'] },
      { to: '/pilot-journey',    label: 'Pilot Journey',     roles: ['admin', 'instructor'] },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/students',    label: 'Students',    roles: ['admin', 'office_manager'] },
      { to: '/instructors', label: 'Instructors', roles: ['admin', 'instructor', 'student'] },
      { to: '/crm',         label: 'Leads',       roles: ['admin', 'instructor', 'office_manager'] },
      { to: '/nonbuyers',   label: 'Nonbuyers',   roles: ['admin'] },
    ],
  },
  {
    label: 'Reports & Analytics',
    items: [
      { to: '/reports',   label: 'Operations Reports', roles: ['admin'] },
      { to: '/analytics', label: 'Growth Analytics',   roles: ['admin'] },
      { to: '/marketing-funnel', label: 'Marketing & Funnel', roles: ['admin'] },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/messages',      label: 'Messages',      roles: ['admin', 'instructor', 'student'] },
      { to: '/announcements', label: 'Announcements', roles: ['admin', 'instructor', 'student'] },
      { to: '/broadcast',     label: 'Broadcast',     roles: ['admin'] },
      { to: '/missions',      label: 'Missions',      roles: ['admin'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/instructor-hub',       label: 'Instructor Hub', roles: ['admin', 'instructor'] },
      { to: '/operations/settings',  label: 'Staff Roles',    roles: ['admin'] },
      { to: '/admin/ground-school-schedule', label: 'Ground School Classes', roles: ['admin', 'office_manager'] },
      { to: '/mock-oral-availability', label: 'Mock Oral Availability', roles: ['admin', 'instructor'] },
      { to: '/private-instruction-availability', label: 'Private Instruction Availability', roles: ['admin', 'instructor'] },
      { to: '/mock-oral-requests', label: 'Mock Oral Requests (Legacy $99)', roles: ['admin', 'instructor'] },
      // Ground School Bidding and the legacy ($25/class) Ground School
      // schedule are intentionally not linked here -- both are
      // discontinued/superseded booking flows with nothing left for
      // day-to-day staff to act on. Their pages and routes stay in the
      // repo (GroundSchoolBidding.jsx, GroundSchedule.jsx) for
      // historical data; staff with the direct URL can still reach them.
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
