// Menu de ações da linha do CRM: botão direito na oportunidade ou "⋯" da linha (estilo Monday).
// Uma instância só para a tabela inteira (não uma por linha). Ações destrutivas ou que criam
// registro pedem confirmação no próprio menu, sem modal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { opportunityPerson } from '../lib/crmContact.js'
import { Popover, MenuItem, Ico, ICONS, Avatar } from './CrmCells.jsx'

// Âncora "virtual" para abrir o Popover no ponto do clique.
function pointAnchor(x, y) {
  return { current: { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }), contains: () => false, focus() {} } }
}

export function CrmRowMenu({ menu, onClose, stages, members, memberLabel, actions }) {
  const [view, setView] = useState('main')
  const [busy, setBusy] = useState(false)
  const panelRef = useRef(null)
  const opp = menu?.opp
  const anchorRef = useMemo(() => (menu ? pointAnchor(menu.x, menu.y) : { current: null }), [menu])

  useEffect(() => { setView('main'); setBusy(false) }, [menu])
  // Foco no primeiro item ao abrir/trocar de painel (teclado e leitor de tela).
  useEffect(() => {
    if (!menu) return
    const id = requestAnimationFrame(() => panelRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus())
    return () => cancelAnimationFrame(id)
  }, [menu, view])

  if (!opp) return null
  const archived = opp.status === 'arquivado'
  const person = opportunityPerson(opp)

  function onKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(panelRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  async function run(fn) {
    if (busy) return
    setBusy(true)
    await fn()
    setBusy(false)
    onClose()
  }

  const back = <MenuItem onClick={() => setView('main')}><span style={{ transform: 'rotate(90deg)', display: 'grid' }}><Ico d={ICONS.chevron} size={13} /></span>Voltar</MenuItem>
  const title = (
    <div style={{ padding: '4px 9px 6px', fontSize: 11.5, fontWeight: 700, color: C.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {person.name}
    </div>
  )

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} width={250} label="Ações da oportunidade" testId="crm-row-menu">
      <div ref={panelRef} role="menu" aria-label={`Ações de ${person.name}`} onKeyDown={onKeyDown}>
        {title}
        {view === 'main' && <>
          <MenuItem testId="crm-menu-open" onClick={() => { onClose(); actions.open(opp) }}><Ico d={ICONS.open} size={13} />Abrir detalhes</MenuItem>
          {!archived && <>
            <MenuItem testId="crm-menu-duplicate" onClick={() => setView('duplicate')}><Ico d={ICONS.copy} size={13} />Duplicar oportunidade</MenuItem>
            <MenuItem testId="crm-menu-stage" onClick={() => setView('stage')}><Ico d={ICONS.chevronRight} size={13} />Mover para outra etapa</MenuItem>
            <MenuItem testId="crm-menu-responsible" onClick={() => setView('member')}><Ico d={ICONS.user} size={13} />Alterar responsável</MenuItem>
            <MenuItem testId="crm-menu-task" onClick={() => { onClose(); actions.createTask(opp) }}><Ico d={ICONS.check} size={13} />Criar tarefa</MenuItem>
            <div style={{ height: 1, background: C.border, margin: '4px 2px' }} />
            <MenuItem testId="crm-menu-archive" danger onClick={() => setView('archive')}><Ico d={ICONS.archive} size={13} />Arquivar</MenuItem>
          </>}
          {archived && (
            <MenuItem testId="crm-menu-restore" disabled={busy} onClick={() => run(() => actions.restore(opp))}><Ico d={ICONS.restore} size={13} />Restaurar</MenuItem>
          )}
        </>}

        {view === 'stage' && <>
          {back}
          {stages.map(s => (
            <MenuItem key={s.key} active={s.key === opp.stage} disabled={busy}
              onClick={() => (s.key === opp.stage ? onClose() : run(() => actions.moveStage(opp, s.key)))}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />{s.label}
            </MenuItem>
          ))}
        </>}

        {view === 'member' && <>
          {back}
          <MenuItem active={!opp.responsible_user_id} disabled={busy}
            onClick={() => (!opp.responsible_user_id ? onClose() : run(() => actions.setResponsible(opp, null)))}>Sem responsável</MenuItem>
          {(members || []).map(m => {
            const label = memberLabel?.[m.user_id] || m.member_email || 'Usuário'
            return (
              <MenuItem key={m.user_id} active={m.user_id === opp.responsible_user_id} disabled={busy}
                onClick={() => (m.user_id === opp.responsible_user_id ? onClose() : run(() => actions.setResponsible(opp, m.user_id)))}>
                <Avatar label={label} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              </MenuItem>
            )
          })}
        </>}

        {view === 'duplicate' && <>
          <Note>
            Cria uma nova oportunidade aberta, na mesma etapa, para <strong>{person.name}</strong>. O cadastro do paciente é o mesmo;
            mensagens, pagamentos, atendimentos, tarefas e histórico <strong>não</strong> são copiados.
            {opp.patient_id && <> Enquanto o paciente tiver duas oportunidades abertas, a automação do funil não move nenhuma delas.</>}
          </Note>
          <MenuItem testId="crm-menu-duplicate-confirm" disabled={busy} onClick={() => run(() => actions.duplicate(opp))}><Ico d={ICONS.copy} size={13} />{busy ? 'Duplicando…' : 'Confirmar duplicação'}</MenuItem>
          {back}
        </>}

        {view === 'archive' && <>
          <Note>A oportunidade sai da Tabela, do Kanban, dos Indicadores e dos alertas. Nada é apagado: dá para ver e restaurar em Filtro → Situação → Arquivadas.</Note>
          <MenuItem testId="crm-menu-archive-confirm" danger disabled={busy} onClick={() => run(() => actions.archive(opp))}><Ico d={ICONS.archive} size={13} />{busy ? 'Arquivando…' : 'Confirmar arquivamento'}</MenuItem>
          {back}
        </>}
      </div>
    </Popover>
  )
}

function Note({ children }) {
  return <div style={{ fontSize: 11.5, color: C.textSub, padding: '2px 9px 8px', lineHeight: 1.45 }}>{children}</div>
}
