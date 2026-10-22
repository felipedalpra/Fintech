import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'

// Gerência dos números de WhatsApp Business da clínica (admin). Evolution usa
// chave global somente no backend; Z-API permanece disponível para rollback.
const WEBHOOK_BASE = 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook'
const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

export function WhatsAppNumbers() {
  const { ownerId } = useUserRole()
  const [numbers, setNumbers] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [phone, setPhone] = useState('')
  const [provider, setProvider] = useState('evolution')
  const [instanceUrl, setInstanceUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editInstanceUrl, setEditInstanceUrl] = useState('')
  const [editApiToken, setEditApiToken] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState({})
  const [qrCode, setQrCode] = useState(null)
  const [pendingEvents, setPendingEvents] = useState([])
  const [replayBusy, setReplayBusy] = useState(null)

  async function load() {
    setLoading(true)
    const [numResult, memRes] = await Promise.allSettled([
      whatsappApi('list-numbers', {}),
      supabase.rpc('clinic_team'), // roster via RPC: admin-membro (não-owner) também enxerga o time
    ])
    if (numResult.status === 'fulfilled') {
      setNumbers(numResult.value.numbers || [])
      setPendingEvents(numResult.value.pendingEvents || [])
    }
    else setMsg({ type:'error', text:numResult.reason?.message || 'Não foi possível carregar os números.' })
    if (memRes.status === 'fulfilled' && !memRes.value.error) setMembers((memRes.value.data ?? []).filter(m => m.user_id))
    else setMsg(current => current || ({ type:'error', text:'Não foi possível carregar a equipe.' }))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function whatsappApi(action, payload) {
    const accessToken = E2E_BYPASS_AUTH
      ? 'e2e-token'
      : (await supabase.auth.getSession()).data.session?.access_token
    if (!accessToken) throw new Error('Sessão inválida. Entre novamente.')
    const response = await fetch(`/api/whatsapp?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Falha na integração do WhatsApp (HTTP ${response.status}).`)
    return data
  }

  function testConnection(payload) {
    return whatsappApi('test-connection', payload)
  }

  // Define o responsável (dono) do número: equipe/gestão só veem as conversas dos números delas.
  async function assign(id, assigned_user_id) {
    const { error } = await supabase.from('whatsapp_numbers').update({ assigned_user_id: assigned_user_id || null }).eq('id', id)
    if (error) { setMsg({ type:'error', text:`Não foi possível atribuir o número: ${error.message}` }); return }
    setNumbers(prev => prev.map(x => x.id === id ? { ...x, assigned_user_id: assigned_user_id || null } : x))
  }

  async function add(e) {
    e.preventDefault()
    if (!label.trim() || (provider === 'zapi' && (!instanceUrl.trim() || !apiToken.trim()))) {
      setMsg({ type: 'error', text: provider === 'evolution' ? 'Informe o nome/função do número.' : 'Preencha label, URL da instância e token Z-API.' })
      return
    }
    setSaving(true)
    setMsg(null)
    if (provider === 'evolution') {
      try {
        const result = await whatsappApi('provision-number', { label: label.trim(), phone })
        setQrCode({ numberId: result.number?.id, label: result.number?.label || label.trim(), ...(result.qrcode || {}) })
        setMsg({ type: 'success', text: `Instância de "${label.trim()}" criada. Escaneie o QR Code pelo WhatsApp Business.` })
        setLabel(''); setPhone('')
        await load()
      } catch (error) {
        setMsg({ type: 'error', text: error.message })
        await load()
      } finally {
        setSaving(false)
      }
      return
    }
    let connection
    try {
      connection = await testConnection({ instanceUrl: instanceUrl.trim(), apiToken: apiToken.trim() })
    } catch (error) {
      setSaving(false)
      setMsg({ type: 'error', text: error.message })
      return
    }
    const webhook_secret = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '')
    const { data: createdNumber, error } = await supabase.from('whatsapp_numbers').insert({
      user_id: ownerId,
      label: label.trim(),
      phone: phone.replace(/\D/g, '') || null,
      instance_url: connection.instanceUrl,
      api_token: apiToken.trim(),
      webhook_secret,
      provider: 'zapi',
      active: false,
    }).select('id').single()
    if (error) { setSaving(false); setMsg({ type: 'error', text: error.message }); return }
    try {
      await testConnection({ whatsappNumberId: createdNumber.id })
    } catch (error) {
      setSaving(false)
      setMsg({ type: 'error', text: `Número salvo, mas o webhook não foi confirmado: ${error.message}` })
      load()
      return
    }
    setSaving(false)
    setMsg({ type: 'success', text: `Número "${label.trim()}" adicionado e webhook configurado automaticamente.` })
    setLabel(''); setPhone(''); setInstanceUrl(''); setApiToken('')
    load()
  }

  function beginEdit(n) {
    setEditingId(n.id)
    setEditInstanceUrl('')
    setEditApiToken('')
    setMsg(null)
  }

  async function checkConnection(n) {
    setConnectionBusy(n.id)
    setMsg(null)
    try {
      await testConnection({ whatsappNumberId: n.id })
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: true, text: 'Conectado · celular sincronizado' } }))
    } catch (error) {
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: false, text: error.message } }))
      setMsg({ type: 'error', text: error.message })
    }
    setConnectionBusy(null)
  }

  async function connectEvolution(n) {
    setConnectionBusy(n.id)
    setMsg(null)
    try {
      const result = await whatsappApi('connect-instance', { whatsappNumberId: n.id })
      setQrCode({ numberId: n.id, label: n.label, ...(result.qrcode || {}) })
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: result.state === 'open', text: result.state === 'open' ? 'Conectado' : 'Aguardando leitura do QR Code' } }))
      await load()
    } catch (error) {
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: false, text: error.message } }))
      setMsg({ type: 'error', text: error.message })
    } finally {
      setConnectionBusy(null)
    }
  }

  // Com o QR aberto, acompanha a conexão sozinho até virar "open" (ou até o QR
  // expirar) — sem isso a tela fica presa em "aguardando QR" até alguém recarregar.
  useEffect(() => {
    if (!qrCode?.numberId) return undefined
    const numberId = qrCode.numberId
    const POLL_MS = 3000
    const MAX_ATTEMPTS = 40 // ~2min, cobre a janela normal de validade do QR
    let attempts = 0
    let cancelled = false

    const interval = setInterval(async () => {
      attempts += 1
      try {
        const result = await whatsappApi('list-numbers', {})
        if (cancelled) return
        setNumbers(result.numbers || [])
        setPendingEvents(result.pendingEvents || [])
        const updated = (result.numbers || []).find(x => x.id === numberId)
        if (updated?.active && updated.connection_state === 'open') {
          cancelled = true
          clearInterval(interval)
          setConnectionStatus(prev => ({ ...prev, [numberId]: { ok:true, text:'Conectado · celular sincronizado' } }))
          setMsg({ type:'success', text:`"${updated.label}" conectado com sucesso.` })
          setQrCode(null)
          return
        }
      } catch { /* tenta de novo no próximo ciclo; erro de rede pontual não encerra o acompanhamento */ }
      if (attempts >= MAX_ATTEMPTS && !cancelled) {
        cancelled = true
        clearInterval(interval)
        setConnectionStatus(prev => ({ ...prev, [numberId]: { ok:false, text:'QR Code expirado. Clique em "Conectar / novo QR" para gerar outro.' } }))
      }
    }, POLL_MS)

    return () => { cancelled = true; clearInterval(interval) }
  }, [qrCode?.numberId])

  async function saveConnection(n) {
    if (!editInstanceUrl.trim() || !editApiToken.trim()) {
      setMsg({ type: 'error', text: 'Informe novamente a URL da instância e o Client-Token.' })
      return
    }
    setConnectionBusy(n.id)
    setMsg(null)
    try {
      const connection = await testConnection({
        whatsappNumberId: n.id,
        instanceUrl: editInstanceUrl.trim(),
        apiToken: editApiToken.trim(),
      })
      setEditingId(null)
      setEditInstanceUrl('')
      setEditApiToken('')
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: true, text: 'Conectado · celular sincronizado' } }))
      setMsg({ type: 'success', text: `Conexão de "${n.label}" testada e salva. Mensagens enviadas pelo WhatsApp também serão sincronizadas.` })
    } catch (error) {
      setConnectionStatus(prev => ({ ...prev, [n.id]: { ok: false, text: error.message } }))
      setMsg({ type: 'error', text: error.message })
    }
    setConnectionBusy(null)
  }

  async function toggleActive(n) {
    setConnectionBusy(n.id)
    setMsg(null)
    try {
      const result = await whatsappApi('set-number-active', { whatsappNumberId:n.id, active:!n.active })
      setNumbers(prev => prev.map(x => x.id === n.id ? { ...x, active:result.active } : x))
    } catch (error) {
      setMsg({ type:'error', text:error.message })
    } finally {
      setConnectionBusy(null)
    }
  }

  async function replayPending(n) {
    const events = pendingEvents.filter(event => event.whatsapp_number_id === n.id)
    // Não bloqueia por número inativo: um connection.update preso é exatamente o que
    // destrava a reconexão (o backend decide, por tipo de evento, o que pode seguir).
    setReplayBusy(n.id)
    setMsg(null)
    try {
      for (const event of events) await whatsappApi('replay-webhook', { eventId:event.id })
      setMsg({ type:'success', text:`${events.length} evento(s) reprocessado(s) com sucesso.` })
      await load()
    } catch (error) {
      setMsg({ type:'error', text:`Reprocessamento interrompido: ${error.message}` })
      await load()
    } finally {
      setReplayBusy(null)
    }
  }

  function webhookUrl(n) {
    return n.provider === 'evolution'
      ? `${WEBHOOK_BASE}&number=${n.id}`
      : `${WEBHOOK_BASE}&number=${n.id}&token=${n.webhook_secret || ''}`
  }
  function copy(text) {
    try { navigator.clipboard?.writeText(text); setMsg({ type: 'success', text: 'URL copiada.' }) } catch { /* ignore */ }
  }

  const s = {
    item: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg, marginBottom: 10 },
    row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
    label: { fontSize: 13, fontWeight: 700, color: C.text },
    phone: { fontSize: 12, color: C.textSub },
    hook: { fontSize: 11, color: C.textDim, wordBreak: 'break-all', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', flex: 1, minWidth: 220 },
    tagOn: { fontSize: 10, fontWeight: 700, color: '#10b981', border: '1px solid #10b98155', borderRadius: 6, padding: '1px 6px' },
    tagOff: { fontSize: 10, fontWeight: 700, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 6px' },
    linkBtn: { background: 'none', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
    assign: { fontSize: 12, padding: '5px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit' },
    unassignedTag: { fontSize: 10, fontWeight: 700, color: C.yellow || '#f59e0b', border: `1px solid ${(C.yellow || '#f59e0b')}55`, borderRadius: 6, padding: '1px 6px' },
    connectionOk: { fontSize: 10, fontWeight: 700, color: '#10b981', border: '1px solid #10b98155', borderRadius: 6, padding: '1px 6px' },
    connectionError: { fontSize: 10, fontWeight: 700, color: C.red || '#ef4444', border: `1px solid ${(C.red || '#ef4444')}55`, borderRadius: 6, padding: '1px 6px' },
    editor: { marginTop: 6, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', flexDirection: 'column', gap: 10 },
    providerTag: { fontSize: 10, fontWeight: 700, color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 6, padding: '1px 6px' },
    qrBox: { margin: '14px 0', padding: 16, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  }

  const qrImage = qrCode?.base64
    ? (String(qrCode.base64).startsWith('data:image/') ? qrCode.base64 : `data:image/png;base64,${qrCode.base64}`)
    : null

  return (
    <div>
      <div style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Integração</div>
      <h3 style={{ margin: '0 0 6px', fontSize: 22, color: C.text, letterSpacing: '-0.03em' }}>Números de WhatsApp</h3>
      <p style={{ fontSize: 13, color: C.textSub, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
        Conecte até 3 números do WhatsApp Business. Na Evolution, a clínica apenas escaneia o QR Code em Dispositivos conectados; a chave da infraestrutura nunca aparece no navegador. Números antigos da Z-API continuam disponíveis durante a migração.
      </p>

      {msg && <p style={{ fontSize: 12, color: msg.type === 'error' ? (C.red || '#ef4444') : '#10b981', margin: '0 0 12px' }}>{msg.text}</p>}

      {qrCode && (
        <div style={s.qrBox} data-testid="evolution-qrcode">
          {qrImage && <img src={qrImage} alt={`QR Code de ${qrCode.label}`} style={{ width: 190, height: 190, borderRadius: 8, background: '#fff', padding: 6 }} />}
          <div style={{ minWidth: 220, flex: 1 }}>
            <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>Conectar {qrCode.label}</div>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.5 }}>
              No celular da clínica, abra WhatsApp Business → Dispositivos conectados → Conectar dispositivo e leia o QR Code.
            </div>
            {qrCode.pairingCode && <code style={{ ...s.hook, display: 'block', marginTop: 10 }}>Código: {qrCode.pairingCode}</code>}
            {!qrImage && !qrCode.pairingCode && <div style={{ fontSize: 12, color: C.textSub, marginTop: 8 }}>QR Code ainda não disponível. Tente gerar novamente.</div>}
            <button type="button" style={{ ...s.linkBtn, marginTop: 10 }} onClick={() => setQrCode(null)}>Fechar</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: C.textSub, fontSize: 14 }}>Carregando...</div>
        : numbers.length === 0 ? <div style={{ color: C.textDim, fontSize: 14, marginBottom: 18 }}>Nenhum número cadastrado ainda.</div>
        : numbers.map(n => {
          const numberPending = pendingEvents.filter(event => event.whatsapp_number_id === n.id)
          return (
            <div key={n.id} style={s.item}>
              <div style={s.row}>
                <span style={s.label}>{n.label}</span>
                {n.phone && <span style={s.phone}>{n.phone}</span>}
                <span style={s.providerTag}>{n.provider === 'evolution' ? 'Evolution' : 'Z-API'}</span>
                <span style={n.active ? s.tagOn : s.tagOff}>{n.active ? 'ativo' : 'inativo'}</span>
                <span style={{ flex: 1 }} />
                <button style={s.linkBtn} disabled={connectionBusy === n.id} onClick={() => checkConnection(n)}>{connectionBusy === n.id ? 'Testando...' : 'Testar conexão'}</button>
                {n.provider === 'evolution'
                  ? <button style={s.linkBtn} disabled={connectionBusy === n.id} onClick={() => connectEvolution(n)}>{connectionBusy === n.id ? 'Gerando...' : 'Conectar / novo QR'}</button>
                  : <button style={s.linkBtn} onClick={() => editingId === n.id ? setEditingId(null) : beginEdit(n)}>{editingId === n.id ? 'Cancelar edição' : 'Editar conexão'}</button>}
                <button style={s.linkBtn} onClick={() => toggleActive(n)}>{n.active ? 'Desativar' : 'Ativar'}</button>
              </div>
              <div style={s.row}>
                <code style={s.hook}>{webhookUrl(n)}</code>
                <button style={s.linkBtn} onClick={() => copy(webhookUrl(n))}>Copiar URL de webhook</button>
              </div>
              <div style={s.row}>
                <span style={{ fontSize: 12, color: C.textSub }}>Responsável:</span>
                <select style={s.assign} value={n.assigned_user_id || ''} onChange={e => assign(n.id, e.target.value)}>
                  <option value="">— sem responsável (só admin vê)</option>
                  {members.map(m => <option key={m.user_id} value={m.user_id}>{m.member_email} · {m.role}</option>)}
                </select>
                {!n.assigned_user_id && <span style={s.unassignedTag}>só admin</span>}
                {connectionStatus[n.id] && <span style={connectionStatus[n.id].ok ? s.connectionOk : s.connectionError}>{connectionStatus[n.id].text}</span>}
                {!connectionStatus[n.id] && n.provider === 'evolution' && <span style={n.connection_state === 'open' ? s.connectionOk : s.connectionError}>{n.connection_state === 'open' ? 'conectado' : n.connection_state === 'connecting' ? 'aguardando QR' : 'conferir conexão'}</span>}
              </div>
              {n.provider === 'evolution' && (n.last_health_at || n.last_webhook_at) && (
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
                  {n.last_health_at && <>Conexão conferida em {new Date(n.last_health_at).toLocaleString('pt-BR')}.</>}
                  {n.last_health_at && n.last_webhook_at && ' '}
                  {n.last_webhook_at && <>Último evento recebido em {new Date(n.last_webhook_at).toLocaleString('pt-BR')}{n.last_webhook_event ? ` (${n.last_webhook_event})` : ''}.</>}
                </div>
              )}
              {numberPending.length > 0 && (
                <div style={{ ...s.row, color:C.textSub, fontSize:12 }}>
                  <span>{numberPending.length} evento(s) aguardando reprocessamento.</span>
                  <button style={s.linkBtn} disabled={replayBusy === n.id} onClick={() => replayPending(n)}>
                    {replayBusy === n.id ? 'Reprocessando...' : 'Reprocessar agora'}
                  </button>
                </div>
              )}
              {editingId === n.id && n.provider !== 'evolution' && (
                <div style={s.editor}>
                  <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.45 }}>
                    Por segurança, as credenciais atuais não são exibidas. Informe as duas novamente; a conexão será testada antes de salvar. A URL pode terminar no token ou em <code>/send-text</code> — o sistema normaliza automaticamente.
                  </div>
                  <FInput label="URL da instância Z-API" value={editInstanceUrl} onChange={setEditInstanceUrl} placeholder="https://api.z-api.io/instances/ID/token/TOKEN" />
                  <FInput label="Client-Token Z-API" value={editApiToken} onChange={setEditApiToken} type="password" placeholder="token de segurança da conta" />
                  <div style={s.row}>
                    <Btn onClick={() => saveConnection(n)} disabled={connectionBusy === n.id}>{connectionBusy === n.id ? 'Testando...' : 'Testar e salvar'}</Btn>
                    <button style={s.linkBtn} onClick={() => setEditingId(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

      <form onSubmit={add} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Adicionar número</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.textSub }}>
          Provedor
          <select value={provider} onChange={event => setProvider(event.target.value)} style={s.assign}>
            <option value="evolution">Evolution API — recomendado</option>
            <option value="zapi">Z-API — legado/rollback</option>
          </select>
        </label>
        <FInput label="Nome/função" value={label} onChange={setLabel} placeholder="Ex: Concierge" />
        <FInput label="Telefone (opcional)" value={phone} onChange={setPhone} placeholder="Ex: 5511999990000" />
        {provider === 'zapi' && <>
          <FInput label="URL da instância Z-API" value={instanceUrl} onChange={setInstanceUrl} placeholder="https://api.z-api.io/instances/ID/token/TOKEN" />
          <FInput label="Client-Token Z-API" value={apiToken} onChange={setApiToken} type="password" placeholder="token de segurança da conta" />
        </>}
        <Btn disabled={saving}>{saving ? (provider === 'evolution' ? 'Criando instância...' : 'Testando e salvando...') : (provider === 'evolution' ? 'Criar e mostrar QR Code' : 'Adicionar número Z-API')}</Btn>
      </form>
    </div>
  )
}
