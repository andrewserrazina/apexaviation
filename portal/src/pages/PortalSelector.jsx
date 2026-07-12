import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ApexLogo from '../components/ApexLogo'

// Apex Advantage (the student-facing checkride-prep/DPE-question/ground-
// school-registration portal) is a separate app entirely -- the vanilla-JS
// site/portal.html, not anything inside this CRM. Hardcoded here rather
// than an env var since this is a fixed, known destination, same as the
// hardcoded apexaviationtx.com links already in emailTemplate.ts.
const APEX_ADVANTAGE_URL = 'https://advantage.apexaviationtx.com'

export default function PortalSelector() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const role = profile?.role ?? 'student'

  const isFlightStudent = role === 'student' && profile?.student_type === 'flight_student'

  useEffect(() => {
    // Apex Advantage students (free guide / Checkride Prep / ground
    // school members) have no reason to see the Apex Operations option
    // -- send them straight to Apex Advantage rather than making them
    // pick. Flight students -- real students taking lessons with Apex
    // -- get their own in-CRM dashboard instead, since the CRM is
    // where their lessons, syllabus, and logbook actually live.
    if (role === 'student') {
      if (isFlightStudent) navigate('/flight-dashboard', { replace: true })
      else window.location.replace(APEX_ADVANTAGE_URL)
    }
  }, [role, isFlightStudent])

  if (role === 'student') {
    return (
      <main className="portal-selector">
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 80 }}>
          {isFlightStudent ? 'Loading your dashboard…' : 'Redirecting to Apex Advantage…'}
        </p>
      </main>
    )
  }

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
          <button type="button" className="portal-option-card" onClick={() => { window.location.href = APEX_ADVANTAGE_URL }}>
            <span className="portal-option-card__kicker">Apex Advantage</span>
            <strong>Training &amp; Education Portal</strong>
            <p>10 DPE questions, Checkride Prep Pack, and ground school registration.</p>
          </button>
          <button type="button" className="portal-option-card" onClick={() => navigate('/operations/dashboard')}>
            <span className="portal-option-card__kicker">Apex Operations</span>
            <strong>Flight School Management Portal</strong>
            <p>Scheduling, ground school, instructor management, aircraft, students, and CRM.</p>
          </button>
        </div>
      </section>
    </main>
  )
}
