// Células editáveis da tabela do CRM (estilo Monday). Cada célula mostra o valor e, ao clicar
// (ou Enter), abre o editor no próprio lugar ou num popover ancorado. A gravação é feita por
// `onCommit(valor)` — quem chama decide o caminho (patch parcial, RPC de etapa, campo personalizado).
// Estilos SEMPRE calculados dentro dos componentes (tema claro/escuro).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../theme.js'
import { initials, avatarColor } from '../lib/avatar.js'
import { WhatsAppGlyph } from './WhatsAppGlyph.jsx'
import { OUTCOMES, effectiveProbability } from '../lib/crmStages.js'
import { daysSince, optionLabel } from '../lib/crmWorkspace.js'
import { opportunityPerson } from '../lib/crmContact.js'

// ---------------------------------------------------------------------------
// Utilitários visuais
// ---------------------------------------------------------------------------
export function Ico({ d, size = 14, sw = 2, fill = 'none' }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}

export const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8Z" />,
  sort: <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  group: <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></>,
  dots: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
  comment: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />,
  open: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  arrowUp: <path d="m6 15 6-6 6 6" />,
  arrowDown: <path d="m6 9 6 6 6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
}

export function Avatar({ label, size = 26 }) {
  return (
    <span title={label} style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', flexShrink: 0,
      fontSize: size <= 22 ? 9 : 11, fontWeight: 800, color: '#fff', background: avatarColor(label),
      border: `2px solid ${C.card}`,
    }}>{initials(label)}</span>
  )
}

export function fmtMoney(v, digits = 0) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function fmtDate(iso) {
  if (!iso) return null
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  if (!y || !m || !d) return null
  return `${d}/${m}/${y.slice(2)}`
}

function fmtDateTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function relativeDays(ts) {
  const d = daysSince(ts)
  if (d == null) return null
  if (d === 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

// Texto legível sobre uma cor (status cheio estilo Monday).
function textOn(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7 ? '#0b1a2b' : '#fff'
}

// ---------------------------------------------------------------------------
// Popover ancorado (portal → não é cortado pela rolagem da tabela)
// ---------------------------------------------------------------------------
export function Popover({ anchorRef, open, onClose, children, width = 230, align = 'left', testId, label }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const a = anchorRef.current?.getBoundingClientRect()
      if (!a) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const h = panelRef.current?.offsetHeight || 0
      let left = align === 'right' ? a.right - width : a.left
      left = Math.max(8, Math.min(left, vw - width - 8))
      let top = a.bottom + 4
      if (h && top + h > vh - 8 && a.top - h - 4 > 8) top = a.top - h - 4
      setPos({ left, top })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, width, align])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return
      onClose?.()
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); anchorRef.current?.focus?.() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, anchorRef])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={label} data-testid={testId}
      style={{
        position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, zIndex: 1200,
        maxHeight: 'min(420px, calc(100vh - 24px))', overflowY: 'auto',
        background: C.card, border: `1px solid ${C.borderBright}`, borderRadius: 12, padding: 6,
        boxShadow: '0 18px 48px -12px rgba(0,0,0,.55)',
      }}>
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ children, onClick, active, color, danger, disabled, testId }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" role="menuitem" disabled={disabled} data-testid={testId}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8,
        border: 'none', textAlign: 'left', fontSize: 12.5, fontWeight: active ? 700 : 500, fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: active ? C.accent + '1c' : hover ? C.cardHover : 'transparent',
        color: danger ? (C.red || '#ef4444') : active ? C.accent : (color || C.text),
      }}>
      {children}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder = 'Buscar…' }) {
  return (
    <input autoFocus value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6, fontSize: 12.5, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, outline: 'none', fontFamily: 'inherit' }} />
  )
}

// ---------------------------------------------------------------------------
// Moldura da célula: foco por teclado, Enter abre, clique abre.
// ---------------------------------------------------------------------------
function useCellFrame() {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  return { ref, open, setOpen }
}

function cellBase(extra = {}) {
  return {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', boxSizing: 'border-box',
    border: 'none', background: 'transparent', color: C.text, fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
    cursor: 'pointer', outline: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', ...extra,
  }
}

function Placeholder({ children = '—' }) {
  return <span style={{ color: C.textDim }}>{children}</span>
}

// Célula de texto/número editável no próprio lugar.
function InlineInput({ initial, type = 'text', onSave, onCancel, align = 'left', step }) {
  const [draft, setDraft] = useState(initial ?? '')
  const done = useRef(false)
  function finish(save) {
    if (done.current) return
    done.current = true
    if (save) onSave(draft)
    else onCancel()
  }
  return (
    <input autoFocus type={type} value={draft} step={step}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
      }}
      style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: '0 9px', border: `2px solid ${C.accent}`, borderRadius: 4, background: C.card, color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: align }} />
  )
}

export function TextCell({ value, onCommit, readOnly, placeholder, multiline = false, testId }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <InlineInput initial={value ?? ''} onCancel={() => setEditing(false)}
      onSave={v => { setEditing(false); if ((v || '').trim() !== (value || '').trim()) onCommit(v) }} />
  }
  return (
    <button type="button" data-testid={testId} disabled={readOnly} title={value || undefined}
      onClick={() => !readOnly && setEditing(true)}
      style={cellBase({ cursor: readOnly ? 'default' : 'text', display: 'block', lineHeight: '36px' })}>
      {value ? value : <Placeholder>{placeholder || (multiline ? '' : '')}</Placeholder>}
    </button>
  )
}

export function NumberCell({ value, onCommit, readOnly, format = 'number', testId }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <InlineInput type="number" step="any" align="right" initial={value == null ? '' : String(value)} onCancel={() => setEditing(false)}
      onSave={v => { setEditing(false); if (String(v) !== String(value ?? '')) onCommit(v) }} />
  }
  let shown = null
  if (value != null && value !== '') {
    if (format === 'currency') shown = fmtMoney(value, Number(value) % 1 ? 2 : 0)
    else if (format === 'percent') shown = `${Number(value).toLocaleString('pt-BR')}%`
    else shown = Number(value).toLocaleString('pt-BR')
  }
  return (
    <button type="button" data-testid={testId} disabled={readOnly} onClick={() => !readOnly && setEditing(true)}
      style={cellBase({ justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums', cursor: readOnly ? 'default' : 'text', fontWeight: format === 'currency' ? 600 : 500 })}>
      {shown || <Placeholder />}
    </button>
  )
}

export function ProbabilityCell({ opp, stagesByKey, onCommit, readOnly }) {
  const [editing, setEditing] = useState(false)
  const eff = effectiveProbability(opp, stagesByKey)
  const inherited = opp.probability == null && opp.status === 'aberto'
  if (editing) {
    return <InlineInput type="number" step="1" align="right" initial={opp.probability == null ? '' : String(opp.probability)}
      onCancel={() => setEditing(false)}
      onSave={v => { setEditing(false); if (String(v) !== String(opp.probability ?? '')) onCommit(v) }} />
  }
  const closed = opp.status !== 'aberto'
  return (
    <button type="button" disabled={readOnly || closed} onClick={() => !readOnly && !closed && setEditing(true)}
      title={closed ? 'Oportunidade encerrada' : inherited ? 'Padrão da etapa — clique para definir' : 'Definida nesta oportunidade (apague para voltar ao padrão da etapa)'}
      style={cellBase({ cursor: readOnly || closed ? 'default' : 'text', gap: 8 })}>
      {eff == null ? <Placeholder /> : <>
        <span style={{ flex: 1, height: 6, borderRadius: 4, background: C.border, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, eff))}%`, background: inherited ? C.textDim : C.accent }} />
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 700, color: inherited ? C.textDim : C.text, minWidth: 34, textAlign: 'right' }}>
          {Math.round(eff)}%
        </span>
      </>}
    </button>
  )
}

export function DateCell({ value, onCommit, readOnly, overdueBefore, testId }) {
  const [editing, setEditing] = useState(false)
  const overdue = Boolean(value && overdueBefore && value < overdueBefore)
  if (editing) {
    return (
      <input autoFocus type="date" defaultValue={value || ''}
        onBlur={e => { setEditing(false); if ((e.target.value || null) !== (value || null)) onCommit(e.target.value || null) }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) }
        }}
        style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: '0 6px', border: `2px solid ${C.accent}`, borderRadius: 4, background: C.card, color: C.text, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', colorScheme: 'inherit' }} />
    )
  }
  return (
    <button type="button" data-testid={testId} disabled={readOnly} onClick={() => !readOnly && setEditing(true)}
      title={overdue ? 'Prazo vencido' : undefined}
      style={cellBase({ justifyContent: 'center', cursor: readOnly ? 'default' : 'pointer' })}>
      {value
        ? <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', background: overdue ? (C.red || '#ef4444') : C.surface, color: overdue ? '#fff' : C.text, border: overdue ? 'none' : `1px solid ${C.border}` }}>
            {overdue && '⚠ '}{fmtDate(value)}
          </span>
        : <Placeholder />}
    </button>
  )
}

export function ReadOnlyCell({ children, align = 'left', title }) {
  return <div title={title} style={cellBase({ cursor: 'default', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' })}>{children}</div>
}

export function DateTimeCell({ value }) {
  return <ReadOnlyCell align="center">{fmtDateTime(value) || <Placeholder />}</ReadOnlyCell>
}

export function DaysCell({ value }) {
  const d = daysSince(value)
  return <ReadOnlyCell align="center">{d == null ? <Placeholder /> : <span style={{ color: d >= 7 ? (C.yellow || '#f59e0b') : C.textSub, fontWeight: 600 }}>{d}d</span>}</ReadOnlyCell>
}

const CONTACT_SOURCE = { whatsapp: 'WhatsApp', tarefa: 'Tarefa concluída', nota: 'Observação' }
export function LastContactCell({ info, available }) {
  if (!available) return <ReadOnlyCell align="center" title="Disponível após a atualização do banco do CRM"><Placeholder /></ReadOnlyCell>
  if (!info?.at) return <ReadOnlyCell align="center" title="Nenhum contato registrado"><Placeholder>Sem contato</Placeholder></ReadOnlyCell>
  const d = daysSince(info.at)
  return (
    <ReadOnlyCell align="center" title={`${CONTACT_SOURCE[info.source] || 'Contato'} em ${fmtDateTime(info.at)}`}>
      <span style={{ fontSize: 12.5, color: d != null && d > 5 ? (C.yellow || '#f59e0b') : C.textSub, fontWeight: 600 }}>{relativeDays(info.at)}</span>
    </ReadOnlyCell>
  )
}

export function WhatsAppCell({ opp }) {
  const person = opportunityPerson(opp)
  const digits = String(person.phone || '').replace(/\D/g, '')
  return (
    <ReadOnlyCell align="center">
      <button type="button" disabled={!digits} aria-label={digits ? `Abrir WhatsApp de ${person.name}` : 'Sem telefone'}
        title={digits ? 'Abrir conversa no WhatsApp' : 'Sem telefone cadastrado'}
        onClick={() => { if (digits) window.open(`https://wa.me/${digits}`, '_blank', 'noopener') }}
        style={{ width: 28, height: 26, borderRadius: 7, border: 'none', display: 'grid', placeItems: 'center', color: '#fff', background: digits ? '#25D366' : C.surface, cursor: digits ? 'pointer' : 'not-allowed', opacity: digits ? 1 : 0.6 }}>
        <WhatsAppGlyph size={14} />
      </button>
    </ReadOnlyCell>
  )
}

export function NotesCell({ count, onOpen }) {
  return (
    <ReadOnlyCell align="center">
      <button type="button" onClick={onOpen} aria-label="Abrir atualizações" title="Atualizações da equipe"
        style={{ position: 'relative', border: 'none', background: 'transparent', color: count ? C.accent : C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 4 }}>
        <Ico d={ICONS.comment} size={18} sw={1.8} />
        {count > 0 && <span style={{ position: 'absolute', right: -2, bottom: -1, minWidth: 15, height: 15, borderRadius: 8, background: C.accent, color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{count}</span>}
      </button>
    </ReadOnlyCell>
  )
}

// ---------------------------------------------------------------------------
// Células com lista (popover)
// ---------------------------------------------------------------------------
// Status "cheio" estilo Monday: a célula inteira assume a cor da opção.
export function StatusCell({ label, color, options, value, onPick, readOnly, busy, testId, emptyLabel = '', allowClear = false, popLabel }) {
  const { ref, open, setOpen } = useCellFrame()
  const bg = color || C.surface
  return (
    <>
      <button ref={ref} type="button" data-testid={testId} disabled={readOnly || busy}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={cellBase({
          justifyContent: 'center', background: label ? bg : 'transparent', color: label ? textOn(bg) : C.textDim,
          fontWeight: 700, fontSize: 12.5, cursor: readOnly ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          borderRadius: 0, transition: 'filter .12s',
        })}>
        {label || emptyLabel || <span style={{ color: C.textDim }}>—</span>}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={210} label={popLabel}>
        <div role="listbox" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map(o => (
            <button key={o.key} type="button" role="option" aria-selected={o.key === value}
              onClick={() => { setOpen(false); if (o.key !== value) onPick(o.key) }}
              style={{ border: o.key === value ? `2px solid ${C.text}` : '2px solid transparent', borderRadius: 6, padding: '7px 10px', background: o.color, color: textOn(o.color), fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
              {o.label}
            </button>
          ))}
          {allowClear && value != null && (
            <MenuItem onClick={() => { setOpen(false); onPick(null) }}>Limpar</MenuItem>
          )}
        </div>
      </Popover>
    </>
  )
}

export function MemberCell({ value, members, memberLabel, onCommit, readOnly, testId }) {
  const { ref, open, setOpen } = useCellFrame()
  const [q, setQ] = useState('')
  const label = value ? (memberLabel?.[value] || 'Usuário') : null
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (members || []).map(m => ({ id: m.user_id, label: memberLabel?.[m.user_id] || m.member_email || m.user_id }))
      .filter(m => !t || m.label.toLowerCase().includes(t))
  }, [members, memberLabel, q])
  return (
    <>
      <button ref={ref} type="button" data-testid={testId} disabled={readOnly} aria-haspopup="listbox" aria-expanded={open}
        aria-label={label ? `Responsável: ${label}` : 'Atribuir responsável'}
        onClick={() => { setQ(''); setOpen(o => !o) }} style={cellBase({ justifyContent: 'center' })}>
        {label ? <Avatar label={label} size={26} />
          : <span style={{ width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${C.borderBright}`, display: 'grid', placeItems: 'center', color: C.textDim }}><Ico d={ICONS.user} size={13} /></span>}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240} label="Escolher responsável">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar pessoa…" />
        <MenuItem onClick={() => { setOpen(false); if (value) onCommit(null) }} active={!value}>Sem responsável</MenuItem>
        {list.map(m => (
          <MenuItem key={m.id} active={m.id === value} onClick={() => { setOpen(false); if (m.id !== value) onCommit(m.id) }}>
            <Avatar label={m.label} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
          </MenuItem>
        ))}
      </Popover>
    </>
  )
}

export function OptionListCell({ value, options, onCommit, readOnly, testId, placeholder = 'Selecionar', searchPlaceholder = 'Buscar…', clearLabel = 'Nenhum', creatable = false, popLabel, unknownLabel = 'Opção removida' }) {
  const { ref, open, setOpen } = useCellFrame()
  const [q, setQ] = useState('')
  const current = options.find(o => o.key === value)
  const t = q.trim().toLowerCase()
  const list = options.filter(o => !t || o.label.toLowerCase().includes(t))
  const canCreate = creatable && q.trim() && !options.some(o => o.label.toLowerCase() === t)
  return (
    <>
      <button ref={ref} type="button" data-testid={testId} disabled={readOnly} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setQ(''); setOpen(o => !o) }} title={current?.label || undefined} style={cellBase({ justifyContent: 'center' })}>
        {current
          ? <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: (current.color || C.accent) + '26', color: C.text, border: `1px solid ${(current.color || C.accent)}66` }}>{current.label}</span>
          : (value ? <span style={{ fontSize: 12, color: C.textDim, fontStyle: 'italic' }}>{unknownLabel}</span> : <Placeholder>{''}</Placeholder>)}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240} label={popLabel || placeholder}>
        <SearchBox value={q} onChange={setQ} placeholder={searchPlaceholder} />
        <MenuItem active={!value} onClick={() => { setOpen(false); if (value) onCommit(null) }}>{clearLabel}</MenuItem>
        {list.map(o => (
          <MenuItem key={o.key} active={o.key === value} onClick={() => { setOpen(false); if (o.key !== value) onCommit(o.key) }}>
            {o.color && <span style={{ width: 10, height: 10, borderRadius: 3, background: o.color, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
          </MenuItem>
        ))}
        {canCreate && (
          <MenuItem onClick={() => { setOpen(false); onCommit(q.trim()) }}><Ico d={ICONS.plus} size={12} />Usar “{q.trim()}”</MenuItem>
        )}
      </Popover>
    </>
  )
}

export function MultiOptionCell({ value, field, onCommit, readOnly }) {
  const { ref, open, setOpen } = useCellFrame()
  const selected = Array.isArray(value) ? value : []
  function toggle(id) {
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
    onCommit(next)
  }
  return (
    <>
      <button ref={ref} type="button" disabled={readOnly} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} style={cellBase({ gap: 4 })}>
        {selected.length === 0 ? <Placeholder>{''}</Placeholder> : selected.map(id => {
          const o = (field.options || []).find(x => x.id === id)
          if (!o) return null
          return <span key={id} style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, background: (o.color || C.accent) + '26', border: `1px solid ${(o.color || C.accent)}66`, color: C.text }}>{o.label}</span>
        })}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={220} label={field.label}>
        {(field.options || []).map(o => (
          <MenuItem key={o.id} active={selected.includes(o.id)} onClick={() => toggle(o.id)}>
            <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${o.color || C.accent}`, background: selected.includes(o.id) ? (o.color || C.accent) : 'transparent', display: 'grid', placeItems: 'center', color: '#fff' }}>
              {selected.includes(o.id) && <Ico d={ICONS.check} size={10} sw={3} />}
            </span>
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  )
}

export function CheckboxCell({ value, onCommit, readOnly, label }) {
  return (
    <ReadOnlyCell align="center">
      <button type="button" role="checkbox" aria-checked={Boolean(value)} aria-label={label} disabled={readOnly}
        onClick={() => onCommit(!value)}
        style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${value ? C.green : C.borderBright}`, background: value ? C.green : 'transparent', color: '#fff', display: 'grid', placeItems: 'center', cursor: readOnly ? 'default' : 'pointer' }}>
        {value && <Ico d={ICONS.check} size={13} sw={3} />}
      </button>
    </ReadOnlyCell>
  )
}

export function LinkCell({ value, onCommit, readOnly }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <InlineInput initial={value || ''} onCancel={() => setEditing(false)}
      onSave={v => { setEditing(false); if ((v || '') !== (value || '')) onCommit(v) }} />
  }
  return (
    <div style={cellBase({ cursor: 'default', gap: 6 })}>
      {value
        ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12.5 }}>{value.replace(/^https?:\/\//, '')}</a>
        : null}
      {!readOnly && (
        <button type="button" aria-label="Editar link" onClick={() => setEditing(true)}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2 }}>
          <Ico d={ICONS.link} size={13} />
        </button>
      )}
    </div>
  )
}

// Situação (aberta / ganho / perdido). Fechar como perdido pede o motivo (alimenta o Painel).
const LOSS_REASONS = ['Achou caro', 'Adiou a decisão', 'Foi em outra clínica', 'Sumiu / sem resposta', 'Fechou com concorrente', 'Outro']
export function OutcomeCell({ opp, onClose, readOnly }) {
  const { ref, open, setOpen } = useCellFrame()
  const [losing, setLosing] = useState(false)
  const meta = OUTCOMES[opp.status] || OUTCOMES.aberto
  const closed = opp.status !== 'aberto'
  return (
    <>
      <button ref={ref} type="button" disabled={readOnly || closed} aria-haspopup="dialog" aria-expanded={open}
        title={closed ? (opp.lost_reason ? `Motivo: ${opp.lost_reason}` : 'Oportunidade encerrada') : 'Encerrar como ganho ou perdido'}
        onClick={() => { setLosing(false); setOpen(o => !o) }}
        style={cellBase({ justifyContent: 'center', background: meta.color, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: readOnly || closed ? 'default' : 'pointer' })}>
        {opp.status === 'aberto' ? 'Aberta' : opp.status === 'ganho' ? 'Ganho' : opp.status === 'arquivado' ? 'Arquivada' : 'Perdido'}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={220} label="Encerrar oportunidade">
        {!losing ? <>
          <MenuItem onClick={() => { setOpen(false); onClose('ganho') }}><span style={{ color: OUTCOMES.ganho.color }}>✓</span>Marcar como ganho</MenuItem>
          <MenuItem onClick={() => setLosing(true)}><span style={{ color: OUTCOMES.perdido.color }}>✗</span>Marcar como perdido…</MenuItem>
          <div style={{ fontSize: 11, color: C.textDim, padding: '6px 9px 2px', lineHeight: 1.4 }}>Ganho não lança receita: o financeiro continua vindo da cirurgia/consulta registrada.</div>
        </> : <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub, padding: '4px 9px' }}>Motivo da perda</div>
          {LOSS_REASONS.map(r => <MenuItem key={r} onClick={() => { setOpen(false); onClose('perdido', r) }}>{r}</MenuItem>)}
        </>}
      </Popover>
    </>
  )
}

// `leading`: controles da linha antes do avatar (checkbox de seleção e seta dos subitens).
// `trailing`: ação extra à direita, visível no hover (menu "⋯").
export function PersonCell({ opp, onOpen, groupColor, overdue, stale, leading, trailing }) {
  const person = opportunityPerson(opp)
  const title = opp.title && opp.title !== 'Oportunidade' && opp.title !== person.name ? opp.title : null
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 8, paddingLeft: leading ? 2 : 6, paddingRight: 8, boxSizing: 'border-box', borderLeft: `5px solid ${groupColor}` }}>
      {leading}
      <Avatar label={person.name} size={24} />
      <button type="button" onClick={onOpen} data-testid="crm-open-opportunity"
        title={title ? `${person.name} · ${title}` : person.name}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.text, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</span>
        {title && <span style={{ fontSize: 11, color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>}
      </button>
      {overdue && <span title="Atrasada: tarefa ou prazo vencido" aria-label="Atrasada" style={{ color: C.red || '#ef4444', display: 'grid' }}><Ico d={ICONS.warn} size={14} /></span>}
      {!overdue && stale && <span title="Parada há 7 dias ou mais nesta etapa" aria-label="Parada" style={{ color: C.yellow || '#f59e0b', display: 'grid' }}><Ico d={ICONS.clock} size={14} /></span>}
      <button type="button" onClick={onOpen} aria-label={`Abrir ${person.name}`} tabIndex={-1}
        style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 6, padding: '2px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: hover ? 1 : 0, transition: 'opacity .12s', fontFamily: 'inherit' }}>
        <Ico d={ICONS.open} size={11} />Abrir
      </button>
      {trailing && trailing(hover)}
    </div>
  )
}

export { optionLabel }
