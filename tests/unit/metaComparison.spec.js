import { expect, test } from '@playwright/test'
import { buildFindings, compareMetric, LOWER_IS_BETTER, previousPeriod } from '../../src/lib/metaComparison.js'

test('o período anterior tem a mesma duração e não encosta no atual', () => {
  expect(previousPeriod('2026-11-01', '2026-11-07')).toEqual({ start:'2026-10-25', end:'2026-10-31', days:7 })
  expect(previousPeriod('2026-11-05', '2026-11-05')).toEqual({ start:'2026-11-04', end:'2026-11-04', days:1 })
})

test('a virada de mês e de ano não desloca o período anterior', () => {
  expect(previousPeriod('2026-03-01', '2026-03-31').end).toBe('2026-02-28')
  expect(previousPeriod('2027-01-01', '2027-01-10')).toEqual({ start:'2026-12-22', end:'2026-12-31', days:10 })
})

test('período inválido não vira comparação inventada', () => {
  expect(previousPeriod('2026-11-10', '2026-11-01')).toBeNull()
  expect(previousPeriod('xx', '2026-11-01')).toBeNull()
})

test('sem base anterior a variação é indefinida, nunca "+100%"', () => {
  // Sair de 0 para 10 é estreia, não crescimento de 100%.
  expect(compareMetric('leads', 10, 0)).toEqual({ pct:null, direction:'flat', good:null })
  expect(compareMetric('leads', 10, null)).toEqual({ pct:null, direction:'flat', good:null })
})

test('em métrica de custo, cair é bom; em métrica de resultado, subir é bom', () => {
  // É o que impede a seta verde significar coisas opostas em colunas vizinhas.
  const cplCaiu = compareMetric('cpl', 40, 50)
  expect(cplCaiu.direction).toBe('down')
  expect(cplCaiu.good).toBe(true)

  const cplSubiu = compareMetric('cpl', 60, 50)
  expect(cplSubiu.good).toBe(false)

  const leadsSubiu = compareMetric('leads', 15, 10)
  expect(leadsSubiu.direction).toBe('up')
  expect(leadsSubiu.good).toBe(true)

  const leadsCaiu = compareMetric('leads', 5, 10)
  expect(leadsCaiu.good).toBe(false)

  expect(LOWER_IS_BETTER.has('cpl')).toBe(true)
  expect(LOWER_IS_BETTER.has('leads')).toBe(false)
})

test('variação ínfima é tratada como estável, sem seta', () => {
  expect(compareMetric('leads', 100.01, 100).direction).toBe('flat')
  expect(compareMetric('leads', 100.01, 100).good).toBeNull()
})

const campanha = (ref_id, extra) => ({ ref_id, name:`C ${ref_id}`, spend:1000, leads:10, cpl:100, ctr:1, ...extra })

test('aponta o menor CPL e o melhor CTR com o número que sustenta', () => {
  const achados = buildFindings({ current:[
    campanha('a', { cpl:50, leads:20, ctr:0.8 }),
    campanha('b', { cpl:150, leads:5, ctr:3.2 }),
  ] })
  const cpl = achados.find(item => item.kind === 'melhor_cpl')
  const ctr = achados.find(item => item.kind === 'melhor_ctr')
  expect(cpl.ref_id).toBe('a')
  expect(cpl.value).toBe(50)
  expect(ctr.ref_id).toBe('b')
  expect(ctr.value).toBe(3.2)
})

test('campanha sem lead nenhum NÃO é eleita a de melhor CPL', () => {
  // Gastar e não gerar lead daria CPL indefinido; tratar como 0 a colocaria em primeiro lugar.
  const achados = buildFindings({ current:[
    campanha('zerada', { cpl:null, leads:0 }),
    campanha('boa', { cpl:80, leads:12 }),
  ] })
  expect(achados.find(item => item.kind === 'melhor_cpl').ref_id).toBe('boa')
})

test('gasto sem resultado vira achado acionável', () => {
  const achados = buildFindings({ current:[campanha('x', { leads:0, cpl:null, spend:800 })] })
  const sem = achados.find(item => item.kind === 'sem_resultado')
  expect(sem.tone).toBe('bad')
  expect(sem.value).toBe(800)
})

test('alta de custo só é declarada quando existe período anterior de verdade', () => {
  const current = [campanha('a', { cpl:150 })]
  // Sem anterior: nada a declarar.
  expect(buildFindings({ current }).some(item => item.kind === 'cpl_subindo')).toBe(false)
  // Com anterior e alta acima do limite: declara, com o percentual.
  const achados = buildFindings({ current, previous:[campanha('a', { cpl:100 })] })
  const alta = achados.find(item => item.kind === 'cpl_subindo')
  expect(Math.round(alta.pct)).toBe(50)
})

test('campanha com gasto irrelevante não polui as análises', () => {
  expect(buildFindings({ current:[campanha('centavos', { spend:0.4 })] })).toEqual([])
  expect(buildFindings({ current:[] })).toEqual([])
})
