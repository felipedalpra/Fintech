// Kanban de tarefas estilo Monday: colunas configuráveis (task_stages), cards compactos,
// arrastar entre colunas (muda o status pela coluna) e dentro da coluna (ordem manual).
import { memo, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { Ico, ICONS, Popover, MenuItem, Avatar } from './CrmCells.jsx'
import {
  DuePill, PriorityPill, Chip, ChecklistBadge, WhatsAppLink, OutcomeButton, TaskActionsMenu, textOnColor,
} from './TaskBits.jsx'
import {
  kanbanColumns, reorderIds, isTaskDone, isTaskOverdue, categoryLabel, taskPersonName, taskOpportunityTitle,
  STAGE_COLORS, BASE_STATUSES,
} from '../lib/taskWorkspace.js'

const COLUMN_PAGE = 40

export function TaskKanban({ tasks, ws, today, canManage, actions, onOpen, attemptFlash, toast }) {
  const cols = useMemo(() => kanbanColumns(tasks, ws.stages, ws.stageIndex), [tasks, ws.stages, ws.stageIndex])
  const [drag, setDrag] = useState(null) // { id, from }
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef(null)

  async function drop(stageId, beforeId) {
    const id = drag?.id
    setDrag(null)
    if (!id) return
    const col = cols.find(c => c.stage.id === stageId)
    const ordered = reorderIds(col.tasks.map(t => t.id), id, beforeId)
    const res = await ws.moveOnBoard(id, stageId, ordered)
    if (res.error) toast(res.error, 'error')
  }

  function moveStage(stageId, delta) {
    const real = ws.stages.filter(s => !s.virtual).map(s => s.id)
    const i = real.indexOf(stageId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= real.length) return
    ;[real[i], real[j]] = [real[j], real[i]]
    ws.reorderStages(real).then(res => { if (res?.error) toast(res.error, 'error') })
  }

  return (
    <div data-testid="task-kanban" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 12, minHeight: 280 }}>
      {cols.map((col, i) => (
        <Column key={col.stage.id} col={col} index={i} total={cols.length} today={today} ws={ws} drag={drag} setDrag={setDrag}
          onDrop={drop} onOpen={onOpen} actions={actions} canManage={canManage && ws.ready} onMoveStage={moveStage}
          attemptFlash={attemptFlash} toast={toast} />
      ))}
      {canManage && ws.ready && (
        <div style={{ flex: '0 0 auto' }}>
          <button ref={newRef} type="button" data-testid="task-stage-new" onClick={() => setNewOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10, border: `1px dashed ${C.borderBright || C.border}`, background: 'transparent', color: C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            <Ico d={ICONS.plus} size={13} />Nova coluna
          </button>
          <Popover anchorRef={newRef} open={newOpen} onClose={() => setNewOpen(false)} width={270} label="Nova coluna">
            <StageForm submitLabel="Criar coluna" askBase onCancel={() => setNewOpen(false)}
              onSubmit={async draft => {
                const res = await ws.addStage(draft)
                if (res.error) return res
                setNewOpen(false)
                toast('Coluna criada.', 'success')
                return res
              }} />
          </Popover>
        </div>
      )}
    </div>
  )
}

function Column({ col, index, total, today, ws, drag, setDrag, onDrop, onOpen, actions, canManage, onMoveStage, attemptFlash, toast }) {
  const { stage } = col
  const [over, setOver] = useState(false)
  const [limit, setLimit] = useState(COLUMN_PAGE)
  const [menu, setMenu] = useState(null) // null | 'menu' | 'edit'
  const [confirmArchive, setConfirmArchive] = useState(false)
  const menuRef = useRef(null)
  const shown = col.tasks.slice(0, limit)
  const fg = textOnColor(stage.color)

  return (
    <section data-testid={`task-column-${stage.seed_key || stage.base_status}`} data-stage-id={stage.id} aria-label={`Coluna ${stage.label}`}
      onDragOver={e => { if (drag) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop(stage.id, null) }}
      style={{ flex: '0 0 272px', width: 272, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 230px)', minHeight: 200, borderRadius: 10, background: over ? stage.color + '14' : C.surface, border: `1px solid ${over ? stage.color : C.border}`, transition: 'background .12s, border-color .12s' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px 7px 10px', borderRadius: '9px 9px 0 0', background: stage.color, color: fg }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage.label}</span>
        <span data-testid="task-column-count" style={{ fontSize: 11, fontWeight: 800, background: 'rgba(0,0,0,.18)', borderRadius: 10, padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }}>{col.tasks.length}</span>
        {canManage && (
          <button ref={menuRef} type="button" aria-label={`Opções da coluna ${stage.label}`} onClick={() => { setConfirmArchive(false); setMenu(m => (m ? null : 'menu')) }}
            style={{ border: 'none', background: 'transparent', color: fg, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2, borderRadius: 5 }}>
            <Ico d={ICONS.dots} size={15} />
          </button>
        )}
        <Popover anchorRef={menuRef} open={menu === 'menu'} onClose={() => setMenu(null)} width={230} label={`Opções da coluna ${stage.label}`}>
          <MenuItem onClick={() => setMenu('edit')}><Ico d={ICONS.settings} size={13} />Renomear e cor</MenuItem>
          <MenuItem disabled={index === 0} onClick={() => { setMenu(null); onMoveStage(stage.id, -1) }}><Ico d={ICONS.arrowUp} size={13} />Mover para a esquerda</MenuItem>
          <MenuItem disabled={index === total - 1} onClick={() => { setMenu(null); onMoveStage(stage.id, 1) }}><Ico d={ICONS.arrowDown} size={13} />Mover para a direita</MenuItem>
          {!stage.is_default && (!confirmArchive
            ? <MenuItem danger onClick={() => setConfirmArchive(true)}><Ico d={ICONS.archive} size={13} />Remover coluna</MenuItem>
            : <MenuItem danger onClick={async () => { setMenu(null); const res = await ws.removeStage(stage.id); toast(res.error || 'Coluna removida. As tarefas dela voltaram para a coluna padrão do status.', res.error ? 'error' : 'success', 4500) }}>Confirmar remoção</MenuItem>)}
          <div style={{ fontSize: 11, color: C.textDim, padding: '4px 9px', lineHeight: 1.4 }}>
            Status das tarefas aqui: <strong>{BASE_STATUSES.find(b => b.key === stage.base_status)?.label}</strong>.
            {stage.is_default && ' Coluna padrão deste status (não pode ser removida).'}
          </div>
        </Popover>
        <Popover anchorRef={menuRef} open={menu === 'edit'} onClose={() => setMenu(null)} width={270} label={`Editar coluna ${stage.label}`}>
          <StageForm initial={stage} submitLabel="Salvar" onCancel={() => setMenu(null)}
            onSubmit={async draft => {
              const res = await ws.editStage(stage.id, { label: draft.label, color: draft.color })
              if (res.error) return res
              setMenu(null)
              return res
            }} />
        </Popover>
      </header>
      <div style={{ padding: 6, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {shown.map(t => (
          <TaskCard key={t.id} task={t} today={today} ws={ws} stageId={stage.id} dragging={drag?.id === t.id}
            onDragStart={() => setDrag({ id: t.id })} onDragEnd={() => { setDrag(null); setOver(false) }}
            onDropBefore={() => { setOver(false); onDrop(stage.id, t.id) }} canDrop={Boolean(drag) && drag.id !== t.id}
            onOpen={onOpen} actions={actions} flash={attemptFlash?.id === t.id} />
        ))}
        {col.tasks.length > limit && (
          <button type="button" onClick={() => setLimit(l => l + COLUMN_PAGE)}
            style={{ border: `1px solid ${C.border}`, background: C.card, color: C.textSub, borderRadius: 8, padding: '6px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Mostrar mais {Math.min(COLUMN_PAGE, col.tasks.length - limit)}
          </button>
        )}
        {col.tasks.length === 0 && (
          <div style={{ textAlign: 'center', color: C.textDim, fontSize: 11.5, padding: '18px 0', border: `1.5px dashed ${C.border}`, borderRadius: 8 }}>
            {drag ? 'Soltar aqui' : 'Sem tarefas'}
          </div>
        )}
      </div>
    </section>
  )
}

const TaskCard = memo(function TaskCard({ task, today, ws, stageId, dragging, onDragStart, onDragEnd, onDropBefore, canDrop, onOpen, actions, flash }) {
  const [hover, setHover] = useState(false)
  const [dropHint, setDropHint] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  const done = isTaskDone(task)
  const overdue = isTaskOverdue(task, today)
  const person = taskPersonName(task)
  const opp = taskOpportunityTitle(task)
  const who = task.assigned_user_id ? (ws.memberLabel[task.assigned_user_id] || 'Pessoa removida') : null
  const avulsa = !person && !task.opportunity_id
  const progress = ws.checklist[task.id]

  return (
    <article data-testid="task-card" data-task-id={task.id} draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', task.id) } catch { /* ignore */ } onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={e => { if (canDrop) { e.preventDefault(); e.stopPropagation(); setDropHint(true) } }}
      onDragLeave={() => setDropHint(false)}
      onDrop={e => { if (canDrop) { e.preventDefault(); e.stopPropagation(); setDropHint(false); onDropBefore() } }}
      onClick={() => onOpen(task)}
      onContextMenu={e => { e.preventDefault(); setMenu(true) }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', padding: '8px 9px 7px', borderRadius: 8, cursor: 'pointer',
        background: hover ? (C.cardHover || C.card) : C.card, border: `1px solid ${overdue ? (C.red || '#e2445c') + '77' : hover ? (C.borderBright || C.border) : C.border}`,
        boxShadow: dropHint ? `0 -3px 0 0 ${C.accent}` : hover ? '0 8px 20px -12px rgba(0,0,0,.55)' : 'none',
        opacity: dragging ? 0.4 : done ? 0.72 : 1, transition: 'box-shadow .12s, background .12s, opacity .12s',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <button type="button" aria-label={done ? 'Reabrir' : 'Concluir'} onClick={e => { e.stopPropagation(); actions.toggle(task) }}
          style={{ width: 16, height: 16, marginTop: 1, borderRadius: '50%', border: `1.8px solid ${done ? (C.green || '#00c875') : (C.borderBright || C.border)}`, background: done ? (C.green || '#00c875') : 'transparent', color: '#fff', flexShrink: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
          {done && <Ico d={ICONS.check} size={9} sw={3.5} />}
        </button>
        <div title={task.title} style={{ flex: 1, minWidth: 0, fontSize: 12.8, fontWeight: 650, lineHeight: 1.3, color: done ? C.textSub : C.text, textDecoration: done ? 'line-through' : 'none', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
          {task.title}
        </div>
        <button ref={menuRef} type="button" aria-label="Ações da tarefa" data-testid="task-card-menu" onClick={e => { e.stopPropagation(); setMenu(m => !m) }}
          style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', opacity: hover || menu ? 1 : 0, transition: 'opacity .12s' }}>
          <Ico d={ICONS.dots} size={15} />
        </button>
      </div>
      {/* Uma linha só (reticências): paciente · oportunidade e categoria — card baixo e denso. */}
      <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 4, marginTop: 5, paddingLeft: 23, minWidth: 0, overflow: 'hidden' }}>
        {(person || opp) && (
          <span title={[person, opp].filter(Boolean).join(' · ')} data-testid="task-card-patient"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '0 1 auto', fontSize: 11, fontWeight: 650, color: C.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Ico d={ICONS.user} size={10} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{person}{person && opp ? ' · ' : ''}{opp && <span style={{ color: C.purple || '#a25ddc' }}>{opp}</span>}</span>
          </span>
        )}
        {avulsa && <Chip>avulsa</Chip>}
        {task.task_type && task.task_type !== 'outro' && <span style={{ flexShrink: 0 }}><Chip color={C.accent} title="Categoria">{categoryLabel(task.task_type)}</Chip></span>}
      </div>
      {flash && <div style={{ paddingLeft: 23, marginTop: 4 }}><Chip color={C.yellow || '#F59E0B'}>tentativa registrada · segue pendente</Chip></div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 4, marginTop: 6, minHeight: 22 }} onClick={e => e.stopPropagation()}>
        <PriorityPill priority={task.priority} compact />
        <DuePill task={task} today={today} compact />
        <ChecklistBadge progress={progress} />
        <span style={{ flex: 1 }} />
        <WhatsAppLink task={task} size={22} />
        <OutcomeButton task={task} onOutcome={actions.outcome} iconOnly />
        {who
          ? <Avatar label={who} size={22} />
          : <span title="Sem responsável" style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px dashed ${C.borderBright || C.border}`, display: 'grid', placeItems: 'center', color: C.textDim }}><Ico d={ICONS.user} size={11} /></span>}
      </div>
      <TaskActionsMenu task={task} stages={ws.stages} currentStageId={stageId} anchorRef={menuRef} open={menu} onClose={() => setMenu(false)} actions={actions} />
    </article>
  )
})

// Formulário de coluna (nome, cor e — ao criar — o status das tarefas que ficam nela).
export function StageForm({ initial, onSubmit, onCancel, submitLabel, askBase = false }) {
  const [label, setLabel] = useState(initial?.label || '')
  const [color, setColor] = useState(initial?.color || STAGE_COLORS[0])
  const [base, setBase] = useState(initial?.base_status || 'pendente')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  async function submit() {
    const l = label.trim()
    if (!l) { setError('Dê um nome para a coluna.'); return }
    setSaving(true); setError(null)
    const res = await onSubmit({ label: l.slice(0, 40), color, base_status: base })
    setSaving(false)
    if (res?.error) setError(res.error)
  }
  return (
    <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input autoFocus value={label} maxLength={40} placeholder="Nome da coluna" aria-label="Nome da coluna" data-testid="task-stage-label"
        onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
        style={{ fontSize: 13, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', outline: 'none' }} />
      <div role="radiogroup" aria-label="Cor" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {STAGE_COLORS.map(c => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Cor ${c}`} onClick={() => setColor(c)}
            style={{ width: 22, height: 22, borderRadius: 6, background: c, border: c === color ? `2px solid ${C.text}` : '2px solid transparent', cursor: 'pointer' }} />
        ))}
      </div>
      {askBase && (
        <label style={{ fontSize: 12, color: C.textSub, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Tarefas nesta coluna ficam
          <select value={base} onChange={e => setBase(e.target.value)} aria-label="Status das tarefas nesta coluna" data-testid="task-stage-base"
            style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit' }}>
            <option value="pendente">Abertas (contam como pendentes)</option>
            <option value="aguardando">Aguardando</option>
            <option value="feita">Concluídas</option>
          </select>
        </label>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" onClick={onCancel} style={{ border: 'none', background: 'transparent', color: C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} data-testid="task-stage-save"
          style={{ border: 'none', background: C.accent, color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Salvando…' : submitLabel}
        </button>
      </div>
    </div>
  )
}

