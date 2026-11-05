import { expect, test } from '@playwright/test'
import { buildRevenueOrigins, foldRevenueOriginTail, REVENUE_ORIGIN_COLORS, revenueGroupLabel } from '../../src/lib/revenueByOrigin.js'

// Espelha o plano de contas real: raiz "Receita bruta" → grupo "Cirurgias" → conta.
const PATHS = {
  'acc-cirurgia-combinada':[{ name:'Receita bruta' }, { name:'Cirurgias' }, { name:'Cirurgia combinada' }],
  'acc-outras-cirurgias':[{ name:'Receita bruta' }, { name:'Cirurgias' }, { name:'Outras cirurgias' }],
  'acc-consulta':[{ name:'Receita bruta' }, { name:'Consultas' }, { name:'Consulta de cirurgia plástica' }],
  'acc-classificar':[{ name:'Receita bruta' }, { name:'Outras receitas operacionais' }, { name:'Receita a classificar' }],
}
const pathOf = id => PATHS[id] || []

test('receita de cirurgia lançada como "Outra receita" conta em Cirurgias', () => {
  // Era o bug: entrava em Outras porque o tipo do registro é extra_revenue.
  const entry = { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000 }
  expect(revenueGroupLabel(entry, pathOf)).toBe('Cirurgias')
})

test('lançamento sem conta contábil cai no rótulo do tipo de registro', () => {
  expect(revenueGroupLabel({ sourceType:'surgery', chartAccountId:null, value:1 }, pathOf)).toBe('Cirurgias')
  expect(revenueGroupLabel({ sourceType:'consultation', value:1 }, pathOf)).toBe('Consultas')
  expect(revenueGroupLabel({ sourceType:'product_sale', value:1 }, pathOf)).toBe('Venda de produtos')
  expect(revenueGroupLabel({ sourceType:'extra_revenue', value:1 }, pathOf)).toBe('Outras receitas')
  expect(revenueGroupLabel({ sourceType:'recurrence', value:1 }, pathOf)).toBe('Outras receitas')
  expect(revenueGroupLabel({ value:1 }, pathOf)).toBe('Outras receitas')
})

test('conta de outro grupo não vaza para Cirurgias', () => {
  expect(revenueGroupLabel({ chartAccountId:'acc-consulta', value:1 }, pathOf)).toBe('Consultas')
  expect(revenueGroupLabel({ chartAccountId:'acc-classificar', value:1 }, pathOf)).toBe('Outras receitas operacionais')
})

test('a SOMA das barras continua sendo a receita bruta — nenhum valor nasce nem some', () => {
  const entries = [
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000 },
    { sourceType:'extra_revenue', chartAccountId:'acc-outras-cirurgias', value:17955 },
    { sourceType:'extra_revenue', chartAccountId:'acc-classificar', value:220 },
    { sourceType:'consultation', chartAccountId:'acc-consulta', value:4800 },
    { sourceType:'surgery', chartAccountId:null, value:1000 },
  ]
  const origins = buildRevenueOrigins(entries, pathOf)
  const soma = origins.reduce((acc, item) => acc + item.value, 0)
  expect(soma).toBe(30975)
  expect(origins[0].total).toBe(30975)
  expect(origins.reduce((acc, item) => acc + item.pct, 0)).toBeCloseTo(100, 6)
})

test('as duas contas de cirurgia somam numa barra só, e a cirurgia cadastrada entra junto', () => {
  const entries = [
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000 },
    { sourceType:'extra_revenue', chartAccountId:'acc-outras-cirurgias', value:17955 },
    { sourceType:'surgery', chartAccountId:null, value:1000 },
    { sourceType:'consultation', chartAccountId:'acc-consulta', value:4800 },
  ]
  const origins = buildRevenueOrigins(entries, pathOf)
  const cirurgias = origins.find(item => item.label === 'Cirurgias')
  expect(cirurgias.value).toBe(25955)
  expect(cirurgias.entries).toHaveLength(3)
})

test('maior primeiro, para o painel responder de onde vem o dinheiro', () => {
  const origins = buildRevenueOrigins([
    { sourceType:'consultation', chartAccountId:'acc-consulta', value:4800 },
    { sourceType:'extra_revenue', chartAccountId:'acc-outras-cirurgias', value:17955 },
  ], pathOf)
  expect(origins.map(item => item.label)).toEqual(['Cirurgias', 'Consultas'])
})

test('grupo sem receita não vira barra vazia', () => {
  const origins = buildRevenueOrigins([
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000 },
    { sourceType:'extra_revenue', chartAccountId:'acc-consulta', value:0 },
  ], pathOf)
  expect(origins.map(item => item.label)).toEqual(['Cirurgias'])
})

test('entrada vazia ou suja não quebra nem inventa total', () => {
  expect(buildRevenueOrigins([], pathOf)).toEqual([])
  expect(buildRevenueOrigins(undefined, pathOf)).toEqual([])
  expect(buildRevenueOrigins([null, { value:'abc' }, { value:NaN }], pathOf)).toEqual([])
})

test('sem resolvedor de plano de contas, tudo cai no tipo do registro', () => {
  const origins = buildRevenueOrigins([
    { sourceType:'surgery', chartAccountId:'acc-cirurgia-combinada', value:1000 },
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:500 },
  ], null)
  expect(origins.map(item => item.label)).toEqual(['Cirurgias', 'Outras receitas'])
})

test('reproduz a tela do cliente: 3 cirurgias importadas deixam de aparecer como Outras', () => {
  // Caso real (05/11/2026): o painel mostrava "Cirurgias 0,0% R$ 0,00" logo acima de uma tabela
  // com R$ 7.000 + R$ 17.955 + R$ 7.000 classificados em contas do grupo 4.01 Cirurgias.
  const entries = [
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000, description:'KATIA Z MARTINS' },
    { sourceType:'extra_revenue', chartAccountId:'acc-outras-cirurgias', value:17955, description:'CREDITO PIX - MAIS S GRAFICAS LTDA' },
    { sourceType:'extra_revenue', chartAccountId:'acc-classificar', value:220, description:'CREDITO PIX - Sumary Bonifacio' },
    { sourceType:'extra_revenue', chartAccountId:'acc-cirurgia-combinada', value:7000, description:'KATIA Z MARTINS' },
  ]
  const origins = buildRevenueOrigins(entries, pathOf)
  const cirurgias = origins.find(item => item.label === 'Cirurgias')

  expect(cirurgias).toBeTruthy()
  expect(cirurgias.value).toBe(31955)
  expect(cirurgias.pct).toBeGreaterThan(99)
  // E o que de fato não é cirurgia continua fora.
  expect(origins.find(item => item.label === 'Outras receitas operacionais').value).toBe(220)
})

test('a cauda vira um bloco "Outros" sem mudar o total', () => {
  const origins = buildRevenueOrigins([
    { chartAccountId:'g1', value:100 }, { chartAccountId:'g2', value:90 }, { chartAccountId:'g3', value:80 },
    { chartAccountId:'g4', value:70 }, { chartAccountId:'g5', value:60 }, { chartAccountId:'g6', value:50 },
    { chartAccountId:'g7', value:40 },
  ], id => [{ name:'Receita bruta' }, { name:`Grupo ${id}` }, { name:'Conta' }])

  const folded = foldRevenueOriginTail(origins)
  expect(folded).toHaveLength(6)
  expect(folded.at(-1).label).toBe('Outros')
  expect(folded.at(-1).value).toBe(90)
  expect(folded.at(-1).foldedLabels).toEqual(['Grupo g6', 'Grupo g7'])
  // A invariante que mais importa: dobrar a cauda não cria nem destrói receita.
  expect(folded.reduce((acc, item) => acc + item.value, 0)).toBe(490)
  expect(folded.reduce((acc, item) => acc + item.pct, 0)).toBeCloseTo(100, 6)
})

test('"Outros" carrega os lançamentos que saíram das barras nomeadas, para o clique abrir o detalhe', () => {
  const origins = buildRevenueOrigins([
    { chartAccountId:'g1', value:100, id:'a' }, { chartAccountId:'g2', value:90, id:'b' },
    { chartAccountId:'g3', value:80, id:'c' }, { chartAccountId:'g4', value:70, id:'d' },
    { chartAccountId:'g5', value:60, id:'e' }, { chartAccountId:'g6', value:50, id:'f' },
  ], id => [{ name:'R' }, { name:`G${id}` }, { name:'C' }])
  const folded = foldRevenueOriginTail(origins)
  expect(folded.at(-1).entries.map(entry => entry.id)).toEqual(['f'])
})

test('com 5 grupos ou menos ninguém é dobrado, e cada um recebe a cor da ordem validada', () => {
  const origins = buildRevenueOrigins([
    { chartAccountId:'g1', value:100 }, { chartAccountId:'g2', value:90 },
  ], id => [{ name:'R' }, { name:`G${id}` }, { name:'C' }])
  const folded = foldRevenueOriginTail(origins)
  expect(folded).toHaveLength(2)
  expect(folded.every(item => item.isTail === false)).toBe(true)
  expect(folded.map(item => item.color)).toEqual([REVENUE_ORIGIN_COLORS[0], REVENUE_ORIGIN_COLORS[1]])
})

test('a ordem de cores é fixa: a cor segue a posição, nunca é gerada', () => {
  expect(REVENUE_ORIGIN_COLORS).toHaveLength(5)
  expect(new Set(REVENUE_ORIGIN_COLORS).size).toBe(5)
})

test('lista vazia não vira bloco Outros fantasma', () => {
  expect(foldRevenueOriginTail([])).toEqual([])
  expect(foldRevenueOriginTail(undefined)).toEqual([])
})
