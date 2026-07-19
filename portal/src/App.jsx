import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { NotifProvider } from './context/NotificationContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoadingState from './components/ui/LoadingState'

const Login = lazy(() => import('./pages/Login'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Students = lazy(() => import('./pages/Students'))
const Instructors = lazy(() => import('./pages/Instructors'))
const Syllabi = lazy(() => import('./pages/Syllabi'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Logbook = lazy(() => import('./pages/Logbook'))
const Billing = lazy(() => import('./pages/Billing'))
const GroundSchedule = lazy(() => import('./pages/GroundSchedule'))
const Documents = lazy(() => import('./pages/Documents'))
const Aircraft = lazy(() => import('./pages/Aircraft'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Profile = lazy(() => import('./pages/Profile'))
const Attend = lazy(() => import('./pages/Attend'))
const CRM = lazy(() => import('./pages/CRM'))
const Endorsements = lazy(() => import('./pages/Endorsements'))
const Messages = lazy(() => import('./pages/Messages'))
const Announcements = lazy(() => import('./pages/Announcements'))
const Broadcast = lazy(() => import('./pages/Broadcast'))
const Reports = lazy(() => import('./pages/Reports'))
const Payroll = lazy(() => import('./pages/Payroll'))
const MockOralRequests = lazy(() => import('./pages/MockOralRequests'))
const InstructorHub = lazy(() => import('./pages/InstructorHub'))
const OperationsDashboard = lazy(() => import('./pages/operations/OperationsDashboard'))
const OperationsSchedule = lazy(() => import('./pages/operations/OperationsSchedule'))
const OperationsSimulator = lazy(() => import('./pages/operations/OperationsSimulator'))
const OperationsSettings = lazy(() => import('./pages/operations/OperationsSettings'))
const PortalSelector = lazy(() => import('./pages/PortalSelector'))
const FlightStudentDashboard = lazy(() => import('./pages/FlightStudentDashboard'))
const AdminGroundSchoolSchedule = lazy(() => import('./pages/AdminGroundSchoolSchedule'))

export default function App() {
  return (
    <AuthProvider>
      <NotifProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingState fullScreen label="Loading page…" />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/portal-select" element={<ProtectedRoute><PortalSelector /></ProtectedRoute>} />
              <Route path="/dashboard"   element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/flight-dashboard" element={<ProtectedRoute roles={['student']}><FlightStudentDashboard /></ProtectedRoute>} />
              <Route path="/operations" element={<ProtectedRoute roles={['admin', 'instructor']}><Navigate to="/operations/dashboard" replace /></ProtectedRoute>} />
              <Route path="/operations/dashboard" element={<ProtectedRoute roles={['admin', 'instructor']}><OperationsDashboard /></ProtectedRoute>} />
              <Route path="/operations/schedule" element={<ProtectedRoute roles={['admin', 'instructor']}><OperationsSchedule /></ProtectedRoute>} />
              <Route path="/operations/simulator" element={<ProtectedRoute roles={['admin', 'instructor']}><OperationsSimulator /></ProtectedRoute>} />
              <Route path="/operations/settings" element={<ProtectedRoute adminOnly><OperationsSettings /></ProtectedRoute>} />
              <Route path="/admin/ground-school-schedule" element={<ProtectedRoute adminOnly><AdminGroundSchoolSchedule /></ProtectedRoute>} />
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
              <Route path="/broadcast"       element={<ProtectedRoute adminOnly><Broadcast /></ProtectedRoute>} />
              <Route path="/reports"         element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />
              <Route path="/payroll"         element={<ProtectedRoute adminOnly><Payroll /></ProtectedRoute>} />
              <Route path="/mock-oral-requests" element={<ProtectedRoute roles={['admin', 'instructor']}><MockOralRequests /></ProtectedRoute>} />
              <Route path="/instructor-hub"  element={<ProtectedRoute><InstructorHub /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NotifProvider>
    </AuthProvider>
  )
}
