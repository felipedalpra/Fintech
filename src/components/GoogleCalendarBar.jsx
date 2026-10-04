import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn, Card, ConfirmModal } from './UI.jsx'

function getResultMessages() {
  return {
    connected:{ text:'Google Agenda conectada com sucesso.', color:C.green },
    denied:{ text:'Conexão cancelada. Nenhuma permissão foi concedida.', color:C.yellow },
    scope:{ text:'A permissão de agenda não foi concedida. Marque a opção de gerenciar eventos ao conectar.', color:C.yellow },
    error:{ text:'Não foi possível conectar à Google Agenda. Tente novamente.', color:C.red },
  }
}

export function GoogleCalendarBar({ google }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [result, setResult] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('google')
    if (!code) return
    setResult(getResultMessages()[code] || null)
    navigate(location.pathname, { replace:true })
  }, [location.search, location.pathname, navigate])

  if (!google || !google.status.configured) return null
  const { status, syncError } = google

  async function run(action) {
    setBusy(true)
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error.message || 'Não foi possível concluir a ação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ padding:'14px 18px' }}>
      <div style={{ display:'flex', gap:14, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
        {status.connected ? (
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
              <span style={{ color:C.green, marginRight:6 }}>●</span>Google Agenda conectada
            </div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:2 }}>
              {status.email ? `${status.email} · ` : ''}consultas e cirurgias futuras são enviadas automaticamente.
            </div>
          </div>
        ) : (
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
              {status.needsReconnect ? 'A conexão com a Google Agenda expirou' : 'Conecte sua Google Agenda'}
            </div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:2, lineHeight:1.5 }}>
              Envie consultas e cirurgias para a sua agenda e veja seus eventos do Google aqui.
              Ao conectar, o nome completo do paciente e o procedimento passam a constar nos eventos da sua Google Agenda.
            </div>
          </div>
        )}

        {status.connected ? (
          <Btn variant="ghost" disabled={busy} onClick={() => setConfirmOpen(true)}>Desconectar</Btn>
        ) : (
          <Btn disabled={busy} onClick={() => run(google.connect)}>
            {status.needsReconnect ? 'Reconectar' : 'Conectar Google Agenda'}
          </Btn>
        )}
      </div>

      {result && <div style={{ marginTop:10, fontSize:12, color:result.color }}>{result.text}</div>}
      {syncError && status.connected && <div style={{ marginTop:10, fontSize:12, color:C.yellow }}>{syncError}</div>}
      {actionError && <div style={{ marginTop:10, fontSize:12, color:C.red }}>{actionError}</div>}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => run(google.disconnect)}
        title="Desconectar Google Agenda"
        message="Os eventos já criados continuam na sua Google Agenda, mas deixam de ser atualizados pela plataforma."
        confirmLabel="Desconectar"
      />
    </Card>
  )
}
