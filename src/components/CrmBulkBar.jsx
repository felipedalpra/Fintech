// Barra flutuante de ações em massa do CRM (estilo Monday): aparece quando há oportunidades
// selecionadas na Tabela. Cada ação grava pelo mesmo caminho da edição individual (etapa pela RPC
// auditada, campos pela validação do patchOpportunity) e pede confirmação quando afeta 2+ registros.
import { useRef, useState } from 'react'
import { C } from '../theme.js'
import { Popover, MenuItem, Ico, ICONS, Avatar } from './CrmCells.jsx'

export function CrmBulkBar({ selected, stages, members, memberLabel, tagSuggestions, onClear, actions }) {
  const [open, setOpen] = useState(null)        // 'stage' | 'member' | 'due' | 'tags' | 'archive' | null
  const [pending, setPending] = useState(null)  // { label, run } aguardando confirmação
  const [busy, setBusy] = useState(null)        // texto de progresso
  const refs = { stage: useRef(null), member: useRef(null), due: useRef(null), tags: useRef(null), archive: useRef(null) }
  const ids = selected.map(o => o.id)
  const n = ids.length
  const archivedCount = selected.filter(o => o.status === 'arquivado').length
  const allArchived = n > 0 && archivedCount === n
  const plural = n === 1 ? 'oportunidade' : 'oportunidades'

  function close() { setOpen(null); setPending(null) }
  function toggle(k) { setPending(null); setOpen(o => (o === k ? null : k)) }

  async function execute(run) {
    setBusy('Aplicando…')
    try { await run(text => setBusy(text)) } finally { setBusy(null); close() }
  }
  // 2+ registros: confirma antes. 1 registro: aplica direto (igual à edição na célula).
  function confirmOrRun(label, run) {
    if (n >= 2) setPending({ label, run })
    else execute(run)
  }

  const confirmPanel = pending && (
    <div style={{ padding: 4 }}>
      <div style={{ fontSize: 12.5, color: C.text, padding: '4px 6px 10px', lineHeight: 1.45 }}>{pending.label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => setPending(null)} style={btn(false)}>Voltar</button>
        <button type="button" data-testid="crm-bulk-confirm" autoFocus onClick={() => execute(pending.run)} style={btn(true)}>Confirmar</button>
      </div>
    </div>
  )

  return (
    <div role="toolbar" aria-label={`${n} ${plural} selecionadas`} data-testid="crm-bulk-bar"
      style={{
        position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 1100,
        display: 'flex', alignItems: 'stretch', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
        background: C.card, border: `1px solid ${C.borderBright}`, borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 18px 48px -12px rgba(0,0,0,.45)', animation: 'crmBulkIn .16s ease-out',
      }}>
      <style>{'@keyframes crmBulkIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: C.accent, color: '#fff', flexShrink: 0 }}>
        <span data-testid="crm-bulk-count" style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>
        {busy || (n === 1 ? 'selecionada' : 'selecionadas')}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', borderLeft: `1px solid ${C.border}` }}>
        {!allArchived && <>
          <BarButton btnRef={refs.stage} icon={ICONS.chevronRight} label="Etapa" active={open === 'stage'} disabled={!!busy} onClick={() => toggle('stage')} testId="crm-bulk-stage" />
          <BarButton btnRef={refs.member} icon={ICONS.user} label="Responsável" active={open === 'member'} disabled={!!busy} onClick={() => toggle('member')} testId="crm-bulk-responsible" />
          <BarButton btnRef={refs.due} icon={ICONS.calendar} label="Prazo" active={open === 'due'} disabled={!!busy} onClick={() => toggle('due')} testId="crm-bulk-due" />
          <BarButton btnRef={refs.tags} icon={ICONS.tag} label="Tags" active={open === 'tags'} disabled={!!busy} onClick={() => toggle('tags')} testId="crm-bulk-tags" />
        </>}
        {allArchived
          ? <BarButton btnRef={refs.archive} icon={ICONS.restore} label="Restaurar" disabled={!!busy} onClick={() => toggle('archive')} testId="crm-bulk-restore" />
          : <BarButton btnRef={refs.archive} icon={ICONS.archive} label="Arquivar" danger disabled={!!busy} onClick={() => toggle('archive')} testId="crm-bulk-archive" />}
      </div>
      <button type="button" onClick={onClear} aria-label="Limpar seleção" title="Limpar seleção (Esc)" data-testid="crm-bulk-clear"
        style={{ border: 'none', borderLeft: `1px solid ${C.border}`, background: 'transparent', color: C.textSub, cursor: 'pointer', padding: '0 14px', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Ico d={ICONS.x} size={16} />
      </button>

      <Popover anchorRef={refs.stage} open={open === 'stage'} onClose={close} width={240} label="Mover para etapa" testId="crm-bulk-stage-menu">
        {confirmPanel || stages.map(s => (
          <MenuItem key={s.key} onClick={() => confirmOrRun(`Mover ${n} ${plural} para "${s.label}"? Cada movimento fica registrado no histórico do funil.`,
            report => actions.moveStage(ids, s.key, (done, total) => report(`Movendo ${done}/${total}…`)))}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />{s.label}
          </MenuItem>
        ))}
      </Popover>

      <Popover anchorRef={refs.member} open={open === 'member'} onClose={close} width={250} label="Atribuir responsável" testId="crm-bulk-responsible-menu">
        {confirmPanel || <>
          <MenuItem onClick={() => confirmOrRun(`Remover o responsável de ${n} ${plural}?`, () => actions.setResponsible(ids, null))}>Sem responsável</MenuItem>
          {(members || []).map(m => {
            const label = memberLabel?.[m.user_id] || m.member_email || 'Usuário'
            return (
              <MenuItem key={m.user_id} onClick={() => confirmOrRun(`Atribuir ${n} ${plural} a ${label}?`, () => actions.setResponsible(ids, m.user_id))}>
                <Avatar label={label} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              </MenuItem>
            )
          })}
        </>}
      </Popover>

      <Popover anchorRef={refs.due} open={open === 'due'} onClose={close} width={250} label="Definir prazo" testId="crm-bulk-due-menu">
        {confirmPanel || <DuePicker onPick={date => confirmOrRun(
          date ? `Definir o prazo da próxima ação de ${n} ${plural} para ${fmt(date)}?` : `Remover o prazo de ${n} ${plural}?`,
          () => actions.setDue(ids, date))} />}
      </Popover>

      <Popover anchorRef={refs.tags} open={open === 'tags'} onClose={close} width={280} label="Adicionar tags" testId="crm-bulk-tags-menu">
        <TagsPicker suggestions={tagSuggestions} onApply={tags => execute(() => actions.addTags(ids, tags))} count={n} />
      </Popover>

      <Popover anchorRef={refs.archive} open={open === 'archive'} onClose={close} width={280} label={allArchived ? 'Restaurar' : 'Arquivar'} testId="crm-bulk-archive-menu">
        <div style={{ padding: 4 }}>
          <div style={{ fontSize: 12.5, color: C.text, padding: '4px 6px 10px', lineHeight: 1.45 }}>
            {allArchived
              ? `Restaurar ${n} ${plural}? Cada uma volta para a situação que tinha antes de ser arquivada.`
              : `Arquivar ${n - archivedCount} ${n - archivedCount === 1 ? 'oportunidade' : 'oportunidades'}? Elas saem da Tabela, do Kanban, do Painel e dos alertas. Nada é apagado — dá para restaurar em Filtro → Situação → Arquivadas.`}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={close} style={btn(false)}>Cancelar</button>
            <button type="button" data-testid="crm-bulk-archive-confirm" autoFocus
              onClick={() => execute(() => (allArchived ? actions.restore(ids) : actions.archive(ids)))}
              style={btn(true, !allArchived)}>{allArchived ? 'Restaurar' : 'Arquivar'}</button>
          </div>
        </div>
      </Popover>
    </div>
  )
}

function BarButton({ btnRef, icon, label, onClick, active, danger, disabled, testId }) {
  const [hover, setHover] = useState(false)
  return (
    <button ref={btnRef} type="button" onClick={onClick} disabled={disabled} data-testid={testId} aria-expanded={active}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        border: 'none', background: active || hover ? C.cardHover : 'transparent', color: danger ? (C.red || '#ef4444') : C.text,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, padding: '8px 12px', minWidth: 64,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit',
        fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', transition: 'background .12s',
      }}>
      <Ico d={icon} size={16} />{label}
    </button>
  )
}

function DuePicker({ onPick }) {
  const [date, setDate] = useState('')
  return (
    <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub }}>Prazo da próxima ação
        <input type="date" autoFocus value={date} onChange={e => setDate(e.target.value)} data-testid="crm-bulk-due-input"
          onKeyDown={e => { if (e.key === 'Enter' && date) onPick(date) }}
          style={{ display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', fontSize: 13, colorScheme: 'inherit' }} />
      </label>
      <button type="button" disabled={!date} onClick={() => onPick(date)} data-testid="crm-bulk-due-apply" style={btn(true, false, !date)}>Aplicar prazo</button>
      <MenuItem onClick={() => onPick(null)}>Remover prazo</MenuItem>
    </div>
  )
}

function TagsPicker({ suggestions, onApply, count }) {
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState([])
  function add(t) {
    const v = String(t || '').trim().slice(0, 40)
    if (v && !tags.includes(v)) setTags(list => [...list, v])
    setDraft('')
  }
  const pending = draft.trim() ? [...tags, draft.trim()] : tags
  const shown = (suggestions || []).filter(s => !tags.includes(s)).slice(0, 8)
  return (
    <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.4 }}>As tags são acrescentadas; as que cada oportunidade já tem continuam.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {tags.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: C.accent + '22', color: C.accent }}>
            {t}
            <button type="button" aria-label={`Remover ${t}`} onClick={() => setTags(list => list.filter(x => x !== t))}
              style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, display: 'grid' }}><Ico d={ICONS.x} size={11} /></button>
          </span>
        ))}
      </div>
      <input autoFocus value={draft} placeholder="Digite e Enter" data-testid="crm-bulk-tags-input"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
          if (e.key === 'Backspace' && !draft && tags.length) setTags(list => list.slice(0, -1))
        }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
      {shown.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {shown.map(s => (
            <button key={s} type="button" onClick={() => add(s)}
              style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 12, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>+ {s}</button>
          ))}
        </div>
      )}
      <button type="button" disabled={!pending.length} data-testid="crm-bulk-tags-apply" onClick={() => onApply(pending)} style={btn(true, false, !pending.length)}>
        Adicionar a {count} {count === 1 ? 'oportunidade' : 'oportunidades'}
      </button>
    </div>
  )
}

function btn(primary, danger = false, disabled = false) {
  const color = danger ? (C.red || '#ef4444') : C.accent
  return {
    flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : `1px solid ${C.border}`, background: primary ? color : 'transparent', color: primary ? '#fff' : C.text,
  }
}

function fmt(iso) {
  const [y, m, d] = String(iso).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}
