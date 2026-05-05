import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './router/ProtectedRoute.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import { FinanceWorkspace } from './pages/FinanceWorkspace.jsx'
import { LandingPage } from './landing/LandingPage.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

const LAST_APP_PATH_KEY = 'surgimetrics_last_app_path'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

function AppEntryRedirect() {
  if (typeof window === 'undefined') {
    return <Navigate to="/app/dashboard" replace />
  }
  const lastPath = window.sessionStorage.getItem(LAST_APP_PATH_KEY)
  const nextPath = lastPath?.startsWith('/app/') ? lastPath : '/app/dashboard'
  return <Navigate to={nextPath} replace />
}

export function AppRoutes() {
  return (
    <ErrorBoundary>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage initialMode="login" />} />
        <Route path="/signup" element={<LoginPage initialMode="register" />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppEntryRedirect />} />
          <Route path="/app/:page" element={<FinanceWorkspace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
