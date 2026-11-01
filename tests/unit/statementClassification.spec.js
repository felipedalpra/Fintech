import { expect, test } from '@playwright/test'
import { linesWithSameDescription, proposalForStatementLine } from '../../src/lib/statementImportReview.js'

// O extrato em PDF do BRB não traz categoria nenhuma. Sem classificar na linha,
// TODA linha cai em "precisa revisar", sai da seleção em lote, e conciliar 178
// lançamentos vira abrir 178 formulários.

const contas = [
  { id:'rec-1', name:'Outras receitas operacionais', nature:'revenue', node_type:'account', is_active:true },
  { id:'desp-1', name:'Tarifas bancárias', nature:'operating_expense', node_type:'account', is_active:true },
]

let proximoId = 0
const linha = (amount, description, extra = {}) => ({
  // id proprio por linha: duas tarifas iguais no mesmo dia sao dois movimentos
  // distintos, e e justamente esse caso que o extrato do BRB produz.
  id:`l${proximoId += 1}`,
  amount,
  description,
  normalized_description:description,
  postedDate:'2026-10-01',
  source_metadata:{ bank:'BRB' },
  ...extra,
})

test('sem classificação, a linha do extrato exige revisão', () => {
  const proposta = proposalForStatementLine(linha(100, 'CREDITO PIX'), contas, 'extrato.pdf')
  expect(proposta.requiresReview).toBe(true)
  expect(proposta.reasons.join(' ')).toContain('Categoria ausente')
  expect(proposta.classifiedByHand).toBe(false)
})

test('classificada à mão, a linha deixa de exigir revisão e entra no lote', () => {
  const proposta = proposalForStatementLine(linha(100, 'CREDITO PIX'), contas, 'extrato.pdf', {
    chartAccountId:'rec-1', category:'Outras receitas operacionais',
  })
  expect(proposta.requiresReview).toBe(false)
  expect(proposta.classifiedByHand).toBe(true)
  expect(proposta.record.chartAccountId).toBe('rec-1')
  expect(proposta.accountName).toBe('Outras receitas operacionais')
})

test('a classificação manual vence a suspeita de transferência interna', () => {
  // A heurística existe para linha SEM classificação. Insistir nela depois
  // seria o sistema discordando de uma decisão humana explícita.
  const semClassificar = proposalForStatementLine(linha(100, 'CRED PIX INTERNO'), contas, 'extrato.pdf')
  expect(semClassificar.reasons.join(' ')).toContain('transferência entre contas')

  const classificada = proposalForStatementLine(linha(100, 'CRED PIX INTERNO'), contas, 'extrato.pdf', {
    chartAccountId:'rec-1', category:'Outras receitas operacionais',
  })
  expect(classificada.reasons.join(' ')).not.toContain('transferência entre contas')
})

test('uma conta incompatível com o sentido da linha não é aceita', () => {
  // Classificar uma ENTRADA numa conta de despesa inverteria o sinal no DRE.
  const proposta = proposalForStatementLine(linha(100, 'CREDITO PIX'), contas, 'extrato.pdf', {
    chartAccountId:'desp-1', category:'Tarifas bancárias',
  })
  expect(proposta.record.chartAccountId).not.toBe('desp-1')
})

// --------------------------------------------------------------------------
// Aplicar às linhas iguais
// --------------------------------------------------------------------------

const item = (line, reviewStatus = 'new', processing = false) => ({ line, reviewStatus, processing })

test('alcança as linhas com a mesma descrição e o mesmo sentido', () => {
  const alvo = linha(-9, 'TARIFA ENVIO VALORES PIX')
  const itens = [
    item(alvo),
    item(linha(-9, 'TARIFA ENVIO VALORES PIX')),
    item(linha(-15, 'TARIFA ENVIO VALORES PIX')),   // valor diferente: mesma categoria
    item(linha(-9, 'DEBITO PIX')),                  // outra descrição
  ]
  const ids = linesWithSameDescription(itens, alvo.id)
  expect(ids).toHaveLength(2)
  expect(ids).not.toContain(alvo.id)
})

test('não atravessa o sentido: entrada não herda classificação de saída', () => {
  // Uma devolução de PIX com a mesma descrição é receita. Classificá-la como
  // despesa inverteria o sinal no DRE.
  const alvo = linha(-9, 'PIX')
  const ids = linesWithSameDescription([item(alvo), item(linha(9, 'PIX'))], alvo.id)
  expect(ids).toEqual([])
})

test('não alcança linha conciliada, ignorada ou em processamento', () => {
  const alvo = linha(-9, 'TARIFA')
  const ids = linesWithSameDescription([
    item(alvo),
    item(linha(-9, 'TARIFA'), 'reconciled'),
    item(linha(-9, 'TARIFA'), 'ignored'),
    item(linha(-9, 'TARIFA'), 'new', true),
  ], alvo.id)
  expect(ids).toEqual([])
})

test('referência inexistente ou descrição vazia não alcança nada', () => {
  expect(linesWithSameDescription([], 'nada')).toEqual([])
  const vazia = linha(-9, '')
  expect(linesWithSameDescription([item(vazia)], vazia.id)).toEqual([])
})
