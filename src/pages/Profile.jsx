import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'

const CERT_OPTIONS = ['None', 'Student Pilot', 'Private Pilot', 'Instrument Rating', 'Commercial Pilot', 'ATP']

export default function Profile() {
  const { profile } = useAuth()
  const isInstructor = profile?.role === 'instructor'
  const isStudent = profile?.role === 'student'

  const [form, setForm] = useState({ full_name: '', bio: '', certificates: '', certificate_status: 'None', medical_expiry: '' })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  useEffect(() => {
    if (!profile) return
    setForm({
      full_name: profile.full_name ?? '',
      bio: profile.bio ?? '',
      certificates: profile.certificates ?? '',
      certificate_status: profile.certificate_status ?? 'None',
      medical_expiry: profile.medical_expiry ?? '',
    })
  }, [profile])

  function field(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    setSaveErr('')
    const payload = {
      full_name: form.full_name,
      bio: form.bio || null,
    }
    if (isInstructor) payload.certificates = form.certificates || null
    if (isStudent) {
      payload.certificate_status = form.certificate_status || null
      payload.medical_expiry = form.medical_expiry || null
    }
    const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id)
    setSaving(false)
    if (error) { setSaveErr(error.message) } else { setSaveMsg('Profile updated.') }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPwErr('')
    setPwMsg('')
    if (pwForm.next !== pwForm.confirm) { setPwErr('Passwords do not match.'); return }
    if (pwForm.next.length < 6) { setPwErr('Password must be at least 6 characters.'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.next })
    setPwSaving(false)
    if (error) { setPwErr(error.message) } else { setPwMsg('Password updated.'); setPwForm({ current: '', next: '', confirm: '' }) }
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2 className="page-title">My Profile</h2>
          <p className="page-sub">{profile?.email}</p>
        </div>
      </div>

      <div className="profile-grid">
        {/* Profile info */}
        <section className="card">
          <h3 className="card__title">Personal Information</h3>
          <form onSubmit={handleSave} className="modal-form" style={{ padding: 0, border: 'none' }}>
            {saveErr && <div className="form-error">{saveErr}</div>}
            {saveMsg && <div className="form-success">{saveMsg}</div>}

            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={form.full_name} onChange={e => field('full_name', e.target.value)} required />
            </div>

            <div className="form-group">
              <label>Bio</label>
              <textarea value={form.bio} onChange={e => field('bio', e.target.value)} rows={4}
                placeholder={isInstructor ? 'Your background, experience, and teaching philosophy…' : 'Optional notes about your training goals…'} />
            </div>

            {isInstructor && (
              <div className="form-group">
                <label>Certificates & Ratings</label>
                <input type="text" value={form.certificates} onChange={e => field('certificates', e.target.value)} placeholder="e.g. CFI, CFII, MEI, ATP" />
              </div>
            )}

            {isStudent && (
              <div className="form-row">
                <div className="form-group">
                  <label>Certificate Status</label>
                  <select value={form.certificate_status} onChange={e => field('certificate_status', e.target.value)}>
                    {CERT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Medical Expiry</label>
                  <input type="date" value={form.medical_expiry} onChange={e => field('medical_expiry', e.target.value)} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
            </div>
          </form>
        </section>

        {/* Password */}
        <section className="card">
          <h3 className="card__title">Change Password</h3>
          <form onSubmit={handlePasswordChange} className="modal-form" style={{ padding: 0, border: 'none' }}>
            {pwErr && <div className="form-error">{pwErr}</div>}
            {pwMsg && <div className="form-success">{pwMsg}</div>}
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} required minLength={6} placeholder="Min 6 characters" />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} required placeholder="Repeat new password" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="submit" className="btn-primary-sm" disabled={pwSaving}>{pwSaving ? 'Updating…' : 'Update Password'}</button>
            </div>
          </form>
        </section>
      </div>
    </Layout>
  )
}
