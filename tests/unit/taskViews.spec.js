import { expect, test } from '@playwright/test'
import { filterTasks, kanbanByStatus, urgencyOf, countDoneToday } from '../../src/lib/taskViews.js'

const TODAY = new Date('2026-10-13T09:00:00')

// ---- urgencyOf ----
test('urgencyOf classifica atrasada/hoje/semana/futura e feita', () => {
  expect(urgencyOf({ status: 'pendente', due_date: '2026-10-10' }, TODAY)).toBe('atrasada')
  expect(urgencyOf({ status: 'pendente', due_date: '2026-10-13' }, TODAY)).toBe('hoje')
  expect(urgencyOf({ status: 'pendente', due_date: '2026-10-18' }, TODAY)).toBe('semana')
  expect(urgencyOf({ status: 'pendente', due_date: '2026-12-01' }, TODAY)).toBe('futura')
  expect(urgencyOf({ status: 'pendente', due_date: null }, TODAY)).toBe('futura')
  expect(urgencyOf({ status: 'feita', due_date: '2026-10-10' }, TODAY)).toBe('feita')
})

// ---- filterTasks ----
const SAMPLE = [
  { id: '1', title: 'Enviar orçamento', assigned_user_id: 'u1', status: 'pendente', patients: { full_name: 'Mariana Costa' }, opportunities: { title: 'Rinoplastia' } },
  { id: '2', title: 'Ligar paciente', assigned_user_id: 'u2', status: 'pendente', patients: { full_name: 'Juliana Alves' } },
  { id: '3', title: 'Revisar fotos', assigned_user_id: null, status: 'pendente' },
  { id: '4', title: 'Follow-up', assigned_user_id: 'u1', status: 'feita' },
]

test('scope minhas filtra pelo usuário atual', () => {
  const r = filterTasks(SAMPLE, { scope: 'minhas', currentUserId: 'u1' })
  expect(r.map(t => t.id)).toEqual(['1', '4'])
})

test('scope todas (padrão) não filtra por usuário', () => {
  expect(filterTasks(SAMPLE, { scope: 'todas' })).toHaveLength(4)
  expect(filterTasks(SAMPLE, {})).toHaveLength(4)
})

test('responsibles aceita vários ids ao mesmo tempo', () => {
  const r = filterTasks(SAMPLE, { responsibles: ['u1', 'u2'] })
  expect(r.map(t => t.id).sort()).toEqual(['1', '2', '4'])
})

test('responsibles vazio = sem filtro', () => {
  expect(filterTasks(SAMPLE, { responsibles: [] })).toHaveLength(4)
})

test("responsibles com 'none' pega tarefas sem responsável", () => {
  const r = filterTasks(SAMPLE, { responsibles: ['none'] })
  expect(r.map(t => t.id)).toEqual(['3'])
})

test('query casa com título, paciente ou oportunidade', () => {
  expect(filterTasks(SAMPLE, { query: 'orça' }).map(t => t.id)).toEqual(['1'])
  expect(filterTasks(SAMPLE, { query: 'juliana' }).map(t => t.id)).toEqual(['2'])
  expect(filterTasks(SAMPLE, { query: 'rino' }).map(t => t.id)).toEqual(['1'])
})

test('filtros combinam (escopo + responsável + busca)', () => {
  const r = filterTasks(SAMPLE, { scope: 'todas', responsibles: ['u1'], query: 'orç' })
  expect(r.map(t => t.id)).toEqual(['1'])
})

// ---- kanbanByStatus ----
test('kanbanByStatus separa A fazer x Concluídas', () => {
  const { afazer, concluidas } = kanbanByStatus(SAMPLE, TODAY)
  expect(afazer.map(t => t.id).sort()).toEqual(['1', '2', '3'])
  expect(concluidas.map(t => t.id)).toEqual(['4'])
})

test('A fazer vem ordenada por urgência (atrasada → hoje → semana → futura)', () => {
  const tasks = [
    { id: 'fut', status: 'pendente', due_date: '2026-12-01' },
    { id: 'atr', status: 'pendente', due_date: '2026-10-10' },
    { id: 'sem', status: 'pendente', due_date: '2026-10-18' },
    { id: 'hoj', status: 'pendente', due_date: '2026-10-13' },
  ]
  expect(kanbanByStatus(tasks, TODAY).afazer.map(t => t.id)).toEqual(['atr', 'hoj', 'sem', 'fut'])
})

test('Concluídas ordenadas por done_at desc (mais recente primeiro)', () => {
  const tasks = [
    { id: 'old', status: 'feita', done_at: '2026-10-01T10:00:00Z' },
    { id: 'new', status: 'feita', done_at: '2026-10-12T10:00:00Z' },
  ]
  expect(kanbanByStatus(tasks, TODAY).concluidas.map(t => t.id)).toEqual(['new', 'old'])
})

// ---- countDoneToday (usa dia LOCAL, não UTC) ----
test('countDoneToday conta só as concluídas no dia local', () => {
  const tasks = [
    { id: 'h', status: 'feita', done_at: '2026-10-13T12:00:00Z' },   // hoje
    { id: 'o', status: 'feita', done_at: '2026-10-11T12:00:00Z' },   // outro dia
    { id: 'p', status: 'pendente', done_at: null },                  // não concluída
  ]
  expect(countDoneToday(tasks, TODAY)).toBe(1)
})

test('countDoneToday ignora done_at inválido/ausente', () => {
  expect(countDoneToday([{ status: 'feita', done_at: 'xx' }, { status: 'feita' }], TODAY)).toBe(0)
})
