// Tabela principal do CRM (estilo "Main table" do Monday): grupos coloridos e recolhíveis, cabeçalho
// fixo por grupo, primeira coluna fixa na rolagem horizontal, colunas redimensionáveis/reordenáveis,
// edição na célula, totais por grupo e navegação por teclado (setas). Não carrega dados: recebe o
// estado compartilhado do workspace (useCrmWorkspace).
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { coerceCustomValue, groupSummary, isOverdue, daysSince, sourceKey } from '../lib/crmWorkspace.js'
import { effectiveProbability } from '../lib/crmStages.js'
import { createManualLead } from '../lib/opportunityActions.js'
import {
  Ico, ICONS, Popover, MenuItem, fmtMoney,
  PersonCell, StatusCell, MemberCell, OptionListCell, NumberCell, ProbabilityCell, TextCell, DateCell,
  LastContactCell, WhatsAppCell, NotesCell, OutcomeCell, DateTimeCell, DaysCell, MultiOptionCell,
  CheckboxCell, LinkCell,
} from './CrmCells.jsx'
import { CrmColumnsMenu } from './CrmColumnsMenu.jsx'

const ROW_H = 38
const ADD_COL_W = 44
const PAGE_ROWS = 150

export function CrmTable({
  groups, columns, ctx, ws, ownerId, canManage, groupBy, sort, collapsed, toast,
  procedureOptions, sourceOptions, onToggleCollapse, onCollapseAll, onSort, onResizeColumn, onReorderColumn,
  onHideColumn, onMoveGroup, onConfigureStages, onOpenOpp, columnsMenu,
}) {
  const scrollRef = useRef(null)
  const [liveWidths, setLiveWidths] = useState({})
  const visibleCols = useMemo(() => columns.filter(c => !c.hidden), [columns])
  const widths = useMemo(() => Object.fromEntries(visibleCols.map(c => [c.id, liveWidths[c.id] ?? c.width])), [visibleCols, liveWidths])
  const widthOf = c => widths[c.id] ?? c.width
  // Handlers estáveis (ref para o estado atual) — mantêm as linhas memoizadas entre edições.
  const wsRef = useRef(ws)
  wsRef.current = ws
  const totalWidth = visibleCols.reduce((s, c) => s + widthOf(c), 0) + ADD_COL_W

  // ----- gravação -----
  const commitField = useCallback(async (opp, field, value) => {
    const res = await wsRef.current.updateOpp(opp.id, { [field]: value })
    if (res.error) toast(/inválid|entre 0 e 100/.test(res.error) ? res.error : 'Não foi possível salvar. A alteração foi desfeita.', 'error')
  }, [toast])
  const commitCustom = useCallback(async (opp, col, raw) => {
    const coerced = coerceCustomValue(col.field, raw)
    if (coerced.error) { toast(coerced.error, 'error'); return }
    const res = await wsRef.current.updateCustomValue(opp.id, col.field.id, coerced.value)
    if (res.error) toast('Não foi possível salvar. A alteração foi desfeita.', 'error')
  }, [toast])
  const commitStage = useCallback(async (opp, stage) => {
    const res = await wsRef.current.moveStage(opp.id, stage)
    if (res.error) toast(res.error, 'error')
  }, [toast])
  const commitOutcome = useCallback(async (opp, status, reason) => {
    const res = await wsRef.current.setOutcome(opp.id, status, reason)
    if (res.error) toast('Não foi possível encerrar a oportunidade.', 'error')
    else toast(status === 'ganho' ? 'Oportunidade marcada como ganha.' : 'Oportunidade marcada como perdida.', 'success')
  }, [toast])

  // ----- redimensionar coluna -----
  function startResize(e, col) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(col)
    let latest = startW
    function move(ev) {
      latest = Math.max(72, Math.min(640, startW + ev.clientX - startX))
      setLiveWidths(w => ({ ...w, [col.id]: latest }))
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLiveWidths(w => { const n = { ...w }; delete n[col.id]; return n })
      if (latest !== startW) onResizeColumn(col.id, latest)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ----- navegação por teclado (setas entre células) -----
  function onKeyDown(e) {
    const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const d = dirs[e.key]
    if (!d) return
    const t = e.target
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
    const cell = t.closest?.('[data-cell]')
    if (!cell) return
    const [r, c] = cell.dataset.cell.split(':').map(Number)
    const next = scrollRef.current?.querySelector(`[data-cell="${r + d[0]}:${c + d[1]}"]`)
    const focusable = next?.querySelector('button:not([tabindex="-1"]), a, input')
    if (focusable) {
      e.preventDefault()
      focusable.focus()
      focusable.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }

  let rowCounter = 0
  const groupKeys = groups.map(g => g.key)

  return (
    <div ref={scrollRef} onKeyDown={onKeyDown} data-testid="crm-table"
      style={{ overflow: 'auto', maxHeight: 'calc(100vh - 250px)', minHeight: 360, border: `1px solid ${C.border}`, borderRadius: 12, background: C.bg, position: 'relative' }}>
      <div style={{ width: totalWidth, minWidth: '100%', paddingBottom: 24 }}>
        {groups.map((g, gi) => {
          const isCollapsed = Boolean(collapsed?.[g.key])
          const firstRow = rowCounter
          if (!isCollapsed) rowCounter += g.rows.length + 1
          return (
            <GroupBlock key={g.key} group={g} index={gi} groupKeys={groupKeys} isCollapsed={isCollapsed} firstRow={firstRow}
              visibleCols={visibleCols} widthOf={widthOf} widths={widths} totalWidth={totalWidth} ctx={ctx} ws={ws} ownerId={ownerId}
              canManage={canManage} groupBy={groupBy} sort={sort} toast={toast}
              procedureOptions={procedureOptions} sourceOptions={sourceOptions}
              onToggleCollapse={onToggleCollapse} onCollapseAll={onCollapseAll} onSort={onSort}
              onHideColumn={onHideColumn} onMoveGroup={onMoveGroup} onConfigureStages={onConfigureStages}
              onReorderColumn={onReorderColumn} startResize={startResize} onOpenOpp={onOpenOpp} columnsMenu={columnsMenu}
              commitField={commitField} commitCustom={commitCustom} commitStage={commitStage} commitOutcome={commitOutcome} />
          )
        })}
      </div>
    </div>
  )
}

function GroupBlock({
  group, index, groupKeys, isCollapsed, firstRow, visibleCols, widthOf, widths, totalWidth, ctx, ws, ownerId, canManage, groupBy, sort, toast,
  procedureOptions, sourceOptions, onToggleCollapse, onCollapseAll, onSort, onHideColumn, onMoveGroup, onConfigureStages,
  onReorderColumn, startResize, onOpenOpp, columnsMenu, commitField, commitCustom, commitStage, commitOutcome,
}) {
  const [limit, setLimit] = useState(PAGE_ROWS)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const valueCol = visibleCols.find(c => c.id === 'value')
  const total = group.rows.reduce((s, o) => s + (Number(o.value) || 0), 0)
  const shown = group.rows.slice(0, limit)
  const canAdd = !group.outcome
  const n = group.rows.length

  return (
    <section aria-label={`Grupo ${group.label}`} data-testid={`crm-group-${group.key}`} style={{ marginTop: index === 0 ? 14 : 30 }}>
      {/* Título do grupo (fixo à esquerda na rolagem horizontal) */}
      <div style={{ position: 'sticky', left: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 12px 8px', zIndex: 3, maxWidth: '100vw' }}>
        <button type="button" onClick={() => onToggleCollapse(group.key)} aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? `Expandir ${group.label}` : `Recolher ${group.label}`}
          style={{ border: 'none', background: 'transparent', color: group.color, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2, transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>
          <Ico d={ICONS.chevron} size={18} sw={2.6} />
        </button>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: group.color, whiteSpace: 'nowrap' }}>{group.label}</h3>
        <span style={{ fontSize: 12.5, color: C.textSub, whiteSpace: 'nowrap' }}>
          {n} {n === 1 ? 'oportunidade' : 'oportunidades'}{valueCol && total > 0 ? ` · ${fmtMoney(total)}` : ''}
        </span>
        <button ref={menuRef} type="button" aria-label={`Opções do grupo ${group.label}`} onClick={() => setMenuOpen(o => !o)}
          style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 4, borderRadius: 6 }}>
          <Ico d={ICONS.dots} size={16} />
        </button>
        <Popover anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={220} label="Opções do grupo">
          <MenuItem disabled={index === 0} onClick={() => { setMenuOpen(false); onMoveGroup(groupKeys, group.key, -1) }}><Ico d={ICONS.arrowUp} size={13} />Mover grupo para cima</MenuItem>
          <MenuItem disabled={index === groupKeys.length - 1} onClick={() => { setMenuOpen(false); onMoveGroup(groupKeys, group.key, 1) }}><Ico d={ICONS.arrowDown} size={13} />Mover grupo para baixo</MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); onCollapseAll(groupKeys, true) }}>Recolher todos os grupos</MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); onCollapseAll(groupKeys, false) }}>Expandir todos os grupos</MenuItem>
          {groupBy === 'stage' && canManage && onConfigureStages && (
            <MenuItem onClick={() => { setMenuOpen(false); onConfigureStages() }}><Ico d={ICONS.settings} size={13} />Configurar etapas…</MenuItem>
          )}
        </Popover>
      </div>

      {isCollapsed ? (
        <CollapsedBar group={group} visibleCols={visibleCols} widthOf={widthOf} ctx={ctx} />
      ) : (
        <div role="table" aria-label={group.label} style={{ borderRadius: 8 }}>
          <HeaderRow group={group} visibleCols={visibleCols} widthOf={widthOf} sort={sort} canManage={canManage}
            onSort={onSort} onHideColumn={onHideColumn} onReorderColumn={onReorderColumn} startResize={startResize} columnsMenu={columnsMenu} />
          {shown.map((opp, i) => (
            <Row key={opp.id} opp={opp} rowIndex={firstRow + i} groupColor={group.color} visibleCols={visibleCols} widths={widths}
              ctx={ctx} members={ws.members} procedureOptions={procedureOptions} sourceOptions={sourceOptions} onOpenOpp={onOpenOpp}
              commitField={commitField} commitCustom={commitCustom} commitStage={commitStage} commitOutcome={commitOutcome}
              busy={ws.movingId === opp.id} schemaReady={ws.features.schema} lastContactAvailable={ws.features.lastContact} />
          ))}
          {n > limit && (
            <div style={{ position: 'sticky', left: 0, padding: '8px 14px' }}>
              <button type="button" onClick={() => setLimit(l => l + PAGE_ROWS)}
                style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Mostrar mais {Math.min(PAGE_ROWS, n - limit)} de {n - limit} restantes
              </button>
            </div>
          )}
          {canAdd && (
            <AddRow group={group} groupBy={groupBy} ownerId={ownerId} ws={ws} toast={toast} rowIndex={firstRow + shown.length}
              visibleCols={visibleCols} widthOf={widthOf} totalWidth={totalWidth} />
          )}
          <SummaryRow group={group} visibleCols={visibleCols} widthOf={widthOf} ctx={ctx} />
        </div>
      )}
    </section>
  )
}

function stickyFirst(extra = {}) {
  return { position: 'sticky', left: 0, zIndex: 2, background: C.card, ...extra }
}

function HeaderRow({ group, visibleCols, widthOf, sort, canManage, onSort, onHideColumn, onReorderColumn, startResize, columnsMenu }) {
  const [dragOver, setDragOver] = useState(null)
  const plusRef = useRef(null)
  const [plusOpen, setPlusOpen] = useState(false)
  return (
    <div role="row" style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 4, height: 36, background: C.card, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      {visibleCols.map(col => (
        <HeaderCell key={col.id} col={col} group={group} width={widthOf(col)} sort={sort} canManage={canManage}
          onSort={onSort} onHideColumn={onHideColumn} startResize={startResize}
          dragOver={dragOver === col.id}
          onDragOverCol={() => setDragOver(col.id)}
          onDragLeaveCol={() => setDragOver(d => (d === col.id ? null : d))}
          onDropCol={fromId => { setDragOver(null); if (fromId && fromId !== col.id) onReorderColumn(fromId, col.id) }}
          columnsMenu={columnsMenu} />
      ))}
      <div style={{ width: ADD_COL_W, flex: `0 0 ${ADD_COL_W}px`, display: 'grid', placeItems: 'center', borderLeft: `1px solid ${C.border}` }}>
        <button ref={plusRef} type="button" aria-label="Adicionar ou gerenciar colunas" title="Adicionar ou gerenciar colunas"
          data-testid="crm-columns-plus" onClick={() => setPlusOpen(o => !o)}
          style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', background: C.text, color: C.bg, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Ico d={ICONS.plus} size={14} sw={3} />
        </button>
        <Popover anchorRef={plusRef} open={plusOpen} onClose={() => setPlusOpen(false)} width={320} align="right" label="Colunas" testId="crm-columns-menu">
          <CrmColumnsMenu {...columnsMenu} onDone={() => setPlusOpen(false)} />
        </Popover>
      </div>
    </div>
  )
}

function HeaderCell({ col, group, width, sort, canManage, onSort, onHideColumn, startResize, dragOver, onDragOverCol, onDragLeaveCol, onDropCol, columnsMenu }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const menuRef = useRef(null)
  const sorted = sort?.col === col.id ? sort.dir : null
  const sortable = col.sortable !== false
  const base = {
    width, flex: `0 0 ${width}px`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: col.fixed ? 'flex-start' : 'center', gap: 4,
    padding: col.fixed ? '0 10px 0 16px' : '0 18px 0 8px', boxSizing: 'border-box', fontSize: 12.5, fontWeight: 600, color: C.textSub,
    borderLeft: col.fixed ? `5px solid ${group.color}` : `1px solid ${C.border}`, background: dragOver ? C.accent + '22' : C.card,
    userSelect: 'none',
  }
  return (
    <div role="columnheader" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
      draggable={!col.fixed}
      onDragStart={e => { e.dataTransfer.setData('text/crm-col', col.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (!col.fixed && e.dataTransfer.types.includes('text/crm-col')) { e.preventDefault(); onDragOverCol() } }}
      onDragLeave={onDragLeaveCol}
      onDrop={e => { e.preventDefault(); onDropCol(e.dataTransfer.getData('text/crm-col')) }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={col.fixed ? { ...base, ...stickyFirst({ zIndex: 5, background: dragOver ? C.accent + '22' : C.card }) } : { ...base, cursor: 'grab' }}>
      <button type="button" disabled={!sortable} onClick={() => sortable && onSort(col.id)}
        title={sortable ? 'Ordenar' : undefined}
        style={{ border: 'none', background: 'transparent', color: sorted ? C.accent : C.textSub, font: 'inherit', fontWeight: 600, cursor: sortable ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {col.label}
        {sorted && <Ico d={sorted === 'asc' ? ICONS.arrowUp : ICONS.arrowDown} size={12} sw={2.6} />}
      </button>
      <button ref={menuRef} type="button" aria-label={`Opções da coluna ${col.label}`} onClick={() => setMenuOpen(o => !o)}
        style={{ position: 'absolute', right: 6, border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 1, opacity: hover || menuOpen ? 1 : 0 }}>
        <Ico d={ICONS.dots} size={13} />
      </button>
      <Popover anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={210} label={`Coluna ${col.label}`}>
        {sortable && <>
          <MenuItem onClick={() => { setMenuOpen(false); onSort(col.id, 'asc') }}><Ico d={ICONS.arrowUp} size={13} />Ordenar crescente</MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); onSort(col.id, 'desc') }}><Ico d={ICONS.arrowDown} size={13} />Ordenar decrescente</MenuItem>
        </>}
        {!col.fixed && <MenuItem onClick={() => { setMenuOpen(false); onHideColumn(col.id) }}><Ico d={ICONS.eyeOff} size={13} />Ocultar coluna</MenuItem>}
        {col.custom && canManage && columnsMenu?.onEditField && (
          <MenuItem onClick={() => { setMenuOpen(false); columnsMenu.onEditField(col.field) }}><Ico d={ICONS.settings} size={13} />Configurar coluna…</MenuItem>
        )}
      </Popover>
      <span role="separator" aria-orientation="vertical" aria-label={`Redimensionar ${col.label}`}
        onMouseDown={e => startResize(e, col)}
        style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 7, cursor: 'col-resize', zIndex: 6 }} />
    </div>
  )
}

const Row = memo(function Row({
  opp, rowIndex, groupColor, visibleCols, widths, ctx, members, procedureOptions, sourceOptions, onOpenOpp,
  commitField, commitCustom, commitStage, commitOutcome, busy, schemaReady, lastContactAvailable,
}) {
  const [hover, setHover] = useState(false)
  const overdue = isOverdue(opp, ctx)
  const stale = opp.status === 'aberto' && (daysSince(opp.stage_entered_at, ctx.now) ?? 0) >= 7
  const rowBg = hover ? C.cardHover : C.card

  function cell(col) {
    if (col.custom) return customCell(col)
    switch (col.id) {
      case 'person':
        return <PersonCell opp={opp} groupColor={groupColor} overdue={overdue} stale={stale} onOpen={() => onOpenOpp(opp)} />
      case 'stage': {
        const st = ctx.stagesByKey[opp.stage]
        return <StatusCell testId="crm-cell-stage" label={st?.label || opp.stage} color={st?.color} value={opp.stage} busy={busy}
          popLabel="Mudar etapa" options={ctx.stages.map(s => ({ key: s.key, label: s.label, color: s.color }))}
          onPick={k => commitStage(opp, k)} />
      }
      case 'status':
        return <OutcomeCell opp={opp} onClose={(status, reason) => commitOutcome(opp, status, reason)} />
      case 'responsible':
        return <MemberCell testId="crm-cell-responsible" value={opp.responsible_user_id} members={members} memberLabel={ctx.memberLabel}
          onCommit={v => commitField(opp, 'responsible_user_id', v)} />
      case 'procedure':
        return <OptionListCell testId="crm-cell-procedure" value={opp.procedure_id} options={procedureOptions} readOnly={!schemaReady}
          popLabel="Escolher procedimento" searchPlaceholder="Buscar procedimento…" clearLabel="Sem procedimento" unknownLabel="Procedimento removido"
          onCommit={v => commitField(opp, 'procedure_id', v)} />
      case 'source': {
        const k = sourceKey(opp.source)
        const known = sourceOptions.some(o => o.key === k)
        const options = known || !opp.source ? sourceOptions : [...sourceOptions, { key: k, label: opp.source }]
        return <OptionListCell testId="crm-cell-source" value={opp.source ? k : null} options={options} creatable
          popLabel="Origem do lead" searchPlaceholder="Buscar ou digitar origem…" clearLabel="Sem origem"
          onCommit={v => commitField(opp, 'source', v == null ? null : (options.find(o => o.key === v)?.label || v))} />
      }
      case 'value':
        return <NumberCell testId="crm-cell-value" value={opp.value} format="currency" onCommit={v => commitField(opp, 'value', v)} />
      case 'probability':
        return <ProbabilityCell opp={opp} stagesByKey={ctx.stagesByKey} onCommit={v => commitField(opp, 'probability', v)} />
      case 'next_action':
        return <TextCell testId="crm-cell-next-action" value={opp.next_action} placeholder="" onCommit={v => commitField(opp, 'next_action', v)} />
      case 'next_action_due':
        return <DateCell testId="crm-cell-due" value={opp.next_action_due} overdueBefore={opp.status === 'aberto' ? ctx.today : null} onCommit={v => commitField(opp, 'next_action_due', v)} />
      case 'expected_surgery_date':
        return <DateCell value={opp.expected_surgery_date} onCommit={v => commitField(opp, 'expected_surgery_date', v)} />
      case 'last_contact':
        return <LastContactCell info={ctx.lastContact?.[opp.id]} available={lastContactAvailable} />
      case 'whatsapp':
        return <WhatsAppCell opp={opp} />
      case 'notes':
        return <NotesCell count={ctx.noteCounts?.[opp.id] || 0} onOpen={() => onOpenOpp(opp, 'timeline')} />
      case 'created_at':
        return <DateTimeCell value={opp.created_at} />
      case 'days_in_stage':
        return <DaysCell value={opp.stage_entered_at} />
      case 'title':
        return <TextCell value={opp.title && opp.title !== 'Oportunidade' ? opp.title : ''} onCommit={v => commitField(opp, 'title', v)} />
      default:
        return null
    }
  }

  function customCell(col) {
    const f = col.field
    const v = opp.custom_values?.[f.id]
    const commit = raw => commitCustom(opp, col, raw)
    switch (f.field_type) {
      case 'text': return <TextCell value={v || ''} onCommit={commit} />
      case 'link': return <LinkCell value={v || ''} onCommit={commit} />
      case 'number': return <NumberCell value={v} onCommit={commit} />
      case 'currency': return <NumberCell value={v} format="currency" onCommit={commit} />
      case 'percent': return <NumberCell value={v} format="percent" onCommit={commit} />
      case 'date': return <DateCell value={v || null} onCommit={commit} />
      case 'status': {
        const o = (f.options || []).find(x => x.id === v)
        return <StatusCell label={o?.label} color={o?.color} value={v ?? null} allowClear popLabel={f.label}
          options={(f.options || []).map(x => ({ key: x.id, label: x.label, color: x.color }))} onPick={commit} />
      }
      case 'select':
        return <OptionListCell value={v ?? null} popLabel={f.label} options={(f.options || []).map(x => ({ key: x.id, label: x.label, color: x.color }))} onCommit={commit} />
      case 'multiselect': return <MultiOptionCell value={v} field={f} onCommit={commit} />
      case 'person': return <MemberCell value={v || null} members={members} memberLabel={ctx.memberLabel} onCommit={commit} />
      case 'checkbox': return <CheckboxCell value={Boolean(v)} label={f.label} onCommit={commit} />
      default: return null
    }
  }

  return (
    <div role="row" data-testid="crm-row" data-opp-id={opp.id}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${C.border}`, background: rowBg, opacity: opp.status === 'aberto' ? 1 : 0.86 }}>
      {visibleCols.map((col, ci) => {
        const w = widths[col.id] ?? col.width
        const style = {
          width: w, flex: `0 0 ${w}px`, height: '100%', overflow: 'hidden', boxSizing: 'border-box',
          borderLeft: col.fixed ? 'none' : `1px solid ${C.border}`,
        }
        return (
          <div key={col.id} role="cell" data-cell={`${rowIndex}:${ci}`} data-col={col.id}
            style={col.fixed ? { ...style, ...stickyFirst({ background: rowBg }) } : style}>
            {cell(col)}
          </div>
        )
      })}
      <div style={{ width: ADD_COL_W, flex: `0 0 ${ADD_COL_W}px`, borderLeft: `1px solid ${C.border}` }} />
    </div>
  )
})

// "+ Adicionar oportunidade" no fim do grupo: cria um lead manual (contato + oportunidade, RPC
// atômica existente) já com a etapa/responsável/origem/procedimento do grupo.
function AddRow({ group, groupBy, ownerId, ws, toast, rowIndex, visibleCols, widthOf, totalWidth }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const first = visibleCols[0]

  async function submit() {
    const n = name.trim()
    if (!n || saving) return
    setSaving(true)
    const res = await createManualLead(ownerId, {
      name: n,
      stage: group.stage || 'primeiro_contato',
      responsibleUserId: groupBy === 'responsible' ? group.responsible || null : null,
      source: groupBy === 'source' ? group.source || null : null,
    })
    if (res.error) { setSaving(false); toast(res.error, 'error'); return }
    ws.addOpp(res.opp)
    if (groupBy === 'procedure' && group.procedure) {
      const r = await ws.updateOpp(res.opp.id, { procedure_id: group.procedure })
      if (r.error) toast('Oportunidade criada, mas o procedimento não foi salvo.', 'warning')
    }
    setSaving(false)
    setName('')
    toast('Oportunidade criada.', 'success')
  }

  return (
    <div role="row" style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${C.border}`, background: C.card, width: totalWidth }}>
      <div data-cell={`${rowIndex}:0`} style={{ width: widthOf(first), flex: `0 0 ${widthOf(first)}px`, ...stickyFirst(), borderLeft: `5px solid ${group.color}55`, display: 'flex', alignItems: 'center', boxSizing: 'border-box', padding: '0 8px' }}>
        {open ? (
          <input autoFocus value={name} disabled={saving} placeholder="Nome do paciente/lead e Enter"
            aria-label={`Nova oportunidade em ${group.label}`}
            onChange={e => setName(e.target.value)}
            onBlur={() => { if (!name.trim()) setOpen(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') { setOpen(false); setName('') }
            }}
            style={{ width: '100%', height: 28, boxSizing: 'border-box', padding: '0 8px', border: `1.5px solid ${C.accent}`, borderRadius: 6, background: C.surface, color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        ) : (
          <button type="button" onClick={() => setOpen(true)} data-testid="crm-add-row"
            style={{ border: 'none', background: 'transparent', color: C.textSub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ico d={ICONS.plus} size={13} />Adicionar oportunidade
          </button>
        )}
      </div>
    </div>
  )
}

function DistBar({ parts, total }) {
  if (!total) return null
  return (
    <span style={{ display: 'flex', width: '100%', height: 22, borderRadius: 4, overflow: 'hidden', background: C.surface }}>
      {parts.map(p => <span key={p.key} title={`${p.count}`} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />)}
    </span>
  )
}

function SummaryRow({ group, visibleCols, widthOf, ctx }) {
  const summary = useMemo(() => groupSummary(group.rows, visibleCols, ctx), [group.rows, visibleCols, ctx])
  const weighted = useMemo(() => group.rows.reduce((s, o) => {
    if (o.status !== 'aberto') return s
    const p = effectiveProbability(o, ctx.stagesByKey)
    return s + (Number(o.value) || 0) * ((p ?? 0) / 100)
  }, 0), [group.rows, ctx.stagesByKey])
  if (!group.rows.length) return null
  return (
    <div role="row" aria-label={`Totais de ${group.label}`} style={{ display: 'flex', height: 40 }}>
      {visibleCols.map(col => {
        const w = widthOf(col)
        const s = summary[col.id]
        let content = null
        if (s?.type === 'sum' && s.count > 0) {
          const money = col.id === 'value' || col.field?.field_type === 'currency'
          content = <span style={{ textAlign: 'center', lineHeight: 1.15 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{money ? fmtMoney(s.sum) : s.sum.toLocaleString('pt-BR')}</span>
            <span style={{ fontSize: 10, color: C.textDim }}>soma</span>
          </span>
        } else if (s?.type === 'dist') {
          content = <DistBar parts={s.parts} total={s.total} />
        } else if (col.id === 'probability' && weighted > 0) {
          content = <span style={{ textAlign: 'center', lineHeight: 1.15 }} title="Pipeline ponderado: Σ valor × probabilidade das oportunidades abertas">
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(weighted)}</span>
            <span style={{ fontSize: 10, color: C.textDim }}>ponderado</span>
          </span>
        }
        const style = { width: w, flex: `0 0 ${w}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px', boxSizing: 'border-box' }
        return <div key={col.id} role="cell" style={col.fixed ? { ...style, ...stickyFirst({ background: C.bg }) } : { ...style, borderLeft: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.card }}>{content}</div>
      })}
    </div>
  )
}

function CollapsedBar({ group, visibleCols, widthOf, ctx }) {
  const summary = useMemo(() => groupSummary(group.rows, visibleCols, ctx), [group.rows, visibleCols, ctx])
  return (
    <div style={{ display: 'flex', height: 40, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.card }}>
      {visibleCols.map(col => {
        const w = widthOf(col)
        const s = summary[col.id]
        const style = { width: w, flex: `0 0 ${w}px`, display: 'flex', alignItems: 'center', justifyContent: col.fixed ? 'flex-start' : 'center', padding: '4px 8px', boxSizing: 'border-box' }
        if (col.fixed) {
          return <div key={col.id} style={{ ...style, ...stickyFirst(), borderLeft: `5px solid ${group.color}`, fontSize: 13, fontWeight: 700, color: group.color, gap: 8 }}>
            {group.label}<span style={{ fontWeight: 500, color: C.textSub, fontSize: 12 }}>{group.rows.length}</span>
          </div>
        }
        let content = null
        if (s?.type === 'sum' && s.count > 0) {
          const money = col.id === 'value' || col.field?.field_type === 'currency'
          content = <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{money ? fmtMoney(s.sum) : s.sum.toLocaleString('pt-BR')}</span>
        } else if (s?.type === 'dist') content = <DistBar parts={s.parts} total={s.total} />
        return <div key={col.id} style={{ ...style, borderLeft: `1px solid ${C.border}` }}>{content}</div>
      })}
    </div>
  )
}
