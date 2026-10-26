import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import AuthPage from '../pages/AuthPage'
import JobBoardPage from '../pages/JobBoardPage'
import AdminDashboardPage from '../pages/AdminDashboardPage'
import CandidateProfilePage from '../pages/CandidateProfilePage'
import CandidateApplicationsPage from '../pages/CandidateApplicationsPage'
import SavedJobsPage from '../pages/SavedJobsPage'
import RecruiterDashboardPage from '../pages/RecruiterDashboardPage'
import RecommendationsPage from '../pages/RecommendationsPage'

function RoleGuard({ roles, children }) {
  const { session, isLoading } = useAuth()
  if (isLoading) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  return roles.includes(session.user.role) ? children : <Navigate to={getRolePath(session.user.role)} replace />
}

function getRolePath(role) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'RECRUITER') return '/recruiter'
  return '/jobs'
}

function GuestRoute() {
  const { session, isLoading } = useAuth()
  if (isLoading) return <LoadingScreen />
  if (session) return <Navigate to={getRolePath(session.user.role)} replace />
  return <AuthPage />
}

export default function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<GuestRoute />} />
    <Route path="/register" element={<GuestRoute />} />
    <Route path="/admin/*" element={<RoleGuard roles={['ADMIN']}><AdminDashboardPage /></RoleGuard>} />
    <Route path="/recruiter/*" element={<RoleGuard roles={['RECRUITER']}><RecruiterDashboardPage /></RoleGuard>} />
    <Route path="/jobs/*" element={<RoleGuard roles={['CANDIDATE']}><JobBoardPage /></RoleGuard>} />
    <Route path="/recommendations" element={<RoleGuard roles={['CANDIDATE']}><RecommendationsPage /></RoleGuard>} />
    <Route path="/profile" element={<RoleGuard roles={['CANDIDATE']}><CandidateProfilePage /></RoleGuard>} />
    <Route path="/applications" element={<RoleGuard roles={['CANDIDATE']}><CandidateApplicationsPage /></RoleGuard>} />
    <Route path="/saved-jobs" element={<RoleGuard roles={['CANDIDATE']}><SavedJobsPage /></RoleGuard>} />
    <Route path="*" element={<GuestRoute />} />
  </Routes>
}
