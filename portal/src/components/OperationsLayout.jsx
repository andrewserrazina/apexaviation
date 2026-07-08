import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ApexLogo from './ApexLogo'

const operationsNav = [
  { to: '/operations/dashboard', label: 'Dashboard' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/ground-schedule', label: 'Ground School' },
  { to: '/aircraft', label: 'Fleet' },
  { to: '/instructors', label: 'Instructors' },
  { to: '/students', label: 'Students' },
  { to: '/crm', label: 'CRM' },
]

export default function OperationsLayout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="operations-shell">
      <aside className="operations-sidebar">
        <div className="operations-brand">
          <ApexLogo size={34} />
          <div>
            <span className="operations-brand__eyebrow">APEX</span>
            <strong>Operations</strong>
          </div>
        </div>
        <nav className="operations-nav" aria-label="Apex Operations">
          {operationsNav.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `operations-nav__item${isActive ? ' operations-nav__item--active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="operations-sidebar__footer">
          <NavLink to="/dashboard" className="operations-switch">Switch to Apex Advantage</NavLink>
          <p>{profile?.full_name ?? 'User'} · {profile?.role}</p>
          <button type="button" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="operations-main">{children}</main>
    </div>
  )
}
