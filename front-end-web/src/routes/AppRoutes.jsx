import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '../context/auth'
import LoadingScreen from '../components/LoadingScreen'
import RouteErrorBoundary from '../components/RouteErrorBoundary'

const AuthPage = lazy(() => import('../pages/AuthPage'))
const JobBoardPage = lazy(() => import('../pages/JobBoardPage'))
const CompanyPage = lazy(() => import('../pages/CompanyPage'))
const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage'))
const CandidateProfilePage = lazy(() => import('../pages/CandidateProfilePage'))
const MyJobsPage = lazy(() => import('../pages/MyJobsPage'))
const RecruiterDashboardPage = lazy(() => import('../pages/RecruiterDashboardPage'))
const RecommendationsPage = lazy(() => import('../pages/RecommendationsPage'))
const AlertsPage = lazy(() => import('../pages/AlertsPage'))
const RecruiterTalentPage = lazy(() => import('../pages/RecruiterTalentPage'))
const MessagesPage = lazy(() => import('../pages/MessagesPage'))

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
  const location = useLocation()
  if (isLoading) return <LoadingScreen />
  if (session) {
    const returnTo = new URLSearchParams(location.search).get('returnTo')
    const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null
    return <Navigate to={safeReturnTo || getRolePath(session.user.role)} replace />
  }
  return <AuthPage />
}

export default function AppRoutes() {
  return <RouteErrorBoundary><Suspense fallback={<LoadingScreen />}><Routes>
    <Route path="/login" element={<GuestRoute />} />
    <Route path="/register" element={<GuestRoute />} />
    <Route path="/admin/*" element={<RoleGuard roles={['ADMIN']}><AdminDashboardPage /></RoleGuard>} />
    <Route path="/recruiter/talent" element={<RoleGuard roles={['RECRUITER']}><RecruiterTalentPage /></RoleGuard>} />
    <Route path="/recruiter/*" element={<RoleGuard roles={['RECRUITER']}><RecruiterDashboardPage /></RoleGuard>} />
    <Route path="/jobs" element={<JobBoardPage />} />
    <Route path="/jobs/:id" element={<JobBoardPage />} />
    <Route path="/companies/:id" element={<CompanyPage />} />
    <Route path="/recommendations" element={<RoleGuard roles={['CANDIDATE']}><RecommendationsPage /></RoleGuard>} />
    <Route path="/profile" element={<RoleGuard roles={['CANDIDATE']}><CandidateProfilePage /></RoleGuard>} />
    <Route path="/alerts" element={<RoleGuard roles={['CANDIDATE']}><AlertsPage /></RoleGuard>} />
    <Route path="/my-jobs" element={<RoleGuard roles={['CANDIDATE']}><MyJobsPage /></RoleGuard>} />
    <Route path="/messages" element={<RoleGuard roles={['CANDIDATE', 'RECRUITER']}><MessagesPage /></RoleGuard>} />
    <Route path="/applications" element={<Navigate to="/my-jobs?tab=applied" replace />} />
    <Route path="/saved-jobs" element={<Navigate to="/my-jobs?tab=saved" replace />} />
    <Route path="*" element={<GuestRoute />} />
  </Routes></Suspense></RouteErrorBoundary>
}
