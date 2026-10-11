import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { buildTimeline } from '../lib/timeline.js'
import { addNote } from '../lib/taskActions.js'

// Aba Timeline: carrega as fontes reais e monta a linha do tempo (derivada). Permite registrar nota.
function fmtWhen(at) {
  if (!at) return ''
  try {
    const d = new Date(at)
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export function OpportunityTimeline({ ownerId, opp, userId }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    const [histRes, msgRes, taskRes, noteRes] = await Promise.all([
      supabase.from('opportunity_stage_history').select('from_stage, to_stage, source, created_at').eq('opportunity_id', opp.id).order('created_at', { ascending: false }),
      opp.patient_id
        ? supabase.from('whatsapp_messages').select('direction, body, created_at').eq('patient_id', opp.patient_id).order('created_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
      supabase.from('tasks').select('title, status, done_at, created_at').eq('opportunity_id', opp.id),
      supabase.from('opportunity_notes').select('body, author_id, created_at').eq('opportunity_id', opp.id).order('created_at', { ascending: false }),
    ])
    setEvents(buildTimeline({
      opp, stageHistory: histRes.data || [], messages: msgRes.data || [], tasks: taskRes.data || [], notes: noteRes.data || [],
    }))
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [opp?.id])

  async function submitNote() {
    if (!note.trim() || saving) return
    setSaving(true); setError(null)
    const res = await addNote(ownerId, opp.id, note, userId)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setNote('')
    load()
  }

  const s = {
    noteRow: { display: 'flex', gap: 8, marginBottom: 14 },
    input: { ...base.input, fontSize: 13, flex: 1 },
    btn: { padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' },
    item: { display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` },
    icon: { fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' },
    body: { flex: 1, minWidth: 0 },
    text: { fontSize: 13, color: C.text, wordBreak: 'break-word' },
    when: { fontSize: 11, color: C.textDim, marginTop: 1 },
    meta: { fontSize: 11, color: C.textSub },
  }

  return (
    <div>
      <div style={s.noteRow}>
        <input style={s.input} placeholder="Registrar nota…" value={note}
          onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitNote() }} />
        <button type="button" style={s.btn} onClick={submitNote} disabled={saving || !note.trim()}>Anotar</button>
      </div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {loading
        ? <div style={{ color: C.textSub, fontSize: 13, padding: 20, textAlign: 'center' }}>Carregando timeline…</div>
        : events.length === 0
          ? <div style={{ color: C.textDim, fontSize: 13, padding: '16px 0' }}>Sem eventos ainda.</div>
          : events.map((e, i) => (
              <div key={i} style={s.item}>
                <span style={s.icon}>{e.icon}</span>
                <div style={s.body}>
                  <div style={s.text}>{e.text}</div>
                  <div style={s.when}>{fmtWhen(e.at)}{e.meta ? <span style={s.meta}> · {e.meta}</span> : null}</div>
                </div>
              </div>
            ))}
    </div>
  )
}
