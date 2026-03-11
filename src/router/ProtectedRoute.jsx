import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Card } from '../components/UI.jsx'
import { C } from '../theme.js'

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg }}>
        <Card style={{ width:'min(420px, calc(100vw - 32px))', textAlign:'center' }}>
          <div style={{ fontSize:14, color:C.textSub }}>Validando acesso...</div>
        </Card>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
