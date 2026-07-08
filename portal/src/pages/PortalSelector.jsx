import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ApexLogo from '../components/ApexLogo'

export default function PortalSelector() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const role = profile?.role ?? 'student'

  if (role === 'student') return <Navigate to="/dashboard" replace />

  return (
    <main className="portal-selector">
      <section className="portal-selector__panel" aria-labelledby="portal-selector-title">
        <div className="portal-selector__brand">
          <ApexLogo size={42} />
          <div>
            <p className="portal-selector__eyebrow">Choose your workspace</p>
            <h1 id="portal-selector-title">Apex Portal</h1>
          </div>
        </div>
        <p className="portal-selector__intro">Use one secure login to move between student training tools and internal flight school operations.</p>
        <div className="portal-selector__grid">
          <button type="button" className="portal-option-card" onClick={() => navigate('/dashboard')}>
            <span className="portal-option-card__kicker">Apex Advantage</span>
            <strong>Training &amp; Education Portal</strong>
            <p>Courses, lessons, quizzes, guided notes, resources, and student progress.</p>
          </button>
          <button type="button" className="portal-option-card" onClick={() => navigate('/operations/dashboard')}>
            <span className="portal-option-card__kicker">Apex Operations</span>
            <strong>Flight School Management Portal</strong>
            <p>Scheduling, simulator operations, instructor management, aircraft, students, and location operations.</p>
          </button>
        </div>
      </section>
    </main>
  )
}
