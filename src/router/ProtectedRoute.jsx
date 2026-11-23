import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Card } from '../components/UI.jsx'
import { C } from '../theme.js'
import { fetchPlatformAdminStatus } from '../lib/billingClient.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

function Validating() {
  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg }}>
      <Card style={{ width:'min(420px, calc(100vw - 32px))', textAlign:'center' }}>
        <div style={{ fontSize:14, color:C.textSub }}>Validando acesso...</div>
      </Card>
    </div>
  )
}

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  // Começa em `false` para não atrasar a tela de todo mundo com uma segunda checagem
  // de rede; a exceção rara (a conta da Zentri) só é redirecionada assim que a
  // checagem assíncrona voltar, podendo ver o app por um instante antes disso.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  useEffect(() => {
    if (E2E_BYPASS_AUTH || !user?.id) { setIsPlatformAdmin(false); return }
    let active = true
    fetchPlatformAdminStatus()
      .then(payload => { if (active) setIsPlatformAdmin(Boolean(payload.isPlatformAdmin)) })
      .catch(() => { if (active) setIsPlatformAdmin(false) })
    return () => { active = false }
  }, [user?.id])

  if (loading) return <Validating />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Conta de uso exclusivo da Zentri Tech (ferramenta de preço, não uma clínica):
  // nunca entra no app da clínica, só em /zentri-admin.
  if (isPlatformAdmin && !location.pathname.startsWith('/zentri-admin')) {
    return <Navigate to="/zentri-admin" replace />
  }

  return <Outlet />
}
