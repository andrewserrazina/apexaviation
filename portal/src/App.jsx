import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { NotifProvider } from './context/NotificationContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Instructors from './pages/Instructors'
import Syllabi from './pages/Syllabi'
import Schedule from './pages/Schedule'
import Logbook from './pages/Logbook'
import Billing from './pages/Billing'
import GroundSchedule from './pages/GroundSchedule'
import Documents from './pages/Documents'
import Aircraft from './pages/Aircraft'
import Analytics from './pages/Analytics'
import Profile from './pages/Profile'
import Attend from './pages/Attend'
import CRM from './pages/CRM'
import Endorsements from './pages/Endorsements'
import Messages from './pages/Messages'
import Announcements from './pages/Announcements'
import Reports from './pages/Reports'
import InstructorHub from './pages/InstructorHub'
import OperationsDashboard from './pages/operations/OperationsDashboard'
import OperationsSchedule from './pages/operations/OperationsSchedule'

export default function App() {
  return (
    <AuthProvider>
      <NotifProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard"   element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/operations" element={<ProtectedRoute roles={['admin', 'instructor']}><Navigate to="/operations/dashboard" replace /></ProtectedRoute>} />
            <Route path="/operations/dashboard" element={<ProtectedRoute roles={['admin', 'instructor']}><OperationsDashboard /></ProtectedRoute>} />
            <Route path="/operations/schedule" element={<ProtectedRoute roles={['admin', 'instructor']}><OperationsSchedule /></ProtectedRoute>} />
            <Route path="/students"    element={<ProtectedRoute adminOnly><Students /></ProtectedRoute>} />
            <Route path="/instructors" element={<ProtectedRoute><Instructors /></ProtectedRoute>} />
            <Route path="/aircraft"    element={<ProtectedRoute><Aircraft /></ProtectedRoute>} />
            <Route path="/analytics"   element={<ProtectedRoute adminOnly><Analytics /></ProtectedRoute>} />
            <Route path="/profile"     element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/syllabi"     element={<ProtectedRoute><Syllabi /></ProtectedRoute>} />
            <Route path="/schedule"    element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
            <Route path="/logbook"     element={<ProtectedRoute><Logbook /></ProtectedRoute>} />
            <Route path="/billing"     element={<ProtectedRoute><Billing /></ProtectedRoute>} />
            <Route path="/ground-schedule" element={<GroundSchedule />} />
            <Route path="/attend/:type/:token" element={<Attend />} />
            <Route path="/documents"       element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/crm"             element={<ProtectedRoute><CRM /></ProtectedRoute>} />
            <Route path="/endorsements"    element={<ProtectedRoute><Endorsements /></ProtectedRoute>} />
            <Route path="/messages"        element={<ProtectedRoute><Messages /></ProtectedRoute>} />
            <Route path="/announcements"   element={<ProtectedRoute><Announcements /></ProtectedRoute>} />
            <Route path="/reports"         element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />
            <Route path="/instructor-hub"  element={<ProtectedRoute><InstructorHub /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </NotifProvider>
    </AuthProvider>
  )
}
