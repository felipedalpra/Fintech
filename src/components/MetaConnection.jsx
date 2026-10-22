import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn } from './UI.jsx'
import { disconnectMeta, fetchMetaPendingAssets, selectMetaAssets, startMetaConnection } from '../lib/metaOAuthClient.js'

const RESULT_MESSAGES = {
  connected:{ text:'Meta Ads conectado com sucesso.', tone:'ok' },
  selecting:{ text:'Escolha a Página e a Conta de Anúncios abaixo para concluir a conexão.', tone:'warn' },
  denied:{ text:'Conexão cancelada. Nenhuma permissão foi concedida.', tone:'warn' },
  no_page:{ text:'Nenhuma Página foi autorizada. Tente novamente e marque pelo menos uma Página do Facebook.', tone:'bad' },
  error:{ text:'Não foi possível conectar ao Meta. Tente novamente.', tone:'bad' },
}

const STATUS_META = {
  conectado:{ label:'● Conectado', ok:true },
  selecionando:{ label:'◐ Escolha a Página/Conta', ok:false },
  expirando:{ label:'⚠ Expirando — reconecte', ok:false },
  erro:{ label:'⚠ Erro de conexão', ok:false },
  configurado:{ label:'◐ Reconexão necessária', ok:false },
  desconectado:{ label:'○ Não conectado', ok:false },
}

export function MetaConnection() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [cfg, setCfg] = useState(null)
  const [pending, setPending] = useState({ pages:[], adAccounts:[] })
  const [selectedPage, setSelectedPage] = useState('')
  const [selectedAdAccount, setSelectedAdAccount] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    const { data, error:err } = await supabase.from('meta_connections')
      .select('ad_account_id, page_id, status, token_expires_at').maybeSingle()
    if (err) { setError(err.message); setLoading(false); return }
    setCfg(data)
    if (data?.status === 'selecionando') {
      try {
        const assets = await fetchMetaPendingAssets()
        setPending({ pages:assets.pages || [], adAccounts:assets.adAccounts || [] })
      } catch (e) { setError(e.message) }
    }
    setLoading(false)
  }

  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('meta')
    if (!code) return
    setResult(RESULT_MESSAGES[code] || null)
    navigate(location.pathname, { replace:true })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  async function run(action) {
    setBusy(true); setError(null)
    try { await action() } catch (e) { setError(e.message || 'Não foi possível concluir a ação.') }
    finally { setBusy(false) }
  }

  async function connect() {
    const { url } = await startMetaConnection()
    window.location.assign(url)
  }

  async function confirmSelection() {
    if (!selectedPage) { setError('Selecione uma Página.'); return }
    await selectMetaAssets({ pageId:selectedPage, adAccountId:selectedAdAccount || null })
    await load()
  }

  async function disconnect() {
    await disconnectMeta()
    await load()
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20 }}>Carregando…</div>

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 1.45 },
    card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 },
    label: { fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
    note: { fontSize: 11.5, color: C.textDim, lineHeight: 1.5 },
    status: ok => ({ fontSize: 12, fontWeight: 700, color: ok ? (C.green || '#16a34a') : C.textSub }),
    select: { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13 },
  }
  const toneColor = { ok:C.green || '#16a34a', warn:C.yellow || '#eab308', bad:C.red || '#ef4444' }
  const status = cfg?.status || 'desconectado'
  const statusMeta = STATUS_META[status] || STATUS_META.desconectado

  return (
    <div>
      <div style={s.intro}>
        Conecte os anúncios do Meta (Facebook/Instagram) da clínica. Os <strong>leads dos formulários
        (Lead Ads) entram automaticamente no funil</strong> em "Primeiro Contato", etiquetados com a
        campanha de origem.
      </div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {result && <div style={{ color: toneColor[result.tone], fontSize: 12, marginBottom: 10 }}>{result.text}</div>}

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: C.text }}>Conexão</strong>
          <span style={s.status(statusMeta.ok)}>{statusMeta.label}</span>
        </div>

        {status === 'selecionando' && (
          <>
            <div>
              <label style={s.label}>Página do Facebook</label>
              <select style={s.select} value={selectedPage} onChange={e => setSelectedPage(e.target.value)}>
                <option value="">Selecione…</option>
                {pending.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Conta de Anúncios (opcional por enquanto)</label>
              <select style={s.select} value={selectedAdAccount} onChange={e => setSelectedAdAccount(e.target.value)}>
                <option value="">Nenhuma</option>
                {pending.adAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <Btn onClick={() => run(confirmSelection)} disabled={busy}>{busy ? 'Salvando…' : 'Confirmar seleção'}</Btn>
          </>
        )}

        {status !== 'selecionando' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {status === 'conectado'
              ? <Btn onClick={() => run(disconnect)} disabled={busy}>{busy ? 'Aguarde…' : 'Desconectar'}</Btn>
              : <Btn onClick={() => run(connect)} disabled={busy}>{busy ? 'Redirecionando…' : 'Continuar com Facebook'}</Btn>}
          </div>
        )}

        {status === 'conectado' && cfg?.token_expires_at && (
          <div style={s.note}>
            Token válido até {new Date(cfg.token_expires_at).toLocaleDateString('pt-BR')}.
            Perto do vencimento, um aviso aparece aqui pedindo reconexão.
          </div>
        )}
      </div>
    </div>
  )
}
