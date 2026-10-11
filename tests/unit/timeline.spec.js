import { expect, test } from '@playwright/test'
import { buildTimeline, stageLabel } from '../../src/lib/timeline.js'

test('stageLabel traduz as chaves conhecidas', () => {
  expect(stageLabel('orcamento_enviado')).toBe('Orçamento Enviado')
  expect(stageLabel('qualquer')).toBe('qualquer')
})

test('oportunidade recém-criada → só o evento de criação', () => {
  const ev = buildTimeline({ opp: { created_at: '2026-10-08T10:00:00Z', source: 'whatsapp', status: 'aberto' } })
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ kind: 'created', icon: '⭐' })
  expect(ev[0].meta).toBe('whatsapp')
})

test('mescla todas as fontes e ordena do mais recente pro mais antigo', () => {
  const ev = buildTimeline({
    opp: { created_at: '2026-10-08T10:00:00Z', status: 'aberto' },
    stageHistory: [{ from_stage: 'primeiro_contato', to_stage: 'consulta_agendada', source: 'manual', created_at: '2026-10-09T09:00:00Z' }],
    messages: [{ direction: 'inbound', body: 'quanto custa?', created_at: '2026-10-10T08:00:00Z' }],
    tasks: [{ title: 'Ligar', status: 'feita', created_at: '2026-10-09T12:00:00Z', done_at: '2026-10-10T12:00:00Z' }],
    notes: [{ body: 'pediu desconto', created_at: '2026-10-09T15:00:00Z' }],
  })
  // 1 criada + 1 estágio + 1 msg + 2 tarefa(criada/concluída) + 1 nota = 6
  expect(ev).toHaveLength(6)
  // Ordenado desc: tarefa concluída (10/10 12:00) é o topo; criação é o fim.
  expect(ev[0].kind).toBe('task_done')
  expect(ev[ev.length - 1].kind).toBe('created')
})

test('mudança de estágio por automação é marcada', () => {
  const ev = buildTimeline({
    opp: { created_at: '2026-10-08T10:00:00Z', status: 'aberto' },
    stageHistory: [{ from_stage: null, to_stage: 'primeiro_contato', source: 'automacao', created_at: '2026-10-08T10:00:01Z' }],
  })
  const stage = ev.find(e => e.kind === 'stage')
  expect(stage.text).toContain('Entrou em Primeiro Contato')
  expect(stage.text).toContain('(automação)')
})

test('tarefa pendente gera só o evento de criação (sem concluída)', () => {
  const ev = buildTimeline({
    opp: { created_at: '2026-10-08T10:00:00Z', status: 'aberto' },
    tasks: [{ title: 'Enviar orçamento', status: 'pendente', created_at: '2026-10-09T12:00:00Z', done_at: null }],
  })
  expect(ev.filter(e => e.kind === 'task_created')).toHaveLength(1)
  expect(ev.filter(e => e.kind === 'task_done')).toHaveLength(0)
})

test('ganho/perdido viram evento de fechamento', () => {
  const won = buildTimeline({ opp: { created_at: '2026-10-08T10:00:00Z', status: 'ganho', updated_at: '2026-10-11T10:00:00Z' } })
  expect(won.find(e => e.kind === 'won')).toBeTruthy()
  const lost = buildTimeline({ opp: { created_at: '2026-10-08T10:00:00Z', status: 'perdido', updated_at: '2026-10-11T10:00:00Z', lost_reason: 'achou caro' } })
  const ev = lost.find(e => e.kind === 'lost')
  expect(ev.meta).toBe('achou caro')
})
