import { expect, test } from '@playwright/test'
import {
  applyFilters, normalizeViewConfig, activeFilterCount, openTaskCounts, groupFooterSummary, groupRows, ME,
} from '../../src/lib/crmWorkspace.js'
import { resolveStages, stageMap, stageProbFractions } from '../../src/lib/crmStages.js'
import { weightedPipeline } from '../../src/lib/crmMetrics.js'
import {
  memberHandle, mentionables, extractMentions, splitMentions, mentionQueryAt, insertMention, buildThreads, mentionAlerts, memberName,
} from '../../src/lib/crmUpdates.js'

const stages = resolveStages([])
const stagesByKey = stageMap(stages)

const OPPS = [
  { id: 'o1', stage: 'orcamento_enviado', status: 'aberto', value: 25000, responsible_user_id: 'u1', probability: null },
  { id: 'o2', stage: 'orcamento_enviado', status: 'aberto', value: 12000, responsible_user_id: 'u2', probability: 80 },
  { id: 'o3', stage: 'consulta_agendada', status: 'aberto', value: null, responsible_user_id: 'u1' },
  { id: 'o4', stage: 'reserva_paga', status: 'ganho', value: 40000, responsible_user_id: 'u1' },
  { id: 'o5', stage: 'consultado', status: 'perdido', value: 9000, responsible_user_id: 'u2' },
  { id: 'o6', stage: 'consultado', status: 'arquivado', value: 1000, responsible_user_id: 'u1' },
]
const TASKS = [
  { id: 't1', opportunity_id: 'o1', status: 'pendente' },
  { id: 't2', opportunity_id: 'o1', status: 'aguardando' },
  { id: 't3', opportunity_id: 'o2', status: 'feita' },
  { id: 't4', opportunity_id: null, status: 'pendente' },
  { id: 't5', opportunity_id: 'o3', status: 'aguardando' },
]

test.describe('CRM Fase 3 — filtros das visualizações iniciais', () => {
  const ctx = { stagesByKey, userId: 'u1', openTasks: openTaskCounts(TASKS) }

  test('tarefas abertas por oportunidade contam pendente e aguardando, nunca feita/avulsa', () => {
    expect(openTaskCounts(TASKS)).toEqual({ o1: 2, o3: 1 })
  })

  test('"me" resolve para quem está vendo (visualização compartilhada "Meus leads")', () => {
    const f = { responsible: [ME], status: 'aberto' }
    expect(applyFilters(OPPS, f, ctx).map(o => o.id)).toEqual(['o1', 'o3'])
    expect(applyFilters(OPPS, f, { ...ctx, userId: 'u2' }).map(o => o.id)).toEqual(['o2'])
    // Sem usuário identificado não mostra nada (não vaza "todos").
    expect(applyFilters(OPPS, f, { ...ctx, userId: null })).toEqual([])
  })

  test('Follow-ups pendentes: só oportunidades com tarefa em aberto', () => {
    expect(applyFilters(OPPS, { openTasks: true, status: 'aberto' }, ctx).map(o => o.id)).toEqual(['o1', 'o3'])
    // Concluir a tarefa tira a oportunidade da visualização (mesmo estado, sem duplicar registro).
    const done = TASKS.map(t => (t.opportunity_id === 'o3' ? { ...t, status: 'feita' } : t))
    expect(applyFilters(OPPS, { openTasks: true, status: 'aberto' }, { ...ctx, openTasks: openTaskCounts(done) }).map(o => o.id)).toEqual(['o1'])
  })

  test('Orçamentos em negociação: etapa orçamento enviado e abertas', () => {
    expect(applyFilters(OPPS, { stage: ['orcamento_enviado'], status: 'aberto' }, ctx).map(o => o.id)).toEqual(['o1', 'o2'])
  })

  test('configuração salva preserva openTasks e "me"; contador de filtros considera openTasks', () => {
    const cfg = normalizeViewConfig({ filters: { openTasks: true, responsible: ['me'] } })
    expect(cfg.filters.openTasks).toBe(true)
    expect(cfg.filters.responsible).toEqual(['me'])
    expect(normalizeViewConfig({}).filters.openTasks).toBe(false)
    expect(activeFilterCount({ openTasks: true })).toBe(1)
  })
})

test.describe('CRM Fase 3 — rodapé de resumo do grupo', () => {
  const ctx = { stages, stagesByKey }

  test('quantidade, soma, ponderado e distribuição por status', () => {
    const rows = OPPS.filter(o => o.status !== 'arquivado')
    const f = groupFooterSummary(rows, ctx)
    expect(f.count).toBe(5)
    expect(f.valueSum).toBe(25000 + 12000 + 40000 + 9000)
    expect(f.valueCount).toBe(4)
    // Ponderado: só abertas — o1 usa a da etapa, o2 usa a própria (80%), o3 sem valor.
    const expected = 25000 * (stagesByKey.orcamento_enviado.probability / 100) + 12000 * 0.8
    expect(f.weighted).toBeCloseTo(expected, 6)
    expect(f.statusParts.map(p => [p.key, p.count])).toEqual([
      ['consulta_agendada', 1], ['orcamento_enviado', 2], ['ganho', 1], ['perdido', 1],
    ])
    expect(f.statusParts.reduce((s, p) => s + p.count, 0)).toBe(f.count)
  })

  test('ponderado do rodapé bate com o do Painel (crmMetrics.weightedPipeline)', () => {
    const f = groupFooterSummary(OPPS, ctx)
    const panel = weightedPipeline(OPPS, stageProbFractions(stages))
    expect(f.weighted).toBeCloseTo(panel.total, 6)
  })

  test('sem aberta com valor, não há ponderado (null, não zero inventado)', () => {
    expect(groupFooterSummary([OPPS[3], OPPS[2]], ctx).weighted).toBeNull()
    expect(groupFooterSummary([], ctx)).toMatchObject({ count: 0, valueSum: 0, weighted: null, statusParts: [] })
  })

  test('respeita os filtros: soma dos rodapés = soma das linhas filtradas', () => {
    const filtered = applyFilters(OPPS, { responsible: ['u1'] }, { ...ctx, userId: 'u1' })
    const groups = groupRows(filtered, 'stage', { ...ctx, keepEmptyStages: false })
    const sum = groups.reduce((s, g) => s + groupFooterSummary(g.rows, ctx).valueSum, 0)
    const count = groups.reduce((s, g) => s + groupFooterSummary(g.rows, ctx).count, 0)
    expect(count).toBe(filtered.length)
    expect(sum).toBe(filtered.reduce((s, o) => s + (Number(o.value) || 0), 0))
    // Arquivada não entra (fora do filtro "todas").
    expect(filtered.some(o => o.status === 'arquivado')).toBe(false)
  })

  test('editar valor/etapa recalcula (derivado do estado, nada armazenado)', () => {
    const before = groupFooterSummary(OPPS.slice(0, 2), ctx)
    const after = groupFooterSummary([{ ...OPPS[0], value: 30000, stage: 'reserva_paga' }, OPPS[1]], ctx)
    expect(after.valueSum - before.valueSum).toBe(5000)
    expect(after.statusParts.map(p => p.key)).toEqual(['orcamento_enviado', 'reserva_paga'])
  })
})

test.describe('CRM Fase 3 — atualizações e menções', () => {
  const members = [
    { user_id: 'u1', member_email: 'luhbentom@gmail.com' },
    { user_id: 'u2', member_email: 'Jonas.SG@gmail.com' },
    { user_id: 'u3', member_email: null },
  ]
  const people = mentionables(members)

  test('handle vem do e-mail; quem não tem e-mail não é mencionável', () => {
    expect(memberHandle(members[1])).toBe('jonas.sg')
    expect(people.map(p => p.handle)).toEqual(['jonas.sg', 'luhbentom'])
    expect(memberName({ u1: 'luhbentom@gmail.com' }, 'u1')).toBe('luhbentom')
    expect(memberName({}, 'x')).toBe('Pessoa da equipe')
  })

  test('extrai menções válidas, sem repetir e ignorando e-mails e nomes desconhecidos', () => {
    const text = '@luhbentom, veja com @Jonas.SG. Cc @luhbentom e @fulano; email a@luhbentom.com'
    expect(extractMentions(text, people)).toEqual(['u1', 'u2'])
    expect(extractMentions('sem menção', people)).toEqual([])
  })

  test('divide o texto destacando só menções válidas', () => {
    const parts = splitMentions('Oi @luhbentom e @fulano!', people)
    expect(parts).toEqual([{ text: 'Oi ' }, { text: '@luhbentom', mention: 'u1' }, { text: ' e @fulano!' }])
    expect(parts.map(p => p.text).join('')).toBe('Oi @luhbentom e @fulano!')
  })

  test('autocomplete: detecta o @ em digitação e insere o handle', () => {
    expect(mentionQueryAt('Falar com @lu', 13)).toEqual({ query: 'lu', start: 10 })
    expect(mentionQueryAt('email a@b', 9)).toBeNull()
    expect(mentionQueryAt('@', 1)).toEqual({ query: '', start: 0 })
    const r = insertMention('Falar com @lu agora', 13, 10, 'luhbentom')
    expect(r.text).toBe('Falar com @luhbentom  agora')
    expect(r.caret).toBe(21)
  })

  test('fios em ordem cronológica, respostas sob a atualização original', () => {
    const notes = [
      { id: 'n3', parent_id: 'n1', created_at: '2026-11-09T10:05:00Z', body: 'Perfeito' },
      { id: 'n1', parent_id: null, created_at: '2026-11-09T10:00:00Z', body: 'Pediu parcelamento' },
      { id: 'n2', parent_id: 'n1', created_at: '2026-11-09T10:02:00Z', body: 'Podemos oferecer' },
      { id: 'n4', created_at: '2026-11-09T11:00:00Z', body: 'Nota antiga sem parent' },
      { id: 'n5', parent_id: 'sumiu', created_at: '2026-11-09T09:00:00Z', body: 'Resposta órfã' },
    ]
    const threads = buildThreads(notes)
    expect(threads.map(t => t.id)).toEqual(['n5', 'n1', 'n4'])
    expect(threads[1].replies.map(r => r.id)).toEqual(['n2', 'n3'])
  })

  test('alerta de menção: só de outra pessoa, recente, mais nova primeiro', () => {
    const now = new Date('2026-11-09T12:00:00Z').getTime()
    const notes = [
      { id: 'a', author_id: 'u2', mentions: ['u1'], created_at: '2026-11-08T12:00:00Z' },
      { id: 'b', author_id: 'u1', mentions: ['u1'], created_at: '2026-11-09T11:00:00Z' },
      { id: 'c', author_id: 'u2', mentions: ['u2'], created_at: '2026-11-09T11:00:00Z' },
      { id: 'd', author_id: 'u2', mentions: ['u1'], created_at: '2026-09-01T12:00:00Z' },
      { id: 'e', author_id: 'u2', mentions: ['u1'], created_at: '2026-11-09T10:00:00Z' },
    ]
    expect(mentionAlerts(notes, 'u1', { now, days: 30 }).map(n => n.id)).toEqual(['e', 'a'])
    expect(mentionAlerts(notes, null, { now })).toEqual([])
  })
})
