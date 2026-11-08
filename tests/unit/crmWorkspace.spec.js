import { expect, test } from '@playwright/test'
import {
  resolveColumns, normalizeViewConfig, applyFilters, sortRows, groupRows, groupSummary, moveGroup,
  periodRange, coerceCustomValue, withCustomValue, validateFieldDraft, compatibleFieldTypes, activeFilterCount,
  SYSTEM_COLUMNS, isOverdue, tasksByOpportunity, overdueTaskCounts, subitemProgress, isTaskOpen,
} from '../../src/lib/crmWorkspace.js'
import { OPEN_TASK_STATUSES, TASK_STATUSES } from '../../src/lib/taskQueue.js'
import { resolveStages, stageMap, effectiveProbability, stageProbFractions, DEFAULT_STAGES } from '../../src/lib/crmStages.js'
import { weightedPipeline, STAGE_PROB } from '../../src/lib/crmMetrics.js'

const stages = resolveStages([])
const stagesByKey = stageMap(stages)
const ctx = {
  stages, stagesByKey,
  memberLabel: { u1: 'ana@clinica.com', u2: 'bruno@clinica.com' },
  members: [{ user_id: 'u1' }, { user_id: 'u2' }],
  procedureName: { p1: 'Rinoplastia', p2: 'Mamoplastia' },
  lastContact: { o1: { at: '2026-11-05T10:00:00Z', source: 'whatsapp' } },
  overdueTasks: { o3: 1 },
  today: '2026-11-06',
  now: new Date('2026-11-06T12:00:00Z').getTime(),
}

const OPPS = [
  { id: 'o1', stage: 'orcamento_enviado', status: 'aberto', value: 25000, source: 'Instagram', procedure_id: 'p1', responsible_user_id: 'u1', created_at: '2026-11-01T12:00:00Z', patients: { full_name: 'Ana Silva', phone: '61999990000' }, custom_values: {} },
  { id: 'o2', stage: 'orcamento_enviado', status: 'aberto', value: 12000, source: 'instagram ', procedure_id: 'p2', responsible_user_id: null, created_at: '2026-10-10T12:00:00Z', patients: { full_name: 'Bia Souza' }, custom_values: {} },
  { id: 'o3', stage: 'consulta_agendada', status: 'aberto', value: null, source: null, procedure_id: null, responsible_user_id: 'u2', next_action_due: '2026-11-03', created_at: '2026-09-01T12:00:00Z', crm_contacts: { full_name: 'Carla Lead' }, custom_values: {} },
  { id: 'o4', stage: 'reserva_paga', status: 'perdido', value: 40000, source: 'Google', procedure_id: 'p1', responsible_user_id: 'u1', created_at: '2026-08-15T12:00:00Z', patients: { full_name: 'Duda Lima' }, custom_values: {} },
]

test('etapas: padrão preservado e personalização por clínica sem criar etapa nova', () => {
  expect(stages.map(s => s.key)).toEqual(DEFAULT_STAGES.map(s => s.key))
  const custom = resolveStages([
    { stage_key: 'consultado', label: 'Avaliada', color: '#112233', probability: 45, position: 0 },
    { stage_key: 'em_negociacao', label: 'Inventada' },
  ])
  expect(custom).toHaveLength(8)
  expect(custom.find(s => s.key === 'consultado')).toMatchObject({ label: 'Avaliada', color: '#112233', probability: 45 })
  // A tela grava as 8 posições; a ordem salva é respeitada.
  const reordered = resolveStages(DEFAULT_STAGES.map((s, i) => ({ stage_key: s.key, position: s.key === 'consultado' ? -1 : i })))
  expect(reordered[0].key).toBe('consultado')
  expect(custom.some(s => s.key === 'em_negociacao')).toBe(false)
  // Cor inválida cai no padrão.
  expect(resolveStages([{ stage_key: 'consultado', color: 'red' }]).find(s => s.key === 'consultado').color).toBe('#0ea5e9')
})

test('probabilidade efetiva: própria > etapa; ganho 100; perdido 0', () => {
  expect(effectiveProbability({ status: 'aberto', stage: 'orcamento_enviado' }, stagesByKey)).toBe(60)
  expect(effectiveProbability({ status: 'aberto', stage: 'orcamento_enviado', probability: 80 }, stagesByKey)).toBe(80)
  expect(effectiveProbability({ status: 'ganho', stage: 'consultado' }, stagesByKey)).toBe(100)
  expect(effectiveProbability({ status: 'perdido', stage: 'reserva_paga', probability: 90 }, stagesByKey)).toBe(0)
})

test('pipeline ponderado do Painel usa a mesma regra da tabela', () => {
  const opps = [
    { status: 'aberto', stage: 'orcamento_enviado', value: 10000 },                  // 60% → 6000
    { status: 'aberto', stage: 'orcamento_enviado', value: 10000, probability: 90 }, // 90% → 9000
    { status: 'perdido', stage: 'reserva_paga', value: 50000 },                      // fora
  ]
  expect(weightedPipeline(opps).total).toBeCloseTo(15000)
  // Probabilidade da etapa configurada pela clínica.
  const prob = stageProbFractions(resolveStages([{ stage_key: 'orcamento_enviado', probability: 50 }]))
  expect(weightedPipeline(opps, prob).total).toBeCloseTo(14000)
  // Sem configuração = padrão de sempre.
  expect(stageProbFractions(stages).orcamento_enviado).toBeCloseTo(STAGE_PROB.orcamento_enviado)
})

test('colunas: Paciente fixa primeiro, ordem salva respeitada, campo arquivado some, schema ausente esconde campos novos', () => {
  const fields = [
    { id: 'f1', label: 'Indicação', field_type: 'text' },
    { id: 'f2', label: 'Antigo', field_type: 'text', archived_at: '2026-11-01' },
  ]
  const cols = resolveColumns([{ id: 'value', width: 200 }, { id: 'person', width: 300 }, { id: 'cf:f2' }, { id: 'stage', hidden: true }], fields)
  expect(cols[0].id).toBe('person')
  expect(cols[0].width).toBe(300)
  expect(cols[1]).toMatchObject({ id: 'value', width: 200 })
  expect(cols.find(c => c.id === 'stage').hidden).toBe(true)
  expect(cols.some(c => c.id === 'cf:f2')).toBe(false)
  expect(cols.find(c => c.id === 'cf:f1')).toMatchObject({ custom: true, hidden: false })
  expect(cols.find(c => c.id === 'status').hidden).toBe(true) // oculta por padrão
  expect(cols).toHaveLength(SYSTEM_COLUMNS.length + 1)
  // Paciente nunca pode ser ocultada.
  expect(resolveColumns([{ id: 'person', hidden: true }], [])[0].hidden).toBe(false)
  const legacy = resolveColumns([], [], { schemaReady: false }).map(c => c.id)
  expect(legacy).not.toContain('procedure')
  expect(legacy).not.toContain('next_action_due')
  expect(legacy).toContain('value')
})

test('config da visualização é normalizada (entrada salva corrompida não quebra)', () => {
  const c = normalizeViewConfig({ groupBy: 'xpto', sort: { col: 'value', dir: 'x' }, filters: { status: 'abc', responsible: 'u1', valueMin: '10' }, collapsed: [] })
  expect(c.groupBy).toBe('stage')
  expect(c.sort).toEqual({ col: 'value', dir: 'asc' })
  expect(c.filters.status).toBe('all')
  expect(c.filters.responsible).toEqual([])
  expect(c.filters.valueMin).toBe(10)
  expect(c.collapsed).toEqual({ ganho: true, perdido: true })
})

test('filtros combinados: rinoplastia + orçamento enviado + ainda aberta', () => {
  const r = applyFilters(OPPS, { procedure: ['p1'], stage: ['orcamento_enviado'], status: 'aberto' }, ctx)
  expect(r.map(o => o.id)).toEqual(['o1'])
})

test('filtro acima de R$ 20.000 sem contato há mais de 5 dias', () => {
  // o1 teve contato ontem; o4 nunca teve contato (conta desde a entrada) e vale 40 mil.
  const r = applyFilters(OPPS, { valueMin: 20000, noContactDays: 5 }, ctx)
  expect(r.map(o => o.id)).toEqual(['o4'])
})

test('filtros de busca (sem acento), responsável, origem normalizada e atraso', () => {
  expect(applyFilters(OPPS, { q: 'rinoplastia' }, ctx).map(o => o.id)).toEqual(['o1', 'o4'])
  expect(applyFilters(OPPS, { q: 'BIA' }, ctx).map(o => o.id)).toEqual(['o2'])
  expect(applyFilters(OPPS, { responsible: ['none'] }, ctx).map(o => o.id)).toEqual(['o2'])
  expect(applyFilters(OPPS, { source: ['instagram'] }, ctx).map(o => o.id)).toEqual(['o1', 'o2'])
  expect(applyFilters(OPPS, { overdue: true }, ctx).map(o => o.id)).toEqual(['o3'])
  expect(isOverdue({ ...OPPS[3], next_action_due: '2026-01-01' }, ctx)).toBe(false) // encerrada não atrasa
  expect(activeFilterCount({ q: 'x', stage: ['a'], overdue: true })).toBe(2)
})

test('período relativo: "esta semana" é recalculado a partir de hoje', () => {
  expect(periodRange({ preset: 'this_week' }, '2026-11-06')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
  expect(periodRange({ preset: 'this_week' }, '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' }) // domingo
  expect(periodRange({ preset: 'this_month' }, '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  const r = applyFilters(OPPS, { period: { field: 'created_at', preset: 'this_month' } }, ctx)
  expect(r.map(o => o.id)).toEqual(['o1'])
})

test('ordenação: vazios sempre no fim nas duas direções', () => {
  const cols = resolveColumns([], [])
  const asc = sortRows(OPPS, { col: 'value', dir: 'asc' }, cols, ctx).map(o => o.id)
  const desc = sortRows(OPPS, { col: 'value', dir: 'desc' }, cols, ctx).map(o => o.id)
  expect(asc).toEqual(['o2', 'o1', 'o4', 'o3'])
  expect(desc).toEqual(['o4', 'o1', 'o2', 'o3'])
  // Etapa ordena pela ordem do funil, não pelo nome.
  expect(sortRows(OPPS.slice(0, 3), { col: 'stage', dir: 'asc' }, cols, ctx)[0].id).toBe('o3')
})

test('agrupar por etapa: etapas na ordem do funil, perdidas em grupo próprio, vazias mantidas sem filtro', () => {
  const g = groupRows(OPPS, 'stage', ctx)
  expect(g.map(x => x.key)).toEqual([...DEFAULT_STAGES.map(s => s.key), 'perdido'])
  expect(g.find(x => x.key === 'orcamento_enviado').rows.map(o => o.id)).toEqual(['o1', 'o2'])
  expect(g.find(x => x.key === 'reserva_paga').rows).toHaveLength(0) // o4 está perdida, não na etapa
  const filtered = groupRows(OPPS.slice(0, 2), 'stage', { ...ctx, keepEmptyStages: false })
  expect(filtered.map(x => x.key)).toEqual(['orcamento_enviado'])
})

test('agrupar por responsável/procedimento/origem/mês não altera nenhuma oportunidade', () => {
  const snapshot = JSON.stringify(OPPS)
  const byResp = groupRows(OPPS, 'responsible', ctx)
  expect(byResp.map(x => x.key)).toEqual(['u1', 'u2', 'none'])
  expect(byResp.find(x => x.key === 'u1').rows.map(o => o.id)).toEqual(['o1', 'o4'])
  expect(groupRows(OPPS, 'procedure', ctx).map(x => x.label)).toEqual(['Mamoplastia', 'Rinoplastia', 'Sem procedimento'])
  const bySource = groupRows(OPPS, 'source', ctx)
  expect(bySource.find(x => x.key === 'instagram').rows).toHaveLength(2)
  expect(groupRows(OPPS, 'month', ctx).map(x => x.key)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08'])
  expect(JSON.stringify(OPPS)).toBe(snapshot)
})

test('ordem personalizada dos grupos e mover grupo', () => {
  const keys = ['a', 'b', 'c']
  expect(moveGroup(keys, 'c', -1)).toEqual(['a', 'c', 'b'])
  expect(moveGroup(keys, 'a', -1)).toEqual(keys)
  const g = groupRows(OPPS, 'stage', ctx, ['perdido', 'consulta_agendada'])
  expect(g.slice(0, 2).map(x => x.key)).toEqual(['perdido', 'consulta_agendada'])
})

test('totais do grupo são derivados (soma ignora vazio; distribuição de etapas conta todas as linhas)', () => {
  const cols = resolveColumns([], [{ id: 'f1', label: 'Sinal', field_type: 'currency' }])
  const rows = [...OPPS.slice(0, 3), { ...OPPS[0], id: 'o9', custom_values: { f1: 500 } }]
  const s = groupSummary(rows, cols, ctx)
  expect(s.value).toEqual({ type: 'sum', sum: 62000, count: 3 })
  expect(s['cf:f1']).toEqual({ type: 'sum', sum: 500, count: 1 })
  expect(s.stage.total).toBe(4)
  expect(s.stage.parts.reduce((a, p) => a + p.count, 0)).toBe(4)
})

test('campos personalizados: validação e conversão por tipo', () => {
  const sel = { field_type: 'select', options: [{ id: 'a', label: 'A' }] }
  expect(coerceCustomValue(sel, 'a')).toEqual({ value: 'a' })
  expect(coerceCustomValue(sel, 'zz').error).toBeTruthy()
  expect(coerceCustomValue({ field_type: 'currency' }, '1500,50')).toEqual({ value: 1500.5 })
  expect(coerceCustomValue({ field_type: 'currency' }, '-1').error).toBeTruthy()
  expect(coerceCustomValue({ field_type: 'percent' }, '120').error).toBeTruthy()
  expect(coerceCustomValue({ field_type: 'link' }, 'javascript:alert(1)').error).toBeTruthy()
  expect(coerceCustomValue({ field_type: 'link' }, 'https://exemplo.com')).toEqual({ value: 'https://exemplo.com' })
  expect(coerceCustomValue({ field_type: 'date' }, '06/11/2026').error).toBeTruthy()
  expect(coerceCustomValue({ field_type: 'checkbox' }, '')).toEqual({ value: false })
  expect(coerceCustomValue({ field_type: 'multiselect', options: [{ id: 'a' }, { id: 'b' }] }, ['a', 'x'])).toEqual({ value: ['a'] })
  expect(coerceCustomValue({ field_type: 'text' }, '')).toEqual({ value: null })
})

test('withCustomValue grava só a chave alterada e remove quando vazio', () => {
  const base = { f1: 'x', f2: 2 }
  expect(withCustomValue(base, 'f2', 3)).toEqual({ f1: 'x', f2: 3 })
  expect(withCustomValue(base, 'f1', null)).toEqual({ f2: 2 })
  expect(base).toEqual({ f1: 'x', f2: 2 })
})

test('definição de coluna: nome obrigatório, opções obrigatórias e sem repetição; tipos compatíveis iguais aos do banco', () => {
  expect(validateFieldDraft({ label: '  ', field_type: 'text' }).error).toBeTruthy()
  expect(validateFieldDraft({ label: 'Status', field_type: 'status', options: [] }).error).toBeTruthy()
  expect(validateFieldDraft({ label: 'S', field_type: 'select', options: [{ id: '1', label: 'A' }, { id: '2', label: 'a ' }] }).error).toMatch(/repetida/)
  expect(validateFieldDraft({ label: 'Indicação', field_type: 'text', options: [{ id: '1', label: 'x' }] }).field.options).toEqual([])
  expect(compatibleFieldTypes('number')).toEqual(['number', 'currency', 'percent'])
  expect(compatibleFieldTypes('date')).toEqual(['date'])
  expect(compatibleFieldTypes('status')).toContain('select')
})

// ---------------------------------------------------------------------------
// Fase 2: arquivadas, subitens e atrasadas derivadas
// ---------------------------------------------------------------------------
const ARCHIVED = { id: 'o5', stage: 'consultado', status: 'arquivado', value: 9000, source: 'Instagram', procedure_id: 'p1', responsible_user_id: 'u1', created_at: '2026-11-02T12:00:00Z', patients: { full_name: 'Eva Arquivada' }, custom_values: {} }

test('arquivadas: fora de "Todas" e de qualquer situação, só aparecem com o filtro Arquivadas', () => {
  const all = [...OPPS, ARCHIVED]
  expect(applyFilters(all, {}, ctx).map(o => o.id)).not.toContain('o5')
  expect(applyFilters(all, { status: 'aberto' }, ctx).map(o => o.id)).not.toContain('o5')
  expect(applyFilters(all, { status: 'arquivado' }, ctx).map(o => o.id)).toEqual(['o5'])
  // Filtro salvo com valor desconhecido continua caindo em "Todas".
  expect(normalizeViewConfig({ filters: { status: 'xpto' } }).filters.status).toBe('all')
  expect(normalizeViewConfig({ filters: { status: 'arquivado' } }).filters.status).toBe('arquivado')
})

test('arquivadas: somas do grupo e agrupamento por etapa não contam arquivadas por padrão', () => {
  const all = [...OPPS, ARCHIVED]
  const groups = groupRows(applyFilters(all, {}, ctx), 'stage', ctx)
  expect(groups.some(g => g.key === 'arquivado')).toBe(false)
  const consultado = groups.find(g => g.key === 'consultado')
  expect(consultado.rows).toHaveLength(0)
  // Com o filtro, vão para o grupo próprio "Arquivadas" (não para a etapa onde estavam).
  const onlyArchived = groupRows(applyFilters(all, { status: 'arquivado' }, { ...ctx, keepEmptyStages: false }), 'stage', { ...ctx, keepEmptyStages: false })
  expect(onlyArchived.map(g => g.key)).toEqual(['arquivado'])
  expect(onlyArchived[0].outcome).toBe('arquivado')
  // Arquivada não é "atrasada" (não gera alerta).
  expect(isOverdue({ ...ARCHIVED, next_action_due: '2026-01-01' }, ctx)).toBe(false)
})

test('subitens: tarefas agrupadas por oportunidade, abertas por prazo antes das concluídas', () => {
  const tasks = [
    { id: 't1', opportunity_id: 'o1', title: 'Consulta realizada', status: 'feita', due_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z' },
    { id: 't2', opportunity_id: 'o1', title: 'Confirmar reserva', status: 'aguardando', due_date: null, created_at: '2026-11-01T10:00:00Z' },
    { id: 't3', opportunity_id: 'o1', title: 'Realizar follow-up', status: 'pendente', due_date: '2026-11-04', created_at: '2026-11-01T11:00:00Z' },
    { id: 't4', opportunity_id: 'o2', title: 'Enviar orçamento', status: 'pendente', due_date: '2026-11-10', created_at: '2026-11-01T11:00:00Z' },
    { id: 't5', opportunity_id: null, title: 'Avulsa', status: 'pendente', due_date: '2026-11-01' },
  ]
  const map = tasksByOpportunity(tasks)
  expect(Object.keys(map).sort()).toEqual(['o1', 'o2'])
  expect(map.o1.map(t => t.id)).toEqual(['t3', 't2', 't1'])
  expect(subitemProgress(map.o1)).toBe('1/3')
  expect(subitemProgress(map.o3)).toBeNull()
})

test('aguardando continua aberta: conta como atrasada e no Sino/Meu Dia (mesma lista de status)', () => {
  expect(OPEN_TASK_STATUSES).toEqual(['pendente', 'aguardando'])
  expect(TASK_STATUSES.map(s => s.key)).toEqual(['pendente', 'aguardando', 'feita'])
  expect(isTaskOpen({ status: 'aguardando' })).toBe(true)
  expect(isTaskOpen({ status: 'feita' })).toBe(false)
  const tasks = [
    { opportunity_id: 'o1', status: 'aguardando', due_date: '2026-11-01' },
    { opportunity_id: 'o1', status: 'pendente', due_date: '2026-11-05' },
    { opportunity_id: 'o1', status: 'feita', due_date: '2026-10-01' },
    { opportunity_id: 'o2', status: 'pendente', due_date: '2026-11-06' }, // vence hoje: não atrasada
    { opportunity_id: 'o2', status: 'pendente', due_date: null },
  ]
  expect(overdueTaskCounts(tasks, '2026-11-06')).toEqual({ o1: 2 })
  // Concluir o subitem derruba o alerta (derivado, sem contador salvo).
  const after = tasks.map(t => (t.status === 'aguardando' ? { ...t, status: 'feita' } : t))
  expect(overdueTaskCounts(after, '2026-11-06')).toEqual({ o1: 1 })
})
