// Barra de ferramentas do workspace de CRM (estilo Monday): Nova oportunidade, Busca, Pessoa,
// Filtro (combinável), Ordenar, Ocultar e Agrupar por. Os filtros valem para Tabela E Kanban.
import { useRef, useState } from 'react'
import { C } from '../theme.js'
import { Ico, ICONS, Popover, MenuItem, Avatar } from './CrmCells.jsx'
import {
  GROUP_BY_OPTIONS, PERIOD_FIELDS, PERIOD_PRESETS, EMPTY_FILTERS, activeFilterCount,
} from '../lib/crmWorkspace.js'

function ToolButton({ icon, children, onClick, active, badge, btnRef, testId, ariaLabel }) {
  const [hover, setHover] = useState(false)
  return (
    <button ref={btnRef} type="button" onClick={onClick} data-testid={testId} aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: 'none',
        background: active ? C.accent + '1f' : hover ? C.cardHover : 'transparent', color: active ? C.accent : C.textSub,
        fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}>
      <Ico d={icon} size={15} />{children}
      {badge ? <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: C.accent, color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 5px' }}>{badge}</span> : null}
    </button>
  )
}

function Chip({ active, color, children, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 14, fontSize: 12, fontWeight: 600,
        border: `1px solid ${active ? (color || C.accent) : C.border}`, background: active ? (color || C.accent) + '26' : C.surface,
        color: active ? C.text : C.textSub, cursor: 'pointer', fontFamily: 'inherit',
      }}>
      {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />}{children}
    </button>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ padding: '8px 8px 10px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textDim, marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  )
}

function toggleIn(list, v) {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v]
}

export function CrmToolbar({
  filters, onFiltersChange, columns, onToggleHidden, sort, onSortChange, groupBy, onGroupByChange, tableControls,
  members, memberLabel, stages, procedureOptions, sourceOptions, onNewLead, onNewOpportunity, schemaReady, lastContactAvailable,
  rightSlot,
}) {
  const newRef = useRef(null)
  const personRef = useRef(null)
  const filterRef = useRef(null)
  const sortRef = useRef(null)
  const hideRef = useRef(null)
  const groupRef = useRef(null)
  const [open, setOpen] = useState(null)
  const close = () => setOpen(null)
  const toggle = id => setOpen(o => (o === id ? null : id))
  const set = patch => onFiltersChange({ ...filters, ...patch })
  const nFilters = activeFilterCount({ ...filters, responsible: [] })
  // Conta só o que o usuário escondeu — colunas ocultas por padrão não acendem o botão.
  const hiddenCount = (columns || []).filter(c => Boolean(c.hidden) !== Boolean(c.defaultHidden)).length
  const sortable = (columns || []).filter(c => c.sortable !== false)
  const input = { fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '10px 0' }}>
      <div style={{ display: 'inline-flex', marginRight: 6 }}>
        <button type="button" onClick={onNewLead} data-testid="crm-new-lead"
          style={{ padding: '8px 14px', borderRadius: '8px 0 0 8px', border: 'none', background: C.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Nova oportunidade
        </button>
        <button ref={newRef} type="button" aria-label="Mais opções de criação" onClick={() => toggle('new')}
          style={{ padding: '8px 8px', borderRadius: '0 8px 8px 0', border: 'none', borderLeft: '1px solid rgba(255,255,255,.3)', background: C.accent, color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Ico d={ICONS.chevron} size={14} sw={2.6} />
        </button>
        <Popover anchorRef={newRef} open={open === 'new'} onClose={close} width={260} label="Criar">
          <MenuItem onClick={() => { close(); onNewLead() }}>Novo lead (nome/telefone)</MenuItem>
          <MenuItem onClick={() => { close(); onNewOpportunity() }}>Oportunidade para paciente cadastrado</MenuItem>
        </Popover>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textDim, minWidth: 180, flex: '0 1 240px' }}>
        <Ico d={ICONS.search} size={14} />
        <input value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Buscar" aria-label="Buscar oportunidades"
          style={{ border: 'none', outline: 'none', background: 'transparent', color: C.text, fontSize: 13, width: '100%', fontFamily: 'inherit' }} />
        {filters.q && <button type="button" aria-label="Limpar busca" onClick={() => set({ q: '' })} style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', padding: 0, display: 'grid' }}><Ico d={ICONS.x} size={12} /></button>}
      </label>

      <ToolButton btnRef={personRef} icon={ICONS.user} onClick={() => toggle('person')} active={filters.responsible.length > 0} badge={filters.responsible.length || null} testId="crm-filter-person">Pessoa</ToolButton>
      <Popover anchorRef={personRef} open={open === 'person'} onClose={close} width={260} label="Filtrar por responsável">
        <MenuItem active={filters.responsible.includes('none')} onClick={() => set({ responsible: toggleIn(filters.responsible, 'none') })}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px dashed ${C.borderBright}` }} />Sem responsável
        </MenuItem>
        {(members || []).map(m => {
          const label = memberLabel?.[m.user_id] || m.member_email || m.user_id
          return (
            <MenuItem key={m.user_id} active={filters.responsible.includes(m.user_id)} onClick={() => set({ responsible: toggleIn(filters.responsible, m.user_id) })}>
              <Avatar label={label} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            </MenuItem>
          )
        })}
        {filters.responsible.length > 0 && <MenuItem onClick={() => set({ responsible: [] })}>Limpar</MenuItem>}
      </Popover>

      <ToolButton btnRef={filterRef} icon={ICONS.filter} onClick={() => toggle('filter')} active={nFilters > 0} badge={nFilters || null} testId="crm-filter-button">Filtro</ToolButton>
      <Popover anchorRef={filterRef} open={open === 'filter'} onClose={close} width={380} label="Filtros" testId="crm-filter-panel">
        <Section title="Etapa">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stages.map(s => <Chip key={s.key} color={s.color} active={filters.stage.includes(s.key)} onClick={() => set({ stage: toggleIn(filters.stage, s.key) })}>{s.label}</Chip>)}
          </div>
        </Section>
        <Section title="Situação">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {[['all', 'Todas'], ['aberto', 'Abertas'], ['ganho', 'Ganhas'], ['perdido', 'Perdidas'], ['arquivado', 'Arquivadas']].map(([k, l]) => (
              <Chip key={k} active={filters.status === k} onClick={() => set({ status: k })}>{l}</Chip>
            ))}
          </div>
        </Section>
        {schemaReady && procedureOptions.length > 0 && (
          <Section title="Procedimento">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {procedureOptions.map(p => <Chip key={p.key} color={p.color} active={filters.procedure.includes(p.key)} onClick={() => set({ procedure: toggleIn(filters.procedure, p.key) })}>{p.label}</Chip>)}
              <Chip active={filters.procedure.includes('none')} onClick={() => set({ procedure: toggleIn(filters.procedure, 'none') })}>Sem procedimento</Chip>
            </div>
          </Section>
        )}
        {sourceOptions.length > 0 && (
          <Section title="Origem do lead">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {sourceOptions.map(o => <Chip key={o.key} active={filters.source.includes(o.key)} onClick={() => set({ source: toggleIn(filters.source, o.key) })}>{o.label}</Chip>)}
              <Chip active={filters.source.includes('none')} onClick={() => set({ source: toggleIn(filters.source, 'none') })}>Sem origem</Chip>
            </div>
          </Section>
        )}
        <Section title="Período">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select aria-label="Campo do período" value={filters.period?.field || ''} style={input}
              onChange={e => set({ period: e.target.value ? { field: e.target.value, preset: filters.period?.preset || 'this_month', from: filters.period?.from || null, to: filters.period?.to || null } : null })}>
              <option value="">Qualquer data</option>
              {PERIOD_FIELDS.filter(f => schemaReady || !['next_action_due', 'expected_surgery_date'].includes(f.id))
                .filter(f => lastContactAvailable || f.id !== 'last_contact')
                .map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select aria-label="Intervalo do período" value={filters.period?.preset || ''} disabled={!filters.period} style={input}
              onChange={e => set({ period: { ...filters.period, preset: e.target.value } })}>
              {PERIOD_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {filters.period?.preset === 'custom' && <>
              <input type="date" aria-label="De" value={filters.period.from || ''} onChange={e => set({ period: { ...filters.period, from: e.target.value || null } })} style={input} />
              <input type="date" aria-label="Até" value={filters.period.to || ''} onChange={e => set({ period: { ...filters.period, to: e.target.value || null } })} style={input} />
            </>}
          </div>
        </Section>
        <Section title="Valor estimado (R$)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input type="number" min={0} placeholder="Mínimo" aria-label="Valor mínimo" value={filters.valueMin ?? ''} onChange={e => set({ valueMin: e.target.value === '' ? null : Number(e.target.value) })} style={input} />
            <input type="number" min={0} placeholder="Máximo" aria-label="Valor máximo" value={filters.valueMax ?? ''} onChange={e => set({ valueMax: e.target.value === '' ? null : Number(e.target.value) })} style={input} />
          </div>
        </Section>
        <Section title="Acompanhamento">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.text, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={filters.overdue} onChange={e => set({ overdue: e.target.checked })} style={{ accentColor: C.accent }} />
            Com tarefa ou prazo atrasado
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.text, flexWrap: 'wrap' }}>
            <input type="checkbox" checked={Boolean(filters.noContactDays)} onChange={e => set({ noContactDays: e.target.checked ? 5 : null })} style={{ accentColor: C.accent }} />
            Sem contato há mais de
            <input type="number" min={1} aria-label="Dias sem contato" value={filters.noContactDays ?? ''} disabled={!filters.noContactDays}
              onChange={e => set({ noContactDays: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...input, width: 60 }} />
            dias
          </label>
          {!lastContactAvailable && <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>Sem o último contato calculado, conta-se desde a entrada da oportunidade.</div>}
        </Section>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 6px 4px' }}>
          <button type="button" onClick={() => onFiltersChange({ ...EMPTY_FILTERS, q: filters.q, responsible: filters.responsible })}
            style={{ border: 'none', background: 'transparent', color: C.accent, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Limpar filtros
          </button>
        </div>
      </Popover>

      {tableControls && <>
        <ToolButton btnRef={sortRef} icon={ICONS.sort} onClick={() => toggle('sort')} active={Boolean(sort)} testId="crm-sort-button">Ordenar</ToolButton>
        <Popover anchorRef={sortRef} open={open === 'sort'} onClose={close} width={280} label="Ordenar">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 6, padding: 6 }}>
            <select aria-label="Ordenar por" value={sort?.col || ''} style={input} onChange={e => onSortChange(e.target.value ? { col: e.target.value, dir: sort?.dir || 'asc' } : null)}>
              <option value="">Padrão (mais recentes)</option>
              {sortable.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <select aria-label="Direção" value={sort?.dir || 'asc'} disabled={!sort} style={input} onChange={e => onSortChange({ ...sort, dir: e.target.value })}>
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </div>
        </Popover>

        <ToolButton btnRef={hideRef} icon={ICONS.eyeOff} onClick={() => toggle('hide')} active={hiddenCount > 0} badge={hiddenCount || null} testId="crm-hide-button">Ocultar</ToolButton>
        <Popover anchorRef={hideRef} open={open === 'hide'} onClose={close} width={240} label="Mostrar ou ocultar colunas">
          {(columns || []).filter(c => !c.fixed).map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12.5, color: C.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={!c.hidden} onChange={() => onToggleHidden(c.id)} style={{ accentColor: C.accent }} />{c.label}
            </label>
          ))}
        </Popover>

        <ToolButton btnRef={groupRef} icon={ICONS.group} onClick={() => toggle('group')} active={groupBy !== 'stage'} testId="crm-group-button">
          Agrupar{groupBy !== 'stage' ? `: ${GROUP_BY_OPTIONS.find(g => g.id === groupBy)?.label}` : ''}
        </ToolButton>
        <Popover anchorRef={groupRef} open={open === 'group'} onClose={close} width={240} label="Agrupar por">
          {GROUP_BY_OPTIONS.filter(g => schemaReady || !['procedure', 'surgery'].includes(g.id)).map(g => (
            <MenuItem key={g.id} active={groupBy === g.id} onClick={() => { close(); onGroupByChange(g.id) }}>{g.label}</MenuItem>
          ))}
          <div style={{ fontSize: 11, color: C.textDim, padding: '6px 9px', lineHeight: 1.4 }}>Agrupar só muda a visualização — nenhuma oportunidade muda de etapa.</div>
        </Popover>
      </>}
      <div style={{ flex: 1 }} />
      {rightSlot}
    </div>
  )
}
