import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('login') // 'login' | 'forgot'
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) { setError(error.message); setLoading(false) }
    else navigate('/dashboard')
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setResetSent(true)
  }

  if (mode === 'forgot') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-card__brand">
            <span className="login-card__logo">✦</span>
            <h1>Apex<em>Advantage</em></h1>
          </div>
          <p className="login-card__sub">Reset your password</p>
          {resetSent ? (
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 16 }}>
              Check your email for a password reset link.
            </p>
          ) : (
            <form onSubmit={handleForgot} className="login-form">
              {error && <div className="login-form__error">{error}</div>}
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Sending…' : 'Send Reset Link'}</button>
            </form>
          )}
          <button onClick={() => { setMode('login'); setError(''); setResetSent(false) }} className="login-card__back" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>← Back to Sign In</button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__logo">✦</span>
          <h1>Apex<em>Advantage</em></h1>
        </div>
        <p className="login-card__sub">Flight School Management</p>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-form__error">{error}</div>}
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
        </form>

        <button onClick={() => { setMode('forgot'); setError('') }} className="login-card__back" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'block', margin: '12px auto 0' }}>Forgot password?</button>
        <a href="https://apexaviation.com" className="login-card__back">← Back to Apex Aviation</a>
      </div>
    </div>
  )
}
