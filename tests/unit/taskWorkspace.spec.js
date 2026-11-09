import { expect, test } from '@playwright/test'
import {
  resolveTaskStages, stageIndex, stageOf, VIRTUAL_STAGES, applyTaskFilters, activeTaskFilterCount, normalizeTaskFilters,
  sortTasks, groupTasks, kanbanColumns, reorderIds, resolveTaskColumns, serializeTaskColumns, moveColumn,
  dueBucket, isTaskOverdue, checklistCounts, checklistProgress, describeHistory, taskStats, opportunityOptions, EMPTY_TASK_FILTERS,
} from '../../src/lib/taskWorkspace.js'

const TODAY = '2026-11-11' // quarta-feira
const ROWS = [
  { id: 's-todo', label: 'A fazer', color: '#579bfc', base_status: 'pendente', position: 1, is_default: true, seed_key: 'todo' },
  { id: 's-doing', label: 'Em andamento', color: '#fdab3d', base_status: 'pendente', position: 2, is_default: false, seed_key: 'doing' },
  { id: 's-wait', label: 'Aguardando', color: '#a25ddc', base_status: 'aguardando', position: 3, is_default: true, seed_key: 'waiting' },
  { id: 's-done', label: 'Concluída', color: '#00c875', base_status: 'feita', position: 4, is_default: true, seed_key: 'done' },
  { id: 's-old', label: 'Arquivada', color: '#000000', base_status: 'pendente', position: 5, archived_at: '2026-11-01T00:00:00Z' },
]
const stages = resolveTaskStages(ROWS)
const index = stageIndex(stages)

const T = [
  { id: 't1', title: 'Ligar Ana', status: 'pendente', stage_id: null, due_date: '2026-11-10', assigned_user_id: 'u1', priority: 'urgente', task_type: 'ligar', patient_id: 'p1', patients: { full_name: 'Ana Sílva' }, opportunity_id: 'o1', opportunities: { title: 'Rinoplastia' }, created_at: '2026-11-01' },
  { id: 't2', title: 'Enviar orçamento', status: 'pendente', stage_id: 's-doing', due_date: '2026-11-11', due_time: '09:00', assigned_user_id: 'u2', priority: 'alta', task_type: 'orcamento', patients: { full_name: 'Bia' }, opportunity_id: 'o2', opportunities: { title: 'Oportunidade' }, created_at: '2026-11-02' },
  { id: 't3', title: 'Aguardar exames', status: 'aguardando', stage_id: null, due_date: '2026-11-12', assigned_user_id: null, priority: null, task_type: 'exames', created_at: '2026-11-03' },
  { id: 't4', title: 'Pós-op', status: 'feita', stage_id: null, due_date: '2026-11-05', assigned_user_id: 'u1', priority: 'baixa', task_type: 'pos_op', done_at: '2026-11-11T12:00:00', created_at: '2026-11-04' },
  // Coluna incompatível (Em andamento é pendente, a tarefa está feita): cai na padrão de feita.
  { id: 't5', title: 'Cobrar sinal', status: 'feita', stage_id: 's-doing', due_date: null, assigned_user_id: 'u2', task_type: 'outro', done_at: '2026-11-09T12:00:00', created_at: '2026-11-05' },
  // Coluna arquivada: cai na padrão do status.
  { id: 't6', title: 'Documento', status: 'pendente', stage_id: 's-old', due_date: '2026-11-20', assigned_user_id: 'u1', task_type: 'documento', created_at: '2026-11-06' },
]
const ctx = { userId: 'u1', today: TODAY, stageIndex: index, stages, memberLabel: { u1: 'ana@c.com', u2: 'bruno@c.com' } }

test.describe('colunas do Kanban (status configurável sem mudar tasks.status)', () => {
  test('sem migração: colunas fixas uma por status', () => {
    expect(resolveTaskStages(null).map(s => s.base_status)).toEqual(['pendente', 'aguardando', 'feita'])
    expect(resolveTaskStages([]).every(s => s.virtual)).toBe(true)
  })

  test('arquivadas somem; falta de coluna para um status é suprida pela virtual', () => {
    expect(stages.map(s => s.id)).toEqual(['s-todo', 's-doing', 's-wait', 's-done'])
    const partial = resolveTaskStages(ROWS.filter(r => r.base_status !== 'aguardando'))
    expect(partial.some(s => s.base_status === 'aguardando' && s.virtual)).toBe(true)
  })

  test('coluna efetiva: própria quando combina com o status; senão a padrão do status', () => {
    const col = id => stageOf(T.find(t => t.id === id), index).id
    expect(col('t1')).toBe('s-todo')
    expect(col('t2')).toBe('s-doing')
    expect(col('t3')).toBe('s-wait')
    expect(col('t5')).toBe('s-done')
    expect(col('t6')).toBe('s-todo')
    // Toda tarefa cai em exatamente uma coluna (nenhuma some do quadro).
    const cols = kanbanColumns(T, stages, index)
    expect(cols.reduce((s, c) => s + c.tasks.length, 0)).toBe(T.length)
    expect(cols.map(c => c.tasks.length)).toEqual([2, 1, 1, 2])
  })

  test('ordem manual do card primeiro; sem posição, por prazo; reordenar ids', () => {
    const tasks = [
      { id: 'a', status: 'pendente', due_date: '2026-11-20' },
      { id: 'b', status: 'pendente', due_date: '2026-11-12', board_position: 2048 },
      { id: 'c', status: 'pendente', due_date: '2026-11-13', board_position: 1024 },
      { id: 'd', status: 'pendente', due_date: '2026-11-11' },
    ]
    expect(kanbanColumns(tasks, stages, index)[0].tasks.map(t => t.id)).toEqual(['c', 'b', 'd', 'a'])
    expect(reorderIds(['c', 'b', 'd'], 'a', 'b')).toEqual(['c', 'a', 'b', 'd'])
    expect(reorderIds(['c', 'b', 'd'], 'c', null)).toEqual(['b', 'd', 'c'])
    expect(reorderIds(['c', 'b'], 'x', 'nao-existe')).toEqual(['c', 'b', 'x'])
  })
})

test.describe('filtros combináveis (Kanban e Tabela)', () => {
  const ids = f => applyTaskFilters(T, f, ctx).map(t => t.id)

  test('cada critério isolado', () => {
    expect(ids({ scope: 'minhas' })).toEqual(['t1', 't4', 't6'])
    expect(ids({ responsible: ['u2', 'none'] })).toEqual(['t2', 't3', 't5'])
    expect(ids({ stage: ['s-doing', 's-wait'] })).toEqual(['t2', 't3'])
    expect(ids({ priority: ['urgente', 'none'] })).toEqual(['t1', 't3', 't5', 't6'])
    expect(ids({ category: ['ligar', 'exames'] })).toEqual(['t1', 't3'])
    expect(ids({ patient: 'ana silva' })).toEqual(['t1'])
    expect(ids({ opportunity: ['o2'] })).toEqual(['t2'])
    expect(ids({ q: 'orcamento' })).toEqual(['t2'])
  })

  test('prazo: atrasadas (só abertas), hoje, amanhã, esta semana, sem prazo e intervalo', () => {
    expect(ids({ due: { preset: 'overdue' } })).toEqual(['t1'])
    expect(ids({ due: { preset: 'today' } })).toEqual(['t2'])
    expect(ids({ due: { preset: 'tomorrow' } })).toEqual(['t3'])
    expect(ids({ due: { preset: 'this_week' } })).toEqual(['t1', 't2', 't3']) // seg 09 → dom 15
    expect(ids({ due: { preset: 'none' } })).toEqual(['t5'])
    expect(ids({ due: { preset: 'custom', from: '2026-11-05', to: '2026-11-10' } })).toEqual(['t1', 't4'])
  })

  test('critérios combinados se somam (E), itens de um critério se somam (OU)', () => {
    expect(ids({ responsible: ['u1'], priority: ['urgente', 'baixa'], due: { preset: 'custom', from: '2026-11-01', to: '2026-11-30' } })).toEqual(['t1', 't4'])
    expect(ids({ responsible: ['u1'], stage: ['s-done'] })).toEqual(['t4'])
  })

  test('contagem de filtros ativos e normalização', () => {
    expect(activeTaskFilterCount({ responsible: ['u1'], priority: ['alta'], due: { preset: 'today' }, patient: ' x ', q: 'busca', scope: 'minhas' })).toBe(4)
    expect(activeTaskFilterCount(EMPTY_TASK_FILTERS)).toBe(0)
    expect(normalizeTaskFilters({ due: { preset: 'xpto' }, stage: 'x' })).toMatchObject({ due: null, stage: [] })
  })

  test('opções de oportunidade: só as que têm tarefa, sem repetir', () => {
    expect(opportunityOptions(T)).toEqual([{ key: 'o2', label: 'Oportunidade · Bia' }, { key: 'o1', label: 'Rinoplastia · Ana Sílva' }])
  })
})

test.describe('tabela: ordenação, agrupamento e colunas', () => {
  test('ordenação por prioridade e prazo com vazios no fim', () => {
    expect(sortTasks(T, { col: 'priority', dir: 'asc' }, ctx).map(t => t.id)).toEqual(['t1', 't2', 't4', 't3', 't6', 't5'])
    expect(sortTasks(T, { col: 'due', dir: 'desc' }, ctx).map(t => t.id).at(-1)).toBe('t5')
    expect(sortTasks(T, null, ctx).map(t => t.id)).toEqual(['t1', 't2', 't3', 't6', 't4', 't5'])
  })

  test('agrupamento por status, responsável, prioridade e prazo (grupos vazios somem)', () => {
    expect(groupTasks(T, 'status', ctx).map(g => [g.key, g.rows.length])).toEqual([['s-todo', 2], ['s-doing', 1], ['s-wait', 1], ['s-done', 2]])
    expect(groupTasks(T, 'responsible', ctx).map(g => g.key)).toEqual(['u1', 'u2', 'none'])
    expect(groupTasks(T, 'priority', ctx).map(g => g.key)).toEqual(['urgente', 'alta', 'baixa', 'none'])
    expect(groupTasks(T, 'due', ctx).map(g => [g.key, g.rows.length])).toEqual([['atrasada', 1], ['hoje', 1], ['amanha', 1], ['depois', 1], ['feita', 2]])
    for (const by of ['status', 'responsible', 'priority', 'due', 'none']) {
      expect(groupTasks(T, by, ctx).reduce((s, g) => s + g.rows.length, 0)).toBe(T.length)
    }
  })

  test('colunas: Tarefa fixa e primeira, Ações por último, ordem e ocultas salvas', () => {
    const cols = resolveTaskColumns([{ id: 'due', hidden: false }, { id: 'title', hidden: true }, { id: 'priority', hidden: true }, { id: 'xpto' }])
    expect(cols[0].id).toBe('title')
    expect(cols[0].hidden).toBe(false)
    expect(cols.at(-1).id).toBe('actions')
    expect(cols[1].id).toBe('due')
    expect(cols.find(c => c.id === 'priority').hidden).toBe(true)
    const moved = moveColumn(cols, 'subtasks', 'due')
    expect(moved.map(c => c.id).slice(0, 3)).toEqual(['title', 'subtasks', 'due'])
    expect(moveColumn(cols, 'due', 'title')).toEqual(cols)
    expect(serializeTaskColumns(moved)[0]).toEqual({ id: 'title', hidden: false })
  })
})

test.describe('prazo, subtarefas, histórico e indicadores', () => {
  test('atraso e faixas de prazo', () => {
    expect(isTaskOverdue(T[0], TODAY)).toBe(true)
    expect(isTaskOverdue(T[3], TODAY)).toBe(false) // concluída não está atrasada
    expect(dueBucket({ status: 'pendente', due_date: '2026-11-18' }, TODAY)).toBe('semana')
    expect(dueBucket({ status: 'pendente', due_date: '2026-11-19' }, TODAY)).toBe('depois')
  })

  test('contagem de subtarefas por tarefa', () => {
    expect(checklistCounts([{ task_id: 'a', done: true }, { task_id: 'a', done: false }, { task_id: 'b', done: true }]))
      .toEqual({ a: { done: 1, total: 2 }, b: { done: 1, total: 1 } })
    expect(checklistProgress([])).toBeNull()
  })

  test('histórico legível: coluna, prioridade, responsável e prazo', () => {
    const rows = [
      { id: 'h1', field: 'created', new_value: 'Ligar', changed_by: 'u1', created_at: '2026-11-01T10:00:00Z' },
      { id: 'h2', field: 'stage_id', old_value: 's-todo', new_value: 's-doing', changed_by: 'u2', created_at: '2026-11-02T10:00:00Z' },
      { id: 'h3', field: 'priority', old_value: null, new_value: 'urgente', changed_by: null, created_at: '2026-11-03T10:00:00Z' },
      { id: 'h4', field: 'due_date', old_value: '2026-11-10', new_value: '2026-11-12', changed_by: 'u9', created_at: '2026-11-04T10:00:00Z' },
    ]
    expect(describeHistory(rows, ctx).map(e => `${e.who}: ${e.text}`)).toEqual([
      'Pessoa da equipe: Prazo: 10/11/2026 → 12/11/2026',
      'Sistema: Prioridade: — → Urgente',
      'bruno: Coluna: A fazer → Em andamento',
      'ana: criou a tarefa',
    ])
  })

  test('indicadores compactos sobre o conjunto filtrado', () => {
    expect(taskStats(T, TODAY)).toEqual({ atrasadas: 1, hoje: 1, abertas: 4, feitasHoje: 1 })
  })

  test('as colunas virtuais cobrem os 3 status', () => {
    expect(VIRTUAL_STAGES.map(s => s.base_status)).toEqual(['pendente', 'aguardando', 'feita'])
  })
})
