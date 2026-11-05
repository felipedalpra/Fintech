import { expect, test } from '@playwright/test'
import {
  groupTasksByUrgency, isValidTaskOutcome, isValidTaskType, queueSections,
  TASK_OUTCOMES, TASK_TYPES, taskContextLabel, taskUrgency,
} from '../../src/lib/taskQueue.js'

const HOJE = '2026-11-05'
const tarefa = (id, due_date, extra = {}) => ({ id, title:`T${id}`, due_date, status:'pendente', ...extra })

test('a urgência separa atrasada, hoje, próximos 7 dias e depois', () => {
  expect(taskUrgency(tarefa(1, '2026-11-04'), HOJE)).toBe('atrasada')
  expect(taskUrgency(tarefa(2, '2026-11-05'), HOJE)).toBe('hoje')
  expect(taskUrgency(tarefa(3, '2026-11-06'), HOJE)).toBe('semana')
  expect(taskUrgency(tarefa(4, '2026-11-12'), HOJE)).toBe('semana')
  expect(taskUrgency(tarefa(5, '2026-11-13'), HOJE)).toBe('depois')
  expect(taskUrgency(tarefa(6, null), HOJE)).toBe('sem_data')
})

test('tarefa feita sai da fila mesmo estando atrasada', () => {
  // Concluída não é trabalho pendente: deixá-la em "Atrasadas" entupiria a fila.
  expect(taskUrgency(tarefa(1, '2026-01-01', { status:'feita' }), HOJE)).toBe('feita')
  const groups = groupTasksByUrgency([tarefa(1, '2026-01-01', { status:'feita' })], HOJE)
  expect(groups.atrasadas).toHaveLength(0)
  expect(groups.feitas).toHaveLength(1)
})

test('a virada do mês e do ano não desloca o agrupamento', () => {
  // Comparação por string ISO: aritmética de Date com fuso já errou isso em outras telas.
  expect(taskUrgency(tarefa(1, '2026-12-01'), '2026-11-30')).toBe('semana')
  expect(taskUrgency(tarefa(2, '2026-11-30'), '2026-12-01')).toBe('atrasada')
  expect(taskUrgency(tarefa(3, '2027-01-01'), '2026-12-31')).toBe('semana')
  expect(taskUrgency(tarefa(4, '2026-12-31'), '2027-01-01')).toBe('atrasada')
})

test('data com hora completa (timestamp) é tratada pelo dia', () => {
  expect(taskUrgency(tarefa(1, '2026-11-05T23:59:00Z'), HOJE)).toBe('hoje')
})

test('dentro do grupo, mais cedo primeiro; sem hora vem depois de quem tem hora', () => {
  const groups = groupTasksByUrgency([
    tarefa('sem-hora', HOJE),
    tarefa('tarde', HOJE, { due_time:'14:00' }),
    tarefa('manha', HOJE, { due_time:'09:00' }),
  ], HOJE)
  expect(groups.hoje.map(task => task.id)).toEqual(['manha', 'tarde', 'sem-hora'])
})

test('atrasadas saem da mais antiga para a mais recente', () => {
  const groups = groupTasksByUrgency([
    tarefa('ontem', '2026-11-04'), tarefa('semana-passada', '2026-10-29'),
  ], HOJE)
  expect(groups.atrasadas.map(task => task.id)).toEqual(['semana-passada', 'ontem'])
})

test('seção vazia não vira cabeçalho, e a ordem é a de ataque', () => {
  const groups = groupTasksByUrgency([tarefa(1, '2026-11-04'), tarefa(2, HOJE)], HOJE)
  expect(queueSections(groups).map(section => section.key)).toEqual(['atrasadas', 'hoje'])
  expect(queueSections(groupTasksByUrgency([], HOJE))).toEqual([])
})

test('o contexto diz de quem é a tarefa sem precisar abrir', () => {
  expect(taskContextLabel({ patients:{ full_name:'Katia Z Martins' }, opportunities:{ title:'Mamoplastia' } }))
    .toBe('Katia Z Martins · Mamoplastia')
  // "Oportunidade" é o título genérico padrão: repetir isso não informa nada.
  expect(taskContextLabel({ patients:{ full_name:'Ana' }, opportunities:{ title:'Oportunidade' } })).toBe('Ana')
  expect(taskContextLabel({ crm_contacts:{ full_name:'Lead novo' } })).toBe('Lead novo')
  expect(taskContextLabel({})).toBe('')
  expect(taskContextLabel(null)).toBe('')
})

test('tipos e desfechos são fechados — a tela não pode inventar valor que o banco recusa', () => {
  expect(isValidTaskType('ligar')).toBe(true)
  expect(isValidTaskType('telepatia')).toBe(false)
  expect(isValidTaskOutcome('nao_atendeu')).toBe(true)
  expect(isValidTaskOutcome('talvez')).toBe(false)
  expect(new Set(TASK_TYPES.map(item => item.key)).size).toBe(TASK_TYPES.length)
  expect(new Set(TASK_OUTCOMES.map(item => item.key)).size).toBe(TASK_OUTCOMES.length)
})

test('desfecho que NÃO encerra mantém a tarefa viva', () => {
  // "Não atendeu" e "remarcou" não podem fechar a tarefa: o trabalho continua pendente.
  const naoEncerram = TASK_OUTCOMES.filter(item => !item.closes).map(item => item.key)
  expect(naoEncerram).toEqual(['nao_atendeu', 'remarcou'])
})

test('lista vazia ou suja não quebra a fila', () => {
  expect(groupTasksByUrgency(undefined, HOJE).hoje).toEqual([])
  expect(groupTasksByUrgency([null, undefined], HOJE).semData).toEqual([])
})
