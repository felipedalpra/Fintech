import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { SuggestionBox } from './OpportunityPipeline.jsx'
import { confirmSuggestion, dismissSuggestion } from '../lib/opportunitySuggestion.js'

// Inbox central de WhatsApp (todas as conversas da clínica, estilo Chatwoot/Kommo).
// Mostra conversas atribuídas e NÃO atribuídas (lead novo que chamou no zap), filtra por
// número e permite responder escolhendo de qual dos números sair.
function fmtTime(ts) {
  try {
    const d = new Date(ts)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    return sameDay ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  } catch { return '' }
}

export function WhatsAppInbox() {
  const { ownerId } = useUserRole()
  const [messages, setMessages] = useState([])
  const [numbers, setNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [filterNumber, setFilterNumber] = useState('all')
  const [replyText, setReplyText] = useState('')
  const [replyNumberId, setReplyNumberId] = useState('')
  const [sending, setSending] = useState(false)
  const [suggestOpp, setSuggestOpp] = useState(null)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const endRef = useRef(null)

  async function load() {
    setLoading(true)
    setError(null)
    const [msgRes, numRes] = await Promise.all([
      supabase.from('whatsapp_messages')
        .select('id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, patients(full_name)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('whatsapp_numbers').select('id, label, phone').eq('active', true).order('created_at', { ascending: true }),
    ])
    if (msgRes.error) { setError(msgRes.error.message); setLoading(false); return }
    setMessages(msgRes.data ?? [])
    setNumbers(numRes.data ?? [])
    setLoading(false)
  }
  useEffect(() => { if (ownerId) load() }, [ownerId])

  const numberLabel = useMemo(() => {
    const m = {}
    for (const n of numbers) m[n.id] = n.label
    return m
  }, [numbers])

  // Agrupa mensagens (desc) em conversas por telefone; a 1ª de cada é a mais recente.
  const conversations = useMemo(() => {
    const byPhone = new Map()
    for (const m of messages) {
      if (!byPhone.has(m.phone)) {
        byPhone.set(m.phone, { phone: m.phone, last: m, name: m.patients?.full_name || null, patientId: m.patient_id, numberId: m.whatsapp_number_id, items: [] })
      }
      byPhone.get(m.phone).items.push(m)
    }
    let list = Array.from(byPhone.values())
    if (filterNumber !== 'all') list = list.filter(c => c.items.some(m => m.whatsapp_number_id === filterNumber))
    return list
  }, [messages, filterNumber])

  const current = conversations.find(c => c.phone === selectedPhone) || null
  const thread = useMemo(() => (current ? [...current.items].reverse() : []), [current])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread])
  useEffect(() => { if (current) setReplyNumberId(current.numberId || numbers[0]?.id || '') }, [current, numbers])

  // Busca a sugestão pendente da IA para a oportunidade aberta do paciente desta conversa.
  useEffect(() => {
    let active = true
    setSuggestOpp(null)
    if (!current?.patientId) return
    ;(async () => {
      const { data } = await supabase
        .from('opportunities')
        .select('id, stage, suggested_stage, suggested_reason, suggested_confidence, suggestion_status')
        .eq('patient_id', current.patientId)
        .eq('status', 'aberto')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (active && data?.suggestion_status === 'pending' && data.suggested_stage) setSuggestOpp(data)
    })()
    return () => { active = false }
  }, [current])

  async function acceptSuggestion() {
    if (!suggestOpp || suggestBusy) return
    setSuggestBusy(true)
    const { error: err } = await confirmSuggestion(suggestOpp)
    if (err) setError('Não foi possível aplicar a sugestão.')
    else setSuggestOpp(null)
    setSuggestBusy(false)
  }
  async function rejectSuggestion() {
    if (!suggestOpp || suggestBusy) return
    setSuggestBusy(true)
    const { error: err } = await dismissSuggestion(suggestOpp)
    if (err) setError('Não foi possível descartar a sugestão.')
    else setSuggestOpp(null)
    setSuggestBusy(false)
  }

  async function send(e) {
    e.preventDefault()
    const body = replyText.trim()
    if (!body || !current || sending) return
    if (!replyNumberId) { setError('Nenhum número de WhatsApp configurado (Configurações → WhatsApp).'); return }
    setSending(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('Sessão inválida. Entre novamente.')
      const res = await fetch('/api/whatsapp?action=message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: current.patientId, phone: current.phone, text: body, whatsappNumberId: replyNumberId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setReplyText('')
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSending(false)
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando conversas...</div>
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  const s = {
    wrap: { display: 'flex', gap: 0, height: 560, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.bg },
    listCol: { width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' },
    listHead: { padding: 10, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 },
    filter: { fontSize: 12, padding: '4px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit' },
    list: { flex: 1, overflowY: 'auto' },
    conv: active => ({ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: active ? C.accent + '14' : 'transparent' }),
    convTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' },
    convName: { fontSize: 13, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    convTime: { fontSize: 10, color: C.textDim, flexShrink: 0 },
    convPrev: { fontSize: 12, color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 },
    convMeta: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' },
    numTag: { fontSize: 9, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '0 5px' },
    unassigned: { fontSize: 9, color: '#f59e0b', border: '1px solid #f59e0b55', borderRadius: 5, padding: '0 5px' },
    threadCol: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
    threadHead: { padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.text },
    msgs: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
    row: dir => ({ display: 'flex', justifyContent: dir === 'outbound' ? 'flex-end' : 'flex-start' }),
    bubble: dir => ({ maxWidth: '78%', padding: '8px 11px', borderRadius: 12, fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: dir === 'outbound' ? C.accent + '22' : C.surface, border: `1px solid ${dir === 'outbound' ? C.accent + '44' : C.border}`, color: C.text }),
    meta: { fontSize: 10, color: C.textDim, marginTop: 3, textAlign: 'right' },
    form: { display: 'flex', gap: 8, padding: 10, borderTop: `1px solid ${C.border}`, background: C.surface, alignItems: 'center' },
    input: { flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'inherit' },
    btn: { padding: '9px 16px', borderRadius: 10, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1, fontFamily: 'inherit' },
    empty: { margin: 'auto', color: C.textDim, fontSize: 13, textAlign: 'center', padding: 24 },
  }

  return (
    <div style={s.wrap}>
      <div style={s.listCol}>
        <div style={s.listHead}>
          <span style={{ fontSize: 12, color: C.textSub }}>Número:</span>
          <select style={s.filter} value={filterNumber} onChange={e => setFilterNumber(e.target.value)}>
            <option value="all">Todos</option>
            {numbers.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </div>
        <div style={s.list}>
          {conversations.length === 0
            ? <div style={{ color: C.textDim, fontSize: 13, padding: 20, textAlign: 'center' }}>Nenhuma conversa ainda.</div>
            : conversations.map(c => (
                <div key={c.phone} style={s.conv(c.phone === selectedPhone)} onClick={() => setSelectedPhone(c.phone)}>
                  <div style={s.convTop}>
                    <span style={s.convName}>{c.name || c.phone}</span>
                    <span style={s.convTime}>{fmtTime(c.last.created_at)}</span>
                  </div>
                  <div style={s.convPrev}>{c.last.direction === 'outbound' ? '→ ' : ''}{c.last.body}</div>
                  <div style={s.convMeta}>
                    {c.numberId && numberLabel[c.numberId] && <span style={s.numTag}>{numberLabel[c.numberId]}</span>}
                    {!c.patientId && <span style={s.unassigned}>⚠ não atribuída</span>}
                  </div>
                </div>
              ))}
        </div>
      </div>

      <div style={s.threadCol}>
        {!current
          ? <div style={s.empty}>Selecione uma conversa à esquerda.</div>
          : <>
              <div style={s.threadHead}>
                {current.name || current.phone}
                {!current.patientId && <span style={{ ...s.unassigned, marginLeft: 8 }}>não atribuída</span>}
              </div>
              {suggestOpp && (
                <div style={{ padding: '10px 14px 0' }}>
                  <SuggestionBox opp={suggestOpp} disabled={suggestBusy}
                    onAccept={acceptSuggestion} onReject={rejectSuggestion} />
                </div>
              )}
              <div style={s.msgs}>
                {thread.map(m => (
                  <div key={m.id} style={s.row(m.direction)}>
                    <div>
                      <div style={s.bubble(m.direction)}>{m.body}</div>
                      <div style={s.meta}>{fmtTime(m.created_at)}{m.direction === 'outbound' && m.status === 'failed' ? ' · falhou' : ''}</div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <form style={s.form} onSubmit={send}>
                {numbers.length > 1 && (
                  <select value={replyNumberId} onChange={e => setReplyNumberId(e.target.value)} style={s.filter} title="Responder por">
                    {numbers.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                )}
                <input style={s.input} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Responder..." disabled={sending} />
                <button type="submit" style={s.btn} disabled={sending || !replyText.trim()}>{sending ? '...' : 'Enviar'}</button>
              </form>
            </>}
      </div>
    </div>
  )
}
