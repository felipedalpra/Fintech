import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './router/ProtectedRoute.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import { FinanceWorkspace } from './pages/FinanceWorkspace.jsx'
import { LandingPage } from './landing/LandingPage.jsx'

export function AppRoutes() {
  return (
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
  )
}
