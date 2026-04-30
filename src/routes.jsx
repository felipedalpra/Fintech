import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './router/ProtectedRoute.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import { FinanceWorkspace } from './pages/FinanceWorkspace.jsx'
import { LandingPage } from './landing/LandingPage.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
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
          <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/app/:page" element={<FinanceWorkspace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
