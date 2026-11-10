import { expect, test } from '@playwright/test'
import {
  buildAgendaEvents, applyAgendaFilters, normalizeAgendaFilters, activeAgendaFilterCount, responsibleByPatient,
  taskAgendaType, canReschedule, reschedulePlan, layoutTimedEvents, periodBounds, visibleDays, shiftFocus,
  clinicNow, countByType, AGENDA_TYPE_KEYS, EMPTY_AGENDA_FILTERS,
} from '../../src/lib/crmAgenda.js'

const TODAY = '2026-11-10' // terça-feira

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', status: 'aberto', stage: 'consultado', patient_id: 'p1', responsible_user_id: 'ana', next_action: 'Ligar para confirmar', next_action_due: '2026-11-12', created_at: '2026-11-01T10:00:00Z', patients: { full_name: 'Bia Souza' } },
  { id: 'o2', title: 'Mamoplastia', status: 'aberto', stage: 'orcamento_enviado', patient_id: 'p2', responsible_user_id: 'felipe', next_action: 'Cobrar retorno do orçamento', next_action_due: '2026-11-08', created_at: '2026-10-01T10:00:00Z', patients: { full_name: 'Carla Lima' } },
  { id: 'o3', title: 'Antiga', status: 'perdido', stage: 'consultado', patient_id: 'p1', responsible_user_id: 'jonas', next_action_due: '2026-11-11', created_at: '2026-11-05T10:00:00Z', patients: { full_name: 'Bia Souza' } },
  { id: 'o4', title: 'Sem prazo', status: 'aberto', stage: 'primeiro_contato', patient_id: null, responsible_user_id: null, next_action_due: null, created_at: '2026-11-02T10:00:00Z', crm_contacts: { full_name: 'Lead WhatsApp' } },
]
const CONSULTATIONS = [
  { id: 'c1', patient: 'Bia Souza', patientId: 'p1', date: '2026-11-12', startTime: '09:00', durationMinutes: 60, consultationType: 'avaliacao', value: 500 },
  { id: 'c2', patient: 'Sem cadastro', patientId: null, date: '2026-11-03', startTime: '', consultationType: 'retorno' },
]
const SURGERIES = [{ id: 's1', patient: 'Carla Lima', patientId: 'p2', date: '2026-11-20', startTime: '07:30', durationMinutes: 240, procedureId: 'pr1' }]
const TASKS = [
  { id: 't1', title: 'Enviar exames', due_date: '2026-11-12', due_time: '10:00', task_type: 'exames', status: 'pendente', assigned_user_id: 'ana', patient_id: 'p1', opportunity_id: null, patients: { full_name: 'Bia Souza' } },
  { id: 't2', title: 'Ligar Carla', due_date: '2026-11-09', due_time: null, task_type: 'ligar', status: 'aguardando', assigned_user_id: 'felipe', opportunity_id: 'o2', patient_id: 'p2' },
  { id: 't3', title: 'Montar orçamento', due_date: '2026-11-11', task_type: 'orcamento', status: 'feita', assigned_user_id: 'ana', opportunity_id: 'o1' },
  { id: 't4', title: 'Ligar sem oportunidade', due_date: '2026-11-13', task_type: 'ligar', status: 'pendente', assigned_user_id: null, opportunity_id: null },
  { id: 't5', title: 'Sem prazo', due_date: null, task_type: 'outro', status: 'pendente' },
]
const PROCEDURES = [{ id: 'pr1', name: 'Mamoplastia' }]

function build(extra = {}) {
  return buildAgendaEvents({ consultations: CONSULTATIONS, surgeries: SURGERIES, tasks: TASKS, opps: OPPS, procedures: PROCEDURES, today: TODAY, ...extra })
}
const byId = (events, id) => events.find(e => e.id === id)

test('reúne consultas, cirurgias, tarefas e próximas ações sem duplicar e com vínculo ao registro original', () => {
  const ev = build()
  expect(ev.map(e => e.id).sort()).toEqual([
    'consultation:c1', 'consultation:c2', 'opportunity:o1', 'opportunity:o2', 'surgery:s1', 'task:t1', 'task:t2', 'task:t3', 'task:t4',
  ])
  // Cada evento aponta para o registro original — nada é copiado.
  expect(byId(ev, 'task:t1')).toMatchObject({ source: 'task', recordId: 't1', record: TASKS[0] })
  expect(byId(ev, 'consultation:c1')).toMatchObject({ source: 'consultation', recordId: 'c1', startTime: '09:00', allDay: false })
  expect(byId(ev, 'surgery:s1')).toMatchObject({ type: 'surgery', subtitle: 'Mamoplastia', durationMinutes: 240 })
  // Oportunidade perdida e oportunidade sem prazo não entram; tarefa sem prazo também não.
  expect(byId(ev, 'opportunity:o3')).toBeUndefined()
  expect(byId(ev, 'task:t5')).toBeUndefined()
  // Valores financeiros não vão para o evento da agenda comercial.
  expect(Object.keys(byId(ev, 'consultation:c1'))).not.toContain('value')
})

test('classifica o tipo: orçamento, follow-up e tarefa', () => {
  const ev = build()
  expect(byId(ev, 'task:t2').type).toBe('followup')       // ligar + oportunidade
  expect(byId(ev, 'task:t4').type).toBe('task')           // ligar sem oportunidade
  expect(byId(ev, 'task:t3').type).toBe('budget')         // categoria Orçamento
  expect(byId(ev, 'task:t1').type).toBe('task')
  expect(byId(ev, 'opportunity:o1').type).toBe('followup') // próxima ação
  expect(byId(ev, 'opportunity:o2').type).toBe('budget')   // etapa Orçamento Enviado
  expect(taskAgendaType({ task_type: 'whatsapp', opportunity_id: 'x' })).toBe('followup')
})

test('status derivado: atrasado, aberto, concluído e realizado', () => {
  const ev = build()
  expect(byId(ev, 'task:t2').status).toBe('overdue')   // aguardando e vencida
  expect(byId(ev, 'task:t1').status).toBe('open')
  expect(byId(ev, 'task:t3').status).toBe('done')
  expect(byId(ev, 'opportunity:o2').status).toBe('overdue')
  expect(byId(ev, 'consultation:c2').status).toBe('done')  // data passada = realizada
  expect(byId(ev, 'consultation:c1').status).toBe('open')
})

test('responsável da consulta/cirurgia vem da oportunidade aberta do paciente', () => {
  const map = responsibleByPatient(OPPS)
  // p1 tem uma aberta (ana) e uma perdida mais recente (jonas): vale a aberta.
  expect(map.get('p1')).toEqual({ userId: 'ana', oppId: 'o1' })
  const ev = build()
  expect(byId(ev, 'consultation:c1')).toMatchObject({ responsibleId: 'ana', responsibleDerived: true, opportunityId: 'o1' })
  expect(byId(ev, 'surgery:s1')).toMatchObject({ responsibleId: 'felipe', opportunityId: 'o2' })
  expect(byId(ev, 'consultation:c2').responsibleId).toBeNull()
})

test('permissões: consultas e cirurgias podem ser omitidas por perfil', () => {
  const ev = build({ include: { appointments: false, surgeries: false } })
  expect(ev.some(e => e.source === 'consultation' || e.source === 'surgery')).toBe(false)
  expect(ev.some(e => e.source === 'task')).toBe(true)
})

test('filtros combináveis: consultas e follow-ups de Ana e Felipe nesta semana', () => {
  const ev = build()
  const filters = { types: ['consultation', 'followup'], responsibles: ['ana', 'felipe'], period: { key: 'this_week' } }
  const out = applyAgendaFilters(ev, filters, { userId: 'ana', today: TODAY })
  // semana de 08/11 (dom) a 14/11 (sáb)
  expect(out.map(e => e.id).sort()).toEqual(['consultation:c1', 'opportunity:o1', 'task:t2'])
  // "Eu" resolve para quem vê; "sem responsável" pega quem não tem.
  expect(applyAgendaFilters(ev, { responsibles: ['me'] }, { userId: 'felipe', today: TODAY }).every(e => e.responsibleId === 'felipe')).toBe(true)
  expect(applyAgendaFilters(ev, { responsibles: ['none'] }, { today: TODAY }).map(e => e.id).sort()).toEqual(['consultation:c2', 'task:t4'])
})

test('filtros de status, paciente (sem acento) e período personalizado', () => {
  const ev = build()
  expect(applyAgendaFilters(ev, { statuses: ['overdue'] }, { today: TODAY }).map(e => e.id).sort()).toEqual(['opportunity:o2', 'task:t2'])
  expect(applyAgendaFilters(ev, { patient: 'CARLA lima' }, { today: TODAY }).every(e => e.patientName === 'Carla Lima')).toBe(true)
  const custom = applyAgendaFilters(ev, { period: { key: 'custom', from: '2026-11-12', to: '2026-11-11' } }, { today: TODAY })
  expect(custom.every(e => e.date >= '2026-11-11' && e.date <= '2026-11-12')).toBe(true)
  expect(applyAgendaFilters(ev, { types: [] }, { today: TODAY })).toEqual([])
})

test('normalização e contagem de filtros ativos', () => {
  const f = normalizeAgendaFilters({ types: ['task', 'xpto'], statuses: ['done', 'bad'], period: { key: 'nope' } })
  expect(f.types).toEqual(['task'])
  expect(f.statuses).toEqual(['done'])
  expect(f.period.key).toBe('all')
  expect(activeAgendaFilterCount(normalizeAgendaFilters(EMPTY_AGENDA_FILTERS))).toBe(0)
  expect(activeAgendaFilterCount(f)).toBe(2)
  expect(normalizeAgendaFilters({}).types).toEqual(AGENDA_TYPE_KEYS)
  expect(countByType(build()).followup).toBe(2)
})

test('reagendamento: só tarefas e follow-ups abertos, nunca para o passado', () => {
  const ev = build()
  expect(canReschedule(byId(ev, 'consultation:c1')).ok).toBe(false)
  expect(canReschedule(byId(ev, 'surgery:s1')).ok).toBe(false)
  expect(canReschedule(byId(ev, 'task:t3')).ok).toBe(false) // concluída
  expect(canReschedule(byId(ev, 'opportunity:o1'), { opportunityDatesReady: false }).ok).toBe(false)

  const t1 = byId(ev, 'task:t1')
  expect(reschedulePlan(t1, '2026-11-09', undefined, { today: TODAY }).error).toMatch(/já passou/)
  expect(reschedulePlan(t1, '2026-11-14', undefined, { today: TODAY })).toEqual({ patch: { due_date: '2026-11-14' } })
  expect(reschedulePlan(t1, '2026-11-14', '15:30', { today: TODAY })).toEqual({ patch: { due_date: '2026-11-14', due_time: '15:30' } })
  expect(reschedulePlan(t1, '2026-11-12', null, { today: TODAY })).toEqual({ patch: { due_time: null } })
  expect(reschedulePlan(t1, '2026-11-12', '10:00', { today: TODAY })).toEqual({ noop: true })
  // Tarefa atrasada pode ir para hoje.
  expect(reschedulePlan(byId(ev, 'task:t2'), TODAY, undefined, { today: TODAY })).toEqual({ patch: { due_date: TODAY } })
  // Próxima ação só tem data: a hora é ignorada.
  expect(reschedulePlan(byId(ev, 'opportunity:o1'), '2026-11-15', '09:00', { today: TODAY })).toEqual({ patch: { next_action_due: '2026-11-15' } })
  expect(reschedulePlan(byId(ev, 'consultation:c1'), '2026-11-15', undefined, { today: TODAY }).error).toMatch(/Atendimentos/)
})

test('grade de horários: eventos sobrepostos ficam lado a lado', () => {
  const mk = (id, startTime, durationMinutes) => ({ id, startTime, durationMinutes, allDay: false })
  const out = layoutTimedEvents([mk('a', '09:00', 60), mk('b', '09:30', 60), mk('c', '10:30', 30), mk('d', '12:00', 30)])
  const by = Object.fromEntries(out.map(p => [p.event.id, p]))
  expect(by.a.lanes).toBe(2)
  expect(by.b.lanes).toBe(2)
  expect(by.a.lane).not.toBe(by.b.lane)
  expect(by.c).toMatchObject({ lane: 0, lanes: 1 }) // começa quando b termina: não sobrepõe
  expect(by.d).toMatchObject({ lane: 0, lanes: 1 })
})

test('datas: período, dias visíveis, navegação e fuso da clínica', () => {
  expect(periodBounds({ key: 'this_week' }, TODAY)).toEqual({ start: '2026-11-08', end: '2026-11-14' })
  expect(periodBounds({ key: 'this_month' }, TODAY)).toEqual({ start: '2026-11-01', end: '2026-11-30' })
  expect(periodBounds({ key: 'next_7' }, TODAY)).toEqual({ start: TODAY, end: '2026-11-16' })
  expect(visibleDays('week', TODAY)[0]).toBe('2026-11-08')
  expect(visibleDays('month', TODAY)).toHaveLength(42)
  expect(visibleDays('month', TODAY)[0]).toBe('2026-11-01')
  expect(shiftFocus('2026-01-31', 'month', 1)).toBe('2026-02-01')
  expect(shiftFocus(TODAY, 'week', -1)).toBe('2026-11-03')
  // 01:30 UTC de 11/11 ainda é 10/11 às 22:30 em Brasília.
  expect(clinicNow(new Date('2026-11-11T01:30:00Z'))).toEqual({ date: '2026-11-10', minutes: 22 * 60 + 30 })
})
