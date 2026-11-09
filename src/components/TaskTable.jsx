// Tabela de tarefas estilo Monday: grupos coloridos e recolhíveis, edição na célula, ordenação
// por coluna, colunas reordenáveis (arrastar o cabeçalho) e ocultáveis, seleção múltipla.
// Reaproveita as células do CRM (CrmCells) — mesmo comportamento de edição e teclado.
import { memo, useRef, useState } from 'react'
import { C } from '../theme.js'
import {
  Ico, ICONS, TextCell, StatusCell, MemberCell, DateCell, OptionListCell, ReadOnlyCell,
} from './CrmCells.jsx'
import { Chip, ChecklistBadge, WhatsAppLink, OutcomeButton, TaskActionsMenu } from './TaskBits.jsx'
import {
  PRIORITIES, PRIORITY_BY_KEY, CATEGORIES, isTaskDone, taskPersonName, taskOpportunityTitle, stageOf,
} from '../lib/taskWorkspace.js'

const ROW_H = 38
const PAGE = 60

export function TaskTable({ groups, columns, ws, today, sort, onSort, onReorderColumn, collapsed, onToggleCollapse, selected, onToggleSelect, onSetSelected, onOpen, actions, attemptFlash }) {
  const visible = columns.filter(c => !c.hidden)
  const totalWidth = 36 + visible.reduce((s, c) => s + c.width, 0)
  return (
    <div data-testid="task-table" style={{ overflowX: 'auto', paddingBottom: 12 }}>
      <div style={{ minWidth: totalWidth }}>
        {groups.map((g, i) => (
          <Group key={g.key} group={g} index={i} cols={visible} ws={ws} today={today} sort={sort} onSort={onSort} onReorderColumn={onReorderColumn}
            isCollapsed={Boolean(collapsed?.[g.key])} onToggleCollapse={onToggleCollapse}
            selected={selected} onToggleSelect={onToggleSelect} onSetSelected={onSetSelected} onOpen={onOpen} actions={actions} attemptFlash={attemptFlash} />
        ))}
      </div>
    </div>
  )
}

function Group({ group, index, cols, ws, today, sort, onSort, onReorderColumn, isCollapsed, onToggleCollapse, selected, onToggleSelect, onSetSelected, onOpen, actions, attemptFlash }) {
  const [limit, setLimit] = useState(PAGE)
  const n = group.rows.length
  const ids = group.rows.map(t => t.id)
  const nSel = ids.filter(id => selected.has(id)).length
  return (
    <section data-testid={`task-group-${group.key}`} aria-label={`Grupo ${group.label}`} style={{ marginTop: index === 0 ? 6 : 22 }}>
      <div style={{ position: 'sticky', left: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 6px 6px' }}>
        <button type="button" onClick={() => onToggleCollapse(group.key)} aria-expanded={!isCollapsed} aria-label={isCollapsed ? `Expandir ${group.label}` : `Recolher ${group.label}`}
          style={{ border: 'none', background: 'transparent', color: group.color, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2, transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>
          <Ico d={ICONS.chevron} size={17} sw={2.6} />
        </button>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: group.color, whiteSpace: 'nowrap' }}>{group.label}</h3>
        <span style={{ fontSize: 12, color: C.textSub }}>{n} {n === 1 ? 'tarefa' : 'tarefas'}</span>
      </div>
      {!isCollapsed && (
        <div role="table" aria-label={group.label} style={{ borderLeft: `4px solid ${group.color}`, borderRadius: 6 }}>
          <div role="row" style={{ display: 'flex', height: 34, background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 36, flex: '0 0 36px', display: 'grid', placeItems: 'center', position: 'sticky', left: 0, zIndex: 3, background: C.surface }}>
              <input type="checkbox" aria-label={`Selecionar todas de ${group.label}`} checked={n > 0 && nSel === n}
                ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < n }}
                onChange={e => onSetSelected(ids, e.target.checked)} style={{ accentColor: C.accent, cursor: 'pointer' }} />
            </div>
            {cols.map(c => <HeaderCell key={c.id} col={c} sort={sort} onSort={onSort} onReorderColumn={onReorderColumn} />)}
          </div>
          {group.rows.slice(0, limit).map(t => (
            <Row key={t.id} task={t} cols={cols} ws={ws} today={today} color={group.color} selected={selected.has(t.id)}
              onToggleSelect={onToggleSelect} onOpen={onOpen} actions={actions} flash={attemptFlash?.id === t.id} />
          ))}
          {n > limit && (
            <div style={{ position: 'sticky', left: 0, padding: '8px 10px' }}>
              <button type="button" onClick={() => setLimit(l => l + PAGE)}
                style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Mostrar mais {Math.min(PAGE, n - limit)} de {n - limit}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function HeaderCell({ col, sort, onSort, onReorderColumn }) {
  const [over, setOver] = useState(false)
  const active = sort?.col === col.id
  const sortable = col.sortable !== false && !col.trailing
  const movable = !col.fixed && !col.trailing
  return (
    <div role="columnheader" aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      draggable={movable} data-testid={`task-col-${col.id}`}
      onDragStart={e => { e.dataTransfer.setData('application/x-task-col', col.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (movable && e.dataTransfer.types.includes('application/x-task-col')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { const from = e.dataTransfer.getData('application/x-task-col'); setOver(false); if (from && from !== col.id) onReorderColumn(from, col.id) }}
      style={{
        width: col.width, flex: `0 0 ${col.width}px`, display: 'flex', alignItems: 'center', justifyContent: col.fixed ? 'flex-start' : 'center', gap: 4,
        padding: '0 8px', boxSizing: 'border-box', fontSize: 12, fontWeight: 700, color: active ? C.text : C.textSub,
        borderLeft: col.fixed ? 'none' : `1px solid ${C.border}`, cursor: movable ? 'grab' : 'default',
        background: over ? C.accent + '1a' : C.surface, ...(col.fixed ? { position: 'sticky', left: 36, zIndex: 2 } : {}),
      }}>
      {sortable
        ? <button type="button" onClick={() => onSort(col.id)} title="Ordenar"
            style={{ border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}>
            {col.label}{active && <Ico d={sort.dir === 'desc' ? ICONS.arrowDown : ICONS.arrowUp} size={12} sw={2.6} />}
          </button>
        : col.label}
    </div>
  )
}

const Row = memo(function Row({ task, cols, ws, today, color, selected, onToggleSelect, onOpen, actions, flash }) {
  const [hover, setHover] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  const stage = stageOf(task, ws.stageIndex)
  const done = isTaskDone(task)

  function cell(col) {
    switch (col.id) {
      case 'title': {
        const person = taskPersonName(task)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', paddingLeft: 6 }}>
            <button type="button" aria-label={done ? 'Reabrir' : 'Concluir'} onClick={() => actions.toggle(task)}
              style={{ width: 16, height: 16, borderRadius: '50%', border: `1.8px solid ${done ? (C.green || '#00c875') : (C.borderBright || C.border)}`, background: done ? (C.green || '#00c875') : 'transparent', color: '#fff', flexShrink: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
              {done && <Ico d={ICONS.check} size={9} sw={3.5} />}
            </button>
            <div style={{ flex: 1, minWidth: 0, height: '100%', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.7 : 1 }}>
              <TextCell value={task.title} testId="task-cell-title" onCommit={v => actions.patch(task, { title: v })} />
            </div>
            {!person && !task.opportunity_id && <Chip>avulsa</Chip>}
            {flash && <Chip color={C.yellow || '#F59E0B'}>tentativa registrada · segue pendente</Chip>}
            <button type="button" aria-label="Abrir detalhes" title="Abrir detalhes" data-testid="task-row-open" onClick={() => onOpen(task)}
              style={{ border: `1px solid ${C.border}`, background: hover ? C.surface : 'transparent', color: C.textSub, borderRadius: 6, padding: '2px 6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', opacity: hover ? 1 : 0.55 }}>
              <Ico d={ICONS.open} size={11} />Abrir
            </button>
          </div>
        )
      }
      case 'status':
        return <StatusCell testId="task-cell-status" label={stage?.label} color={stage?.color} value={stage?.id} popLabel="Status da tarefa"
          options={ws.stages.map(s => ({ key: s.id, label: s.label, color: s.color }))} onPick={id => actions.setStage(task, id)} />
      case 'responsible':
        return <MemberCell testId="task-cell-responsible" value={task.assigned_user_id} members={ws.members} memberLabel={ws.memberLabel}
          onCommit={v => actions.patch(task, { assigned_user_id: v })} />
      case 'priority': {
        const p = PRIORITY_BY_KEY[task.priority]
        return <StatusCell testId="task-cell-priority" label={p?.label} color={p?.color} value={task.priority || null} allowClear popLabel="Prioridade"
          readOnly={!ws.ready} options={PRIORITIES.map(x => ({ key: x.key, label: x.label, color: x.color }))} onPick={v => actions.patch(task, { priority: v })} />
      }
      case 'patient': {
        const person = taskPersonName(task)
        const opp = taskOpportunityTitle(task)
        return (
          <ReadOnlyCell title={[person, opp].filter(Boolean).join(' · ') || undefined}>
            {person ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{person}</span> : null}
            {opp ? <Chip color={C.purple || '#a25ddc'}>{opp}</Chip> : null}
            {!person && !opp ? <span style={{ color: C.textDim }}>—</span> : null}
          </ReadOnlyCell>
        )
      }
      case 'category':
        return <OptionListCell testId="task-cell-category" value={task.task_type || 'outro'} popLabel="Categoria" clearLabel="Outro"
          options={CATEGORIES.filter(c => c.key !== 'outro')} onCommit={v => actions.patch(task, { task_type: v || 'outro' })} />
      case 'due':
        return (
          <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, height: '100%' }}>
              <DateCell testId="task-cell-due" value={task.due_date ? String(task.due_date).slice(0, 10) : null} overdueBefore={done ? null : today}
                onCommit={v => actions.patch(task, { due_date: v })} />
            </div>
            {task.due_time && <span style={{ fontSize: 11.5, color: C.textSub, paddingRight: 6, fontVariantNumeric: 'tabular-nums' }}>{String(task.due_time).slice(0, 5)}</span>}
          </div>
        )
      case 'subtasks':
        return <ReadOnlyCell align="center">{ws.checklist[task.id] ? <ChecklistBadge progress={ws.checklist[task.id]} /> : <span style={{ color: C.textDim }}>—</span>}</ReadOnlyCell>
      case 'actions':
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, width: '100%', padding: '0 6px' }}>
            <WhatsAppLink task={task} size={24} />
            <OutcomeButton task={task} onOutcome={actions.outcome} compact />
            <button ref={menuRef} type="button" aria-label="Ações da tarefa" data-testid="task-row-menu" onClick={() => setMenu(m => !m)}
              style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 3 }}>
              <Ico d={ICONS.dots} size={15} />
            </button>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div role="row" data-testid="task-row" data-task-id={task.id}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onContextMenu={e => { if (e.target.closest('input, textarea')) return; e.preventDefault(); setMenu(true) }}
      style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${C.border}`, background: selected ? C.accent + '14' : hover ? (C.cardHover || C.card) : C.card }}>
      <div style={{ width: 36, flex: '0 0 36px', display: 'grid', placeItems: 'center', position: 'sticky', left: 0, zIndex: 2, background: 'inherit' }}>
        <input type="checkbox" aria-label={`Selecionar ${task.title}`} checked={selected} data-testid="task-row-select"
          onChange={e => onToggleSelect(task.id, e.nativeEvent?.shiftKey)} style={{ accentColor: color, cursor: 'pointer' }} />
      </div>
      {cols.map(col => (
        <div key={col.id} role="cell"
          style={{ width: col.width, flex: `0 0 ${col.width}px`, height: '100%', display: 'flex', alignItems: 'center', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden',
            borderLeft: col.fixed ? 'none' : `1px solid ${C.border}`, ...(col.fixed ? { position: 'sticky', left: 36, zIndex: 1, background: 'inherit' } : {}) }}>
          {cell(col)}
        </div>
      ))}
      <TaskActionsMenu task={task} stages={ws.stages} currentStageId={stage?.id} anchorRef={menuRef} open={menu} onClose={() => setMenu(false)} actions={actions} />
    </div>
  )
})
