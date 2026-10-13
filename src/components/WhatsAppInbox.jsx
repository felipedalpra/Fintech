import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { SuggestionBox } from './OpportunityPipeline.jsx'
import { confirmSuggestion, dismissSuggestion } from '../lib/opportunitySuggestion.js'
import { uploadWhatsAppMedia, mediaTypeFromMime } from '../lib/whatsappUpload.js'

// Inbox central de WhatsApp (todas as conversas da clínica, estilo Chatwoot/Kommo).
// Mostra conversas atribuídas e NÃO atribuídas (lead novo que chamou no zap), filtra por
// número e permite responder escolhendo de qual dos números sair.
// Emojis comuns para o seletor do composer (enviados como texto via send-text).
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','👍','🙏','🙌','👏','💪','🎉','❤️','🔥','✅','⚠️','😉','😅','😢','😎','🤔','👌','💜','🌟','⏰','📅','💉','🩹','👋','🙂','🤗']
function mediaLabel(type) {
  return { image: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento' }[type] || ''
}
// Texto de preview da conversa na lista (mídia vira rótulo).
function previewText(m) {
  if (m.msg_type && m.msg_type !== 'text') return m.body ? `${mediaLabel(m.msg_type)}: ${m.body}` : mediaLabel(m.msg_type)
  return m.body
}

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
  const { ownerId, role, isOwner } = useUserRole()
  const isAdmin = isOwner || role === 'admin' // só admin monitora (vê o filtro por responsável)
  const [messages, setMessages] = useState([])
  const [numbers, setNumbers] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [filterNumber, setFilterNumber] = useState('all')
  const [filterResponsible, setFilterResponsible] = useState('all')
  const [replyText, setReplyText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [replyNumberId, setReplyNumberId] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [suggestOpp, setSuggestOpp] = useState(null)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const endRef = useRef(null)
  const fileRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])

  async function load() {
    setLoading(true)
    setError(null)
    const [msgRes, numRes, memRes] = await Promise.all([
      supabase.from('whatsapp_messages')
        .select('id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, msg_type, media_url, media_mime, patients(full_name)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('whatsapp_numbers').select('id, label, phone, assigned_user_id').eq('active', true).order('created_at', { ascending: true }),
      supabase.rpc('clinic_team'), // roster via RPC: admin-membro (não-owner) também enxerga o time
    ])
    if (msgRes.error) { setError(msgRes.error.message); setLoading(false); return }
    setMessages(msgRes.data ?? [])
    setNumbers(numRes.data ?? [])
    setMembers((memRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { if (ownerId) load() }, [ownerId])

  const numberLabel = useMemo(() => {
    const m = {}
    for (const n of numbers) m[n.id] = n.label
    return m
  }, [numbers])
  // número → responsável (user_id) e user_id → nome curto (prefixo do e-mail), para o chip de dono.
  const numberOwner = useMemo(() => {
    const m = {}
    for (const n of numbers) m[n.id] = n.assigned_user_id || null
    return m
  }, [numbers])
  const memberLabel = useMemo(() => {
    const m = {}
    for (const mem of members) m[mem.user_id] = (mem.member_email || '').split('@')[0] || mem.member_email
    return m
  }, [members])
  // Nome do responsável de uma conversa (pelo número); null = não atribuída.
  const ownerName = (numberId) => {
    const uid = numberId ? numberOwner[numberId] : null
    return uid ? (memberLabel[uid] || 'Responsável') : null
  }

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
    // Filtro por responsável (só admin): 'unassigned' = número sem dono.
    if (filterResponsible !== 'all') {
      list = list.filter(c => {
        const uid = c.numberId ? numberOwner[c.numberId] : null
        return filterResponsible === 'unassigned' ? !uid : uid === filterResponsible
      })
    }
    return list
  }, [messages, filterNumber, filterResponsible, numberOwner])

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

  // POST comum para /api/whatsapp?action=message (texto ou mídia). `target` fixa a conversa
  // destino (importante para áudio: a gravação pode terminar depois de trocar de conversa).
  async function postPayload(extra, target = current) {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) throw new Error('Sessão inválida. Entre novamente.')
    const res = await fetch('/api/whatsapp?action=message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ patientId: target.patientId, phone: target.phone, whatsappNumberId: replyNumberId, ...extra }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
    await load()
  }

  async function send(e) {
    e.preventDefault()
    const body = replyText.trim()
    if (!body || !current || sending) return
    if (!replyNumberId) { setError('Nenhum número de WhatsApp configurado (Configurações → WhatsApp).'); return }
    setSending(true)
    try {
      await postPayload({ text: body })
      setReplyText('')
    } catch (err) { setError(err.message) }
    setSending(false)
  }

  // Sobe o arquivo direto ao Storage e envia a mídia (imagem/documento/áudio) para `target`.
  async function sendMediaFile(file, type, target = current) {
    if (!target || uploading || sending) return
    if (!replyNumberId) { setError('Nenhum número de WhatsApp configurado (Configurações → WhatsApp).'); return }
    setUploading(true); setError(null)
    try {
      const up = await uploadWhatsAppMedia(file, ownerId, { type })
      await postPayload({ type: up.type, mediaUrl: up.url, mediaMime: up.mime, fileName: up.fileName, caption: '' }, target)
    } catch (err) { setError(err.message) }
    setUploading(false)
  }

  function onPickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite reenviar o mesmo arquivo
    if (file) sendMediaFile(file, mediaTypeFromMime(file.type))
  }

  // Gravação de nota de voz no navegador (MediaRecorder) → envia como áudio (PTT).
  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return }
    if (!current || !replyNumberId) { setError('Selecione uma conversa e um número para gravar.'); return }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Gravação de áudio não é suportada neste navegador.'); return
    }
    const target = current // fixa a conversa destino: a gravação pode terminar após trocar de conversa
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Prefere ogg/opus (toca melhor no WhatsApp do destinatário); cai para o que o browser suportar.
      const mt = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find(t => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } })
      const rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined)
      chunksRef.current = []
      rec.ondataavailable = ev => { if (ev.data.size) chunksRef.current.push(ev.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        const mime = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size) {
          const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'
          await sendMediaFile(new File([blob], `voz-${Date.now()}.${ext}`, { type: mime }), 'audio', target)
        }
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      setError('Não foi possível acessar o microfone.')
    }
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando conversas...</div>
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  const s = {
    wrap: { display: 'flex', gap: 0, height: 560, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.bg },
    listCol: { width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' },
    listHead: { padding: 10, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    filter: { fontSize: 12, padding: '4px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit' },
    list: { flex: 1, overflowY: 'auto' },
    conv: active => ({ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', background: active ? C.accent + '14' : 'transparent' }),
    convTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' },
    convName: { fontSize: 13, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    convTime: { fontSize: 10, color: C.textDim, flexShrink: 0 },
    convPrev: { fontSize: 12, color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 },
    convMeta: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' },
    numTag: { fontSize: 9, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '0 5px' },
    ownerTag: { fontSize: 9, fontWeight: 700, color: C.accentLight || '#60a5fa', background: (C.accent || '#3b82f6') + '1f', border: `1px solid ${(C.accent || '#3b82f6')}44`, borderRadius: 5, padding: '0 5px' },
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
    mediaImg: { maxWidth: 200, maxHeight: 220, borderRadius: 8, display: 'block', cursor: 'pointer' },
    mediaAudio: { width: 230, height: 36 },
    mediaDoc: { display: 'flex', alignItems: 'center', gap: 8, color: C.accentLight || '#60a5fa', textDecoration: 'none', fontSize: 13, fontWeight: 600 },
    cap: { fontSize: 12.5, marginTop: 5, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    emojiBtn: { width: 34, height: 34, flexShrink: 0, borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, fontSize: 16, cursor: 'pointer', lineHeight: 1 },
    recOn: { background: (C.red || '#ef4444') + '22', borderColor: C.red || '#ef4444' },
    emojiPop: { position: 'absolute', bottom: 46, left: 0, background: C.card, border: `1px solid ${C.borderBright || C.border}`, borderRadius: 10, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 5, width: 260 },
    emojiItem: { border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', padding: 3, borderRadius: 6, lineHeight: 1 },
  }

  // Renderiza o corpo da mensagem conforme o tipo (texto já é o padrão).
  const renderBody = (m) => {
    const t = m.msg_type || 'text'
    if (t === 'image' && m.media_url) return (
      <>
        <a href={m.media_url} target="_blank" rel="noreferrer"><img src={m.media_url} alt={m.body || 'imagem'} style={s.mediaImg} /></a>
        {m.body && <div style={s.cap}>{m.body}</div>}
      </>
    )
    if (t === 'audio' && m.media_url) return <audio controls src={m.media_url} style={s.mediaAudio} />
    if (t === 'video' && m.media_url) return (
      <>
        <video controls src={m.media_url} style={{ ...s.mediaImg, maxHeight: 240 }} />
        {m.body && <div style={s.cap}>{m.body}</div>}
      </>
    )
    if (t === 'document' && m.media_url) return (
      <a href={m.media_url} target="_blank" rel="noreferrer" style={s.mediaDoc}>📄 {m.body || 'Documento'}</a>
    )
    return m.body
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
          {isAdmin && (
            <>
              <span style={{ fontSize: 12, color: C.textSub }}>Resp.:</span>
              <select style={s.filter} value={filterResponsible} onChange={e => setFilterResponsible(e.target.value)} title="Monitorar por responsável">
                <option value="all">Todos</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{memberLabel[m.user_id]}</option>)}
                <option value="unassigned">Sem responsável</option>
              </select>
            </>
          )}
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
                  <div style={s.convPrev}>{c.last.direction === 'outbound' ? '→ ' : ''}{previewText(c.last)}</div>
                  <div style={s.convMeta}>
                    {c.numberId && numberLabel[c.numberId] && <span style={s.numTag}>{numberLabel[c.numberId]}</span>}
                    {ownerName(c.numberId) && <span style={s.ownerTag}>{ownerName(c.numberId)}</span>}
                    {isAdmin && c.numberId && !numberOwner[c.numberId] && <span style={s.unassigned}>sem responsável</span>}
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
                {ownerName(current.numberId) && <span style={{ ...s.ownerTag, marginLeft: 8 }}>{ownerName(current.numberId)}</span>}
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
                      <div style={s.bubble(m.direction)}>{renderBody(m)}</div>
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
                <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={onPickFile} />
                <button type="button" style={s.emojiBtn} onClick={() => fileRef.current?.click()} disabled={uploading || recording} title="Anexar imagem ou documento" aria-label="Anexar arquivo">📎</button>
                <div style={{ position: 'relative' }}>
                  <button type="button" style={s.emojiBtn} onClick={() => setShowEmoji(v => !v)} title="Emoji" aria-label="Inserir emoji">😊</button>
                  {showEmoji && (
                    <div style={s.emojiPop}>
                      {EMOJIS.map(e => (
                        <button key={e} type="button" style={s.emojiItem} onClick={() => setReplyText(t => t + e)}>{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" style={{ ...s.emojiBtn, ...(recording ? s.recOn : {}) }} onClick={toggleRecord} disabled={uploading} title={recording ? 'Parar e enviar' : 'Gravar áudio'} aria-label="Gravar áudio">{recording ? '⏹' : '🎤'}</button>
                <input style={s.input} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder={uploading ? 'Enviando mídia…' : recording ? 'Gravando áudio…' : 'Responder...'} disabled={sending || uploading || recording} />
                <button type="submit" style={s.btn} disabled={sending || uploading || recording || !replyText.trim()}>{sending ? '...' : 'Enviar'}</button>
              </form>
            </>}
      </div>
    </div>
  )
}
