import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { ConfirmModal } from './UI.jsx'

function getResultMessages() {
  return {
    connected:{ text:'Google Agenda conectada com sucesso.', color:C.green },
    denied:{ text:'Conexão cancelada. Nenhuma permissão foi concedida.', color:C.yellow },
    scope:{ text:'A permissão de agenda não foi concedida. Marque a opção de gerenciar eventos ao conectar.', color:C.yellow },
    error:{ text:'Não foi possível conectar à Google Agenda. Tente novamente.', color:C.red },
  }
}

function GoogleCalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path fill="#fff" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path fill="#4285F4" d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
      <path fill="#34A853" d="M3 8V5a2 2 0 0 1 2-2h5v5H3Z" />
      <path fill="#FBBC04" d="M10 3h5v5h-5Z" />
      <path fill="#EA4335" d="M15 3h4a2 2 0 0 1 2 2v3h-6V3Z" />
      <text x="12" y="17.2" fill="#fff" fontSize="8.3" fontWeight="800" textAnchor="middle" fontFamily="Arial, sans-serif">31</text>
    </svg>
  )
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

  const feedback = actionError
    ? { text:actionError, color:C.red }
    : syncError && status.connected
      ? { text:syncError, color:C.yellow }
      : result

  const label = status.connected
    ? 'Google Agenda conectada'
    : status.needsReconnect
      ? 'Reconectar'
      : 'Conectar'

  return (
    <div className="google-calendar-control">
      <button
        type="button"
        className={`google-calendar-button${status.connected ? ' is-connected' : ''}${status.needsReconnect ? ' needs-reconnect' : ''}`}
        disabled={busy}
        onClick={() => status.connected ? setConfirmOpen(true) : run(google.connect)}
        aria-label={status.connected ? 'Google Agenda conectada. Desconectar' : `${label} Google Agenda`}
        title={status.connected
          ? `${status.email || 'Google Agenda conectada'} — clique para desconectar`
          : status.needsReconnect
            ? 'A conexão expirou. Clique para reconectar.'
            : 'Conectar Google Agenda'}
      >
        <GoogleCalendarIcon />
        <span>{busy ? 'Aguarde…' : label}</span>
        {status.connected && <i aria-hidden="true" />}
      </button>

      {feedback && <div className="google-calendar-feedback" role="status" style={{ '--google-feedback-color':feedback.color }}>{feedback.text}</div>}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => run(google.disconnect)}
        title="Desconectar Google Agenda"
        message="Os eventos já criados continuam na sua Google Agenda, mas deixam de ser atualizados pela plataforma."
        confirmLabel="Desconectar"
      />
    </div>
  )
}
