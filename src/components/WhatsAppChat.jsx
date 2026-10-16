import { useEffect, useRef, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { WhatsAppMedia } from './WhatsAppMedia.jsx'

// Chat de WhatsApp por paciente (inbox na área Pacientes).
// Lê o histórico de whatsapp_messages (RLS por data_owner_id) e envia pelo endpoint
// autenticado /api/whatsapp?action=message. Sem realtime por enquanto — recarrega ao enviar.
export function WhatsAppChat({ patient }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [numbers, setNumbers] = useState([])
  const [numberId, setNumberId] = useState('')
  const endRef = useRef(null)

  const phone = (patient?.phone || '').replace(/\D/g, '')

  useEffect(() => {
    let mounted = true
    async function loadNumbers() {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('id, label, phone')
        .eq('active', true)
        .order('created_at', { ascending: true })
      if (!mounted) return
      const list = data ?? []
      setNumbers(list)
      setNumberId(prev => prev || list[0]?.id || '')
    }
    loadNumbers()
    return () => { mounted = false }
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, body, status, created_at, msg_type, media_url, media_mime')
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: true })
    if (err) { setError(err.message); setLoading(false); return }
    setMessages(data ?? [])
    setLoading(false)
  }

  useEffect(() => { if (patient?.id) load() }, [patient?.id])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body || !phone || sending) return
    if (!numberId) { setError('Nenhum número de WhatsApp configurado. Peça ao admin para cadastrar em Configurações → WhatsApp.'); return }
    setSending(true)
    setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('Sessão inválida. Entre novamente.')
      const res = await fetch('/api/whatsapp?action=message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: patient.id, phone, text: body, whatsappNumberId: numberId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setText('')
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSending(false)
  }

  if (!phone) {
    return <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '32px 16px' }}>
      Cadastre um telefone do paciente (aba Dados) para conversar pelo WhatsApp.
    </div>
  }

  const s = {
    wrap: { display: 'flex', flexDirection: 'column', height: 420, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.bg },
    list: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
    empty: { color: C.textDim, fontSize: 13, textAlign: 'center', margin: 'auto' },
    row: dir => ({ display: 'flex', justifyContent: dir === 'outbound' ? 'flex-end' : 'flex-start' }),
    bubble: dir => ({
      maxWidth: '78%', padding: '8px 11px', borderRadius: 12, fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      background: dir === 'outbound' ? C.accent + '22' : C.surface,
      border: `1px solid ${dir === 'outbound' ? C.accent + '44' : C.border}`,
      color: C.text,
    }),
    meta: { fontSize: 10, color: C.textDim, marginTop: 3, textAlign: 'right' },
    form: { display: 'flex', gap: 8, padding: 10, borderTop: `1px solid ${C.border}`, background: C.surface },
    input: { flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'inherit' },
    btn: { padding: '9px 16px', borderRadius: 10, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1, fontFamily: 'inherit' },
    err: { color: C.red || '#ef4444', fontSize: 12, padding: '6px 10px' },
    mediaImg: { maxWidth: 180, maxHeight: 200, borderRadius: 8, display: 'block', cursor: 'pointer' },
    mediaAudio: { width: 210, height: 34 },
    mediaDoc: { display: 'flex', alignItems: 'center', gap: 8, color: C.accentLight || '#60a5fa', textDecoration: 'none', fontSize: 13, fontWeight: 600 },
    cap: { fontSize: 12.5, marginTop: 5, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
  }

  const renderBody = (m) => {
    const t = m.msg_type || 'text'
    const fallback = <span>{m.body || 'Mídia indisponível'}</span>
    if (t === 'image' && m.media_url) return <WhatsAppMedia message={m} fallback={fallback}>{url => <><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.body || 'imagem'} style={s.mediaImg} /></a>{m.body && <div style={s.cap}>{m.body}</div>}</>}</WhatsAppMedia>
    if (t === 'audio' && m.media_url) return <WhatsAppMedia message={m} fallback={fallback}>{url => <audio controls src={url} style={s.mediaAudio} />}</WhatsAppMedia>
    if (t === 'video' && m.media_url) return <WhatsAppMedia message={m} fallback={fallback}>{url => <><video controls src={url} style={{ ...s.mediaImg, maxHeight: 220 }} />{m.body && <div style={s.cap}>{m.body}</div>}</>}</WhatsAppMedia>
    if (t === 'document' && m.media_url) return <WhatsAppMedia message={m} fallback={fallback}>{url => <a href={url} target="_blank" rel="noreferrer" style={s.mediaDoc}>📄 {m.body || 'Documento'}</a>}</WhatsAppMedia>
    return m.body
  }

  return (
    <div>
      <div style={s.wrap}>
        <div style={s.list}>
          {loading ? <div style={s.empty}>Carregando conversa...</div>
            : messages.length === 0 ? <div style={s.empty}>Nenhuma mensagem ainda. Envie a primeira abaixo.</div>
            : messages.map(m => (
                <div key={m.id} style={s.row(m.direction)}>
                  <div>
                    <div style={s.bubble(m.direction)}>{renderBody(m)}</div>
                    <div style={s.meta}>
                      {fmtTime(m.created_at)}{m.direction === 'outbound' && m.status === 'failed' ? ' · falhou' : ''}
                    </div>
                  </div>
                </div>
              ))}
          <div ref={endRef} />
        </div>
        {error && <div style={s.err}>{error}</div>}
        {numbers.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 0', fontSize: 11, color: C.textSub }}>
            Enviar por:
            <select value={numberId} onChange={e => setNumberId(e.target.value)} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit' }}>
              {numbers.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>
        )}
        <form style={s.form} onSubmit={send}>
          <input style={s.input} value={text} onChange={e => setText(e.target.value)} placeholder="Escreva uma mensagem..." disabled={sending} />
          <button type="submit" style={s.btn} disabled={sending || !text.trim()}>{sending ? 'Enviando...' : 'Enviar'}</button>
        </form>
      </div>
    </div>
  )
}
