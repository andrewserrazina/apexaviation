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
const AdminGroundSchoolSchedule = lazy(() => import('./pages/AdminGroundSchoolSchedule'))
const Documents = lazy(() => import('./pages/Documents'))
const Aircraft = lazy(() => import('./pages/Aircraft'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Profile = lazy(() => import('./pages/Profile'))
const Attend = lazy(() => import('./pages/Attend'))
const CRM = lazy(() => import('./pages/CRM'))
const Endorsements = lazy(() => import('./pages/Endorsements'))
const Messages = lazy(() => import('./pages/Messages'))
const Announcements = lazy(() => import('./pages/Announcements'))
const Reports = lazy(() => import('./pages/Reports'))
const InstructorHub = lazy(() => import('./pages/InstructorHub'))
const PortalSelector = lazy(() => import('./pages/PortalSelector'))
const OperationsDashboard = lazy(() => import('./pages/operations/OperationsDashboard'))
const OperationsSchedule = lazy(() => import('./pages/operations/OperationsSchedule'))
const OperationsSimulator = lazy(() => import('./pages/operations/OperationsSimulator'))
const OperationsAircraft = lazy(() => import('./pages/operations/OperationsAircraft'))
const OperationsInstructors = lazy(() => import('./pages/operations/OperationsInstructors'))
const OperationsStudents = lazy(() => import('./pages/operations/OperationsStudents'))
const OperationsMaintenance = lazy(() => import('./pages/operations/OperationsMaintenance'))
const OperationsLeads = lazy(() => import('./pages/operations/OperationsLeads'))
const OperationsSettings = lazy(() => import('./pages/operations/OperationsSettings'))

function protectedPage(page, options) {
  return <ProtectedRoute {...options}>{page}</ProtectedRoute>
}

function operationsPage(page) {
  return protectedPage(page, { roles: ['admin', 'instructor'] })
}

export default function App() {
  return (
    <AuthProvider>
      <NotifProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingState fullScreen label="Loading Apex Advantage…" />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/portal-select" element={protectedPage(<PortalSelector />, { roles: ['admin', 'instructor'] })} />
              <Route path="/dashboard" element={protectedPage(<Dashboard />)} />
              <Route path="/students" element={protectedPage(<Students />, { adminOnly: true })} />
              <Route path="/instructors" element={protectedPage(<Instructors />)} />
              <Route path="/aircraft" element={protectedPage(<Aircraft />)} />
              <Route path="/analytics" element={protectedPage(<Analytics />, { adminOnly: true })} />
              <Route path="/profile" element={protectedPage(<Profile />)} />
              <Route path="/syllabi" element={protectedPage(<Syllabi />)} />
              <Route path="/schedule" element={protectedPage(<Schedule />)} />
              <Route path="/logbook" element={protectedPage(<Logbook />)} />
              <Route path="/billing" element={protectedPage(<Billing />)} />
              <Route path="/ground-schedule" element={<GroundSchedule />} />
              <Route path="/admin/ground-school-schedule" element={protectedPage(<AdminGroundSchoolSchedule />, { adminOnly: true })} />
              <Route path="/operations" element={operationsPage(<Navigate to="/operations/dashboard" replace />)} />
              <Route path="/operations/dashboard" element={operationsPage(<OperationsDashboard />)} />
              <Route path="/operations/schedule" element={operationsPage(<OperationsSchedule />)} />
              <Route path="/operations/simulator" element={operationsPage(<OperationsSimulator />)} />
              <Route path="/operations/aircraft" element={operationsPage(<OperationsAircraft />)} />
              <Route path="/operations/instructors" element={operationsPage(<OperationsInstructors />)} />
              <Route path="/operations/students" element={operationsPage(<OperationsStudents />)} />
              <Route path="/operations/maintenance" element={operationsPage(<OperationsMaintenance />)} />
              <Route path="/operations/leads" element={operationsPage(<OperationsLeads />)} />
              <Route path="/operations/settings" element={operationsPage(<OperationsSettings />)} />
              <Route path="/attend/:type/:token" element={<Attend />} />
              <Route path="/documents" element={protectedPage(<Documents />)} />
              <Route path="/crm" element={protectedPage(<CRM />)} />
              <Route path="/endorsements" element={protectedPage(<Endorsements />)} />
              <Route path="/messages" element={protectedPage(<Messages />)} />
              <Route path="/announcements" element={protectedPage(<Announcements />)} />
              <Route path="/reports" element={protectedPage(<Reports />, { adminOnly: true })} />
              <Route path="/instructor-hub" element={protectedPage(<InstructorHub />)} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NotifProvider>
    </AuthProvider>
  )
}
