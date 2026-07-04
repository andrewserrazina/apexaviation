import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setError(error.message); return }
    navigate('/dashboard')
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__logo">✦</span>
          <h1>Apex<em>Advantage</em></h1>
        </div>
        <p className="login-card__sub">Set a new password</p>
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-form__error">{error}</div>}
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoFocus />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Set Password'}</button>
        </form>
      </div>
    </div>
  )
}
