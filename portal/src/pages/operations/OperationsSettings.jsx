import { useEffect, useState } from 'react'
import Layout from '../../components/Layout'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const ROLE_OPTIONS = ['student', 'instructor', 'admin']

export default function OperationsSettings() {
  const { profile } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  useEffect(() => { loadStaff() }, [])

  async function loadStaff() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', ['admin', 'instructor'])
      .order('full_name')

    if (loadError) setError(loadError.message)
    else setStaff(data ?? [])
    setLoading(false)
  }

  async function changeRole(member, nextRole) {
    if (nextRole === member.role) return
    if (member.id === profile?.id && nextRole !== 'admin') {
      if (!window.confirm('This removes your own admin access. Continue?')) return
    }
    setSavingId(member.id)
    setError('')
    const { error: saveError } = await supabase.from('profiles').update({ role: nextRole }).eq('id', member.id)
    setSavingId(null)
    if (saveError) {
      setError(saveError.message)
      return
    }
    await loadStaff()
  }

  return (
    <Layout>
      <div className="operations-page-header">
        <p className="operations-eyebrow">Operations configuration</p>
        <h1>Settings</h1>
        <p>Manage who has admin or instructor access to Apex Operations.</p>
      </div>

      <section className="operations-panel">
        {error && <div className="operations-form-error">{error}</div>}
        {loading && <div className="operations-empty-state"><p>Loading staff…</p></div>}
        {!loading && staff.length === 0 && (
          <div className="operations-empty-state">
            <h2>No staff accounts found</h2>
            <p>Admin and instructor profiles will appear here once assigned.</p>
          </div>
        )}
        {!loading && staff.length > 0 && (
          <div className="operations-list">
            {staff.map(member => (
              <div className="operations-list__row" key={member.id}>
                <strong>{member.full_name || 'Unnamed'}</strong>
                <span>{member.email}</span>
                <select
                  value={member.role}
                  disabled={savingId === member.id}
                  onChange={e => changeRole(member, e.target.value)}
                >
                  {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
                <em>{savingId === member.id ? 'Saving…' : member.role}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  )
}
