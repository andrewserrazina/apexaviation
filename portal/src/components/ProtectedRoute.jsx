import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, adminOnly = false, roles }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && profile?.role !== 'admin') return <Navigate to="/dashboard" replace />
  if (roles?.length && !roles.includes(profile?.role)) return <Navigate to="/dashboard" replace />

  return children
}
