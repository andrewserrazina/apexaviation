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
const Reports = lazy(() => import('./pages/Reports'))
const InstructorHub = lazy(() => import('./pages/InstructorHub'))

function protectedPage(page, options) {
  return <ProtectedRoute {...options}>{page}</ProtectedRoute>
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
