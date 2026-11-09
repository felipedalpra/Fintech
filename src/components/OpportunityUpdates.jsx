// Aba "Atualizações" da oportunidade (estilo Monday): comentários internos da equipe, com
// respostas e menções @nome. Fonte única: opportunity_notes (as mesmas notas da Timeline e da
// coluna Observações) — nada é misturado com as mensagens do WhatsApp.
// Novas atualizações chegam pelo Realtime, sem recarregar a página.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { addNote } from '../lib/taskActions.js'
import { loadOpportunityUpdates } from '../lib/crmWorkspaceStore.js'
import {
  mentionables, extractMentions, splitMentions, mentionQueryAt, insertMention, buildThreads, memberName,
} from '../lib/crmUpdates.js'
import { Avatar } from './CrmCells.jsx'

function fmtWhen(at) {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function OpportunityUpdates({ ownerId, opp, userId, members, onCountChange }) {
  const [notes, setNotes] = useState([])
  const [threaded, setThreaded] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const oppId = opp?.id

  const memberLabel = useMemo(() => Object.fromEntries((members || []).map(m => [m.user_id, m.member_email || m.user_id])), [members])
  const people = useMemo(() => mentionables(members), [members])
  const threads = useMemo(() => buildThreads(notes), [notes])

  // Acrescenta sem duplicar (a mesma atualização pode chegar pelo insert e pelo Realtime).
  // Ids já vistos ficam num ref: o contador da coluna sobe uma única vez por atualização.
  const seenRef = useRef(new Set())
  const onCountRef = useRef(onCountChange)
  onCountRef.current = onCountChange
  const addLocal = useCallback((note) => {
    if (!note?.id || seenRef.current.has(note.id)) return
    seenRef.current.add(note.id)
    setNotes(prev => [...prev, note])
    onCountRef.current?.(1)
  }, [])

  useEffect(() => {
    if (!oppId) return undefined
    let mounted = true
    seenRef.current = new Set()
    setNotes([]); setLoading(true); setError(null); setReplyTo(null)
    loadOpportunityUpdates(oppId).then(res => {
      if (!mounted) return
      // Uma que chegou pelo Realtime durante a carga não se perde nem duplica.
      setNotes(prev => [...res.notes, ...prev.filter(n => !res.notes.some(x => x.id === n.id))])
      for (const n of res.notes) seenRef.current.add(n.id)
      setThreaded(res.threaded); setError(res.error); setLoading(false)
    })
    let channel = null
    try {
      channel = supabase.channel(`opp-updates-${oppId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'opportunity_notes', filter: `opportunity_id=eq.${oppId}` }, payload => {
          if (mounted) addLocal(payload?.new)
        })
        .subscribe()
    } catch { /* Realtime é conveniência: sem ele, a lista atualiza ao reabrir */ }
    return () => {
      mounted = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [oppId]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async (text, parentId = null) => {
    const mentions = threaded ? extractMentions(text, people) : []
    const res = await addNote(ownerId, oppId, text, userId, { parentId: threaded ? parentId : null, mentions })
    if (res.error) return { error: res.error }
    addLocal(res.note)
    return { ok: true }
  }, [threaded, people, ownerId, oppId, userId, addLocal])

  const s = {
    card: { border: `1px solid ${C.border}`, borderRadius: 12, background: C.card, padding: '12px 14px' },
    head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
    author: { fontSize: 13, fontWeight: 700, color: C.text },
    when: { fontSize: 11, color: C.textDim },
    body: { fontSize: 13.5, color: C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    replyBtn: { border: 'none', background: 'transparent', color: C.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 0 0', fontFamily: 'inherit' },
  }

  function Body({ text }) {
    return (
      <div style={s.body}>
        {splitMentions(text, people).map((part, i) => (part.mention
          ? <span key={i} style={{ color: C.accent, background: C.accent + '1a', borderRadius: 4, padding: '0 3px', fontWeight: 700 }}>{part.text}</span>
          : <span key={i}>{part.text}</span>))}
      </div>
    )
  }

  function NoteHead({ note }) {
    const name = memberName(memberLabel, note.author_id)
    return (
      <div style={s.head}>
        <Avatar label={memberLabel[note.author_id] || name} size={24} />
        <span style={s.author}>{name}</span>
        <span style={s.when}>{fmtWhen(note.created_at)}</span>
      </div>
    )
  }

  return (
    <div data-testid="opp-updates" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Composer people={threaded ? people : []} onSubmit={text => submit(text)} placeholder="Escreva uma atualização… use @ para mencionar alguém da equipe" testId="opp-update-input" autoFocus />
      {!threaded && !loading && (
        <div style={{ fontSize: 12, color: C.textSub, padding: '6px 10px', borderRadius: 8, background: C.yellow + '14', border: `1px solid ${C.yellow}55` }}>
          Respostas e menções ficam disponíveis depois que a atualização do banco do CRM (<code>crm_workspace_phase3.sql</code>) for aplicada.
        </div>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>}
      {loading
        ? <div style={{ color: C.textSub, fontSize: 13, padding: 20, textAlign: 'center' }}>Carregando atualizações…</div>
        : threads.length === 0
          ? <div style={{ color: C.textDim, fontSize: 13, padding: '18px 0', textAlign: 'center' }}>Nenhuma atualização ainda. Registre o primeiro comentário da equipe.</div>
          : threads.map(t => (
            <article key={t.id} data-testid="opp-update" style={s.card}>
              <NoteHead note={t} />
              <Body text={t.body} />
              {t.replies.length > 0 && (
                <div style={{ marginTop: 10, paddingLeft: 14, borderLeft: `2px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {t.replies.map(r => (
                    <div key={r.id} data-testid="opp-update-reply">
                      <NoteHead note={r} />
                      <Body text={r.body} />
                    </div>
                  ))}
                </div>
              )}
              {threaded && (replyTo === t.id
                ? <div style={{ marginTop: 10 }}>
                    <Composer people={people} compact autoFocus placeholder="Responder…" testId="opp-reply-input"
                      onCancel={() => setReplyTo(null)}
                      onSubmit={async text => { const res = await submit(text, t.id); if (res.ok) setReplyTo(null); return res }} />
                  </div>
                : <button type="button" style={s.replyBtn} onClick={() => setReplyTo(t.id)}>Responder</button>)}
            </article>
          ))}
    </div>
  )
}

// Caixa de texto com sugestão de @menção (setas, Enter/Tab para escolher, Esc fecha).
// Ctrl/⌘+Enter envia.
function Composer({ people, onSubmit, onCancel, placeholder, compact = false, autoFocus = false, testId }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState(null) // { query, start, caret }
  const [active, setActive] = useState(0)
  const ref = useRef(null)

  const suggestions = useMemo(() => {
    if (!query) return []
    const q = query.query
    return (people || []).filter(p => !q || p.handle.includes(q) || p.label.toLowerCase().includes(q)).slice(0, 6)
  }, [people, query])

  function refreshQuery(value, caret) {
    const q = mentionQueryAt(value, caret)
    setQuery(q ? { ...q, caret } : null)
    setActive(0)
  }

  function pick(person) {
    if (!query) return
    const next = insertMention(text, query.caret, query.start, person.handle)
    setText(next.text)
    setQuery(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret) }
    })
  }

  async function send() {
    const value = text.trim()
    if (!value || saving) return
    setSaving(true); setError(null)
    const res = await onSubmit(value)
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setText(''); setQuery(null)
  }

  function onKeyDown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel() }
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea ref={ref} data-testid={testId} value={text} autoFocus={autoFocus} placeholder={placeholder} rows={compact ? 2 : 3}
        aria-label={placeholder}
        onChange={e => { setText(e.target.value); refreshQuery(e.target.value, e.target.selectionStart) }}
        onClick={e => refreshQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        style={{ ...base.input, fontSize: 13.5, resize: 'vertical', minHeight: compact ? 54 : 76, lineHeight: 1.45, fontFamily: 'inherit' }} />
      {suggestions.length > 0 && (
        <div role="listbox" aria-label="Mencionar pessoa" data-testid="mention-suggestions"
          style={{ position: 'absolute', left: 8, top: '100%', zIndex: 20, marginTop: 4, minWidth: 240, background: C.card, border: `1px solid ${C.borderBright || C.border}`, borderRadius: 10, boxShadow: '0 12px 30px -12px rgba(0,0,0,.5)', padding: 4 }}>
          {suggestions.map((p, i) => (
            <button key={p.userId} type="button" role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(p) }} onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 'none', borderRadius: 7, background: i === active ? C.accent + '1f' : 'transparent', color: C.text, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <Avatar label={p.label} size={20} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>@{p.handle}</span>
              <span style={{ fontSize: 11.5, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 4 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: C.textDim, marginRight: 'auto' }}>Ctrl+Enter para enviar</span>
        {onCancel && <button type="button" onClick={onCancel} style={{ border: 'none', background: 'transparent', color: C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>}
        <button type="button" onClick={send} disabled={saving || !text.trim()} data-testid={`${testId}-send`}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: saving || !text.trim() ? 'not-allowed' : 'pointer', opacity: saving || !text.trim() ? 0.6 : 1, fontFamily: 'inherit' }}>
          {saving ? 'Enviando…' : compact ? 'Responder' : 'Publicar'}
        </button>
      </div>
    </div>
  )
}
