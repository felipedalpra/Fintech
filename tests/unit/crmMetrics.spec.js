import { expect, test } from '@playwright/test'
import {
  STAGE_PROB, funnelCounts, weightedPipeline, leadsBySource,
  byResponsible, lossReasons, avgDaysPerStage, crmKpis,
} from '../../src/lib/crmMetrics.js'

const ORDER = ['primeiro_contato', 'consulta_agendada', 'consultado', 'orcamento_enviado', 'reserva_paga', 'cirurgia_feita']

const OPPS = [
  { id: 'A', status: 'aberto', stage: 'consultado', value: 10000, source: 'instagram', responsible_user_id: 'u1' },
  { id: 'B', status: 'aberto', stage: 'orcamento_enviado', value: 20000, source: 'instagram', responsible_user_id: 'u1' },
  { id: 'C', status: 'ganho', stage: 'cirurgia_feita', value: 19000, source: 'indicacao', responsible_user_id: 'u2' },
  { id: 'D', status: 'perdido', stage: 'consulta_agendada', value: 8000, source: 'instagram', responsible_user_id: 'u2', lost_reason: 'achou caro' },
  { id: 'E', status: 'aberto', stage: 'primeiro_contato', value: null, source: null, responsible_user_id: null },
]

test('funnelCounts conta alcance por etapa e conversão entre etapas', () => {
  const f = funnelCounts(OPPS, ORDER)
  expect(f.map(x => x.reached)).toEqual([5, 4, 3, 2, 1, 1])
  expect(f[0].conv).toBeNull()
  expect(f[1].conv).toBeCloseTo(0.8, 3)
  expect(f[2].conv).toBeCloseTo(0.75, 3)
  expect(f[4].conv).toBeCloseTo(0.5, 3)
})

test('funnelCounts: oportunidade em follow_up (fora da ordem) conta como alcançou tudo', () => {
  const opps = [
    { id: 'A', status: 'aberto', stage: 'primeiro_contato' },
    { id: 'B', status: 'aberto', stage: 'follow_up' }, // pós-venda, fora do STAGE_ORDER
  ]
  const f = funnelCounts(opps, ORDER)
  expect(f[0].reached).toBe(2)                  // bate com o total de leads
  expect(f[ORDER.length - 1].reached).toBe(1)   // só B chegou ao fim
})

test('weightedPipeline soma só abertas (valor × probabilidade)', () => {
  const p = weightedPipeline(OPPS)
  // A: 10000*0.4=4000 ; B: 20000*0.6=12000 ; E: 0 → 16000, 3 abertas
  expect(p.total).toBeCloseTo(16000, 2)
  expect(p.count).toBe(3)
})

test('leadsBySource agrupa com total/ganhos/conversão; null vira "sem origem"', () => {
  const s = leadsBySource(OPPS)
  const inst = s.find(x => x.source === 'instagram')
  expect(inst.total).toBe(3)
  expect(inst.won).toBe(0)
  expect(inst.conv).toBeCloseTo(0, 3)
  const ind = s.find(x => x.source === 'indicacao')
  expect(ind).toMatchObject({ total: 1, won: 1 })
  expect(ind.conv).toBeCloseTo(1, 3)
  expect(s.find(x => x.source === 'sem origem').total).toBe(1)
  expect(s[0].source).toBe('instagram') // ordenado por total desc
})

test('byResponsible agrupa por responsável (total/ganhos/conversão)', () => {
  const r = byResponsible(OPPS)
  const u1 = r.find(x => x.userId === 'u1')
  expect(u1).toMatchObject({ total: 2, won: 0 })
  const u2 = r.find(x => x.userId === 'u2')
  expect(u2).toMatchObject({ total: 2, won: 1 })
  expect(u2.conv).toBeCloseTo(0.5, 3)
})

test('lossReasons conta só perdidas, por motivo, desc', () => {
  const l = lossReasons([...OPPS, { id: 'F', status: 'perdido', lost_reason: 'achou caro' }, { id: 'G', status: 'perdido', lost_reason: null }])
  expect(l.find(x => x.reason === 'achou caro').count).toBe(2)
  expect(l.find(x => x.reason === 'sem motivo').count).toBe(1)
  expect(l[0].count).toBeGreaterThanOrEqual(l[l.length - 1].count) // desc
})

test('avgDaysPerStage calcula a média de dias entre transições', () => {
  const hist = [
    { opportunity_id: 'x', from_stage: null, to_stage: 'primeiro_contato', created_at: '2026-10-01T00:00:00Z' },
    { opportunity_id: 'x', from_stage: 'primeiro_contato', to_stage: 'consulta_agendada', created_at: '2026-10-03T00:00:00Z' },
    { opportunity_id: 'x', from_stage: 'consulta_agendada', to_stage: 'consultado', created_at: '2026-10-04T00:00:00Z' },
  ]
  const a = avgDaysPerStage(hist)
  expect(a.primeiro_contato).toBeCloseTo(2, 3)
  expect(a.consulta_agendada).toBeCloseTo(1, 3)
})

test('crmKpis resume leads/ganhos/perdidos/conversão/ticket', () => {
  const k = crmKpis(OPPS)
  expect(k.leads).toBe(5)
  expect(k.won).toBe(1)
  expect(k.lost).toBe(1)
  expect(k.convRate).toBeCloseTo(1 / 5, 3) // ganhos / leads
  expect(k.avgTicket).toBeCloseTo(19000, 2)
})

test('STAGE_PROB tem probabilidade para cada etapa do funil', () => {
  for (const s of ORDER) expect(typeof STAGE_PROB[s]).toBe('number')
})
