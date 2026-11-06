import { expect, test } from '@playwright/test'
import { dailySeries, eachDay, seriesScale } from '../../src/lib/metaSeries.js'

test('o eixo cobre o período inteiro escolhido, não só os dias com gasto', () => {
  // Buraco na série sugere "campanha não existia"; o que houve foi dia sem investimento.
  const serie = dailySeries([{ date:'2026-11-03', spend:100, leads:2 }], '2026-11-01', '2026-11-05')
  expect(serie.map(p => p.date)).toEqual(['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05'])
  expect(serie[0].spend).toBe(0)
  expect(serie[2].spend).toBe(100)
})

test('soma várias linhas do mesmo dia', () => {
  const serie = dailySeries([
    { date:'2026-11-01', spend:50, clicks:10, leads:1 },
    { date:'2026-11-01', spend:70, clicks:5, leads:2 },
  ], '2026-11-01', '2026-11-01')
  expect(serie[0]).toMatchObject({ spend:120, clicks:15, leads:3 })
})

test('CPL do dia sem lead é indefinido, não zero', () => {
  // Zero faria a linha despencar e o dia parecer o melhor do período.
  const serie = dailySeries([{ date:'2026-11-01', spend:300, leads:0 }], '2026-11-01', '2026-11-01')
  expect(serie[0].cpl).toBeNull()
  const comLead = dailySeries([{ date:'2026-11-01', spend:300, leads:6 }], '2026-11-01', '2026-11-01')
  expect(comLead[0].cpl).toBe(50)
})

test('a virada de mês e de ano não some com dias', () => {
  expect(eachDay('2026-02-27', '2026-03-02')).toEqual(['2026-02-27','2026-02-28','2026-03-01','2026-03-02'])
  expect(eachDay('2026-12-30', '2027-01-02')).toHaveLength(4)
})

test('período invertido ou inválido não gera eixo', () => {
  expect(eachDay('2026-11-10', '2026-11-01')).toEqual([])
  expect(dailySeries([], 'xx', '2026-11-01')).toEqual([])
})

test('série toda zerada avisa que não há o que desenhar', () => {
  const serie = dailySeries([], '2026-11-01', '2026-11-03')
  expect(seriesScale(serie, 'spend').hasData).toBe(false)
  expect(seriesScale(serie, 'cpl')).toBeNull()  // nenhum dia tem CPL definido
})

test('a escala ignora dias indefinidos em vez de tratá-los como zero', () => {
  const serie = dailySeries([
    { date:'2026-11-01', spend:100, leads:0 },
    { date:'2026-11-02', spend:100, leads:4 },
  ], '2026-11-01', '2026-11-02')
  expect(seriesScale(serie, 'cpl').max).toBe(25)
})
