import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'

// Gerência dos números de WhatsApp Business da clínica (admin). Cada número = 1 instância Z-API.
// Credenciais (instance_url, api_token) são write-only pelo frontend (não lidas de volta).
const WEBHOOK_BASE = 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook'

export function WhatsAppNumbers() {
  const { ownerId } = useUserRole()
  const [numbers, setNumbers] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [phone, setPhone] = useState('')
  const [instanceUrl, setInstanceUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editInstanceUrl, setEditInstanceUrl] = useState('')
  const [editApiToken, setEditApiToken] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState({})

  async function load() {
    setLoading(true)
    const [numRes, memRes] = await Promise.all([
      supabase.from('whatsapp_numbers')
        .select('id, label, phone, active, webhook_secret, assigned_user_id')
        .order('created_at', { ascending: true }),
      supabase.rpc('clinic_team'), // roster via RPC: admin-membro (não-owner) também enxerga o time
    ])
    setNumbers(numRes.data ?? [])
    setMembers((memRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function testConnection(payload) {
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) throw new Error('Sessão inválida. Entre novamente.')
    const response = await fetch('/api/whatsapp?action=test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Falha ao testar a conexão (HTTP ${response.status}).`)
    return data
  }

  // Define o responsável (dono) do número: equipe/gestão só veem as conversas dos números delas.
  async function assign(id, assigned_user_id) {
    await supabase.from('whatsapp_numbers').update({ assigned_user_id: assigned_user_id || null }).eq('id', id)
    setNumbers(prev => prev.map(x => x.id === id ? { ...x, assigned_user_id: assigned_user_id || null } : x))
  }

  async function add(e) {
    e.preventDefault()
    if (!label.trim() || !instanceUrl.trim() || !apiToken.trim()) {
      setMsg({ type: 'error', text: 'Preencha label, URL da instância e token Z-API.' })
      return
    }
    setSaving(true)
    setMsg(null)
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
      active: true,
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
      const { error } = await supabase.from('whatsapp_numbers').update({
        instance_url: connection.instanceUrl,
        api_token: editApiToken.trim(),
      }).eq('id', n.id)
      if (error) throw error
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
    await supabase.from('whatsapp_numbers').update({ active: !n.active }).eq('id', n.id)
    setNumbers(prev => prev.map(x => x.id === n.id ? { ...x, active: !x.active } : x))
  }

  async function remove(id) {
    await supabase.from('whatsapp_numbers').delete().eq('id', id)
    setNumbers(prev => prev.filter(x => x.id !== id))
  }

  function webhookUrl(n) {
    return `${WEBHOOK_BASE}&number=${n.id}&token=${n.webhook_secret || ''}`
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
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Integração</div>
      <h3 style={{ margin: '0 0 6px', fontSize: 22, color: C.text, letterSpacing: '-0.03em' }}>Números de WhatsApp</h3>
      <p style={{ fontSize: 13, color: C.textSub, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
        Cadastre cada número de WhatsApp Business da clínica (até 3). Para cada um, crie uma instância no Z-API, cole a URL da instância e o Client-Token aqui, e configure no Z-API a URL de webhook que vai aparecer. Ao testar a conexão, o sistema ativa a sincronização das mensagens enviadas diretamente pelo WhatsApp.
      </p>

      {msg && <p style={{ fontSize: 12, color: msg.type === 'error' ? (C.red || '#ef4444') : '#10b981', margin: '0 0 12px' }}>{msg.text}</p>}

      {loading ? <div style={{ color: C.textSub, fontSize: 14 }}>Carregando...</div>
        : numbers.length === 0 ? <div style={{ color: C.textDim, fontSize: 14, marginBottom: 18 }}>Nenhum número cadastrado ainda.</div>
        : numbers.map(n => (
            <div key={n.id} style={s.item}>
              <div style={s.row}>
                <span style={s.label}>{n.label}</span>
                {n.phone && <span style={s.phone}>{n.phone}</span>}
                <span style={n.active ? s.tagOn : s.tagOff}>{n.active ? 'ativo' : 'inativo'}</span>
                <span style={{ flex: 1 }} />
                <button style={s.linkBtn} disabled={connectionBusy === n.id} onClick={() => checkConnection(n)}>{connectionBusy === n.id ? 'Testando...' : 'Testar conexão'}</button>
                <button style={s.linkBtn} onClick={() => editingId === n.id ? setEditingId(null) : beginEdit(n)}>{editingId === n.id ? 'Cancelar edição' : 'Editar conexão'}</button>
                <button style={s.linkBtn} onClick={() => toggleActive(n)}>{n.active ? 'Desativar' : 'Ativar'}</button>
                <button style={{ ...s.linkBtn, color: C.red || '#ef4444' }} onClick={() => remove(n.id)}>Remover</button>
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
              </div>
              {editingId === n.id && (
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
          ))}

      <form onSubmit={add} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Adicionar número</div>
        <FInput label="Nome/função" value={label} onChange={setLabel} placeholder="Ex: Concierge" />
        <FInput label="Telefone (opcional)" value={phone} onChange={setPhone} placeholder="Ex: 5511999990000" />
        <FInput label="URL da instância Z-API" value={instanceUrl} onChange={setInstanceUrl} placeholder="https://api.z-api.io/instances/ID/token/TOKEN" />
        <FInput label="Client-Token Z-API" value={apiToken} onChange={setApiToken} type="password" placeholder="token de segurança da conta" />
        <Btn onClick={add} disabled={saving}>{saving ? 'Testando e salvando...' : 'Adicionar número'}</Btn>
      </form>
    </div>
  )
}
