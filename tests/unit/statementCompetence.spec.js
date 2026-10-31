import { expect, test } from '@playwright/test'
import { applyCompetenceChoice, withCompetenceDate } from '../../src/lib/statementImportReview.js'

// A conciliação cria lançamento a partir de uma linha do extrato. O extrato é
// data de CAIXA; a competência manda no DRE. Decisão do Felipe (31/10/2026):
// a competência assume a data do extrato por padrão, e quem aprova pode mudar.

const novoItem = (postedDate, amount = 100) => ({
  reviewStatus:'new',
  line:{ id:'l1', amount, postedDate },
  proposal:{
    collection:'extraRevenues',
    record:{
      id:'l1', value:amount,
      competenceDate:postedDate,
      dueDate:postedDate,
      date:postedDate,
      receivedDate:postedDate,
      status:'recebido',
    },
  },
})

test('sem escolha, a competência continua sendo a data do extrato', () => {
  const items = [novoItem('2026-10-01')]
  const resultado = applyCompetenceChoice(items, { mode:'line' })
  expect(resultado[0].proposal.record.competenceDate).toBe('2026-10-01')
  expect(resultado).toBe(items)
})

test('competência informada muda SÓ a competência, nunca as datas de caixa', () => {
  // Trocar vencimento ou data de caixa junto quebraria a regra das três datas:
  // o fluxo de caixa passaria a divergir do extrato que o originou.
  const [resultado] = applyCompetenceChoice([novoItem('2026-10-05')], {
    mode:'fixed', competenceDate:'2026-09-30',
  })
  const registro = resultado.proposal.record
  expect(registro.competenceDate).toBe('2026-09-30')
  expect(registro.dueDate).toBe('2026-10-05')
  expect(registro.date).toBe('2026-10-05')
  expect(registro.receivedDate).toBe('2026-10-05')
  expect(registro.status).toBe('recebido')
})

test('a despesa também preserva a data de pagamento', () => {
  const despesa = {
    reviewStatus:'new',
    line:{ id:'l2', amount:-50, postedDate:'2026-10-05' },
    proposal:{
      collection:'expenses',
      record:{ id:'l2', value:50, competenceDate:'2026-10-05', dueDate:'2026-10-05', paymentDate:'2026-10-05', status:'pago' },
    },
  }
  const [resultado] = applyCompetenceChoice([despesa], { mode:'fixed', competenceDate:'2026-09-01' })
  expect(resultado.proposal.record.competenceDate).toBe('2026-09-01')
  expect(resultado.proposal.record.paymentDate).toBe('2026-10-05')
  expect(resultado.proposal.record.status).toBe('pago')
})

test('linha que não é lançamento novo passa intacta', () => {
  // Uma linha apenas VINCULADA a um lançamento existente não pode ter a
  // competência daquele lançamento reescrita pela conciliação.
  const vinculo = { reviewStatus:'existing', line:{ id:'l3' }, proposal:{ record:{ competenceDate:'2026-01-01' } } }
  const [resultado] = applyCompetenceChoice([vinculo], { mode:'fixed', competenceDate:'2026-09-01' })
  expect(resultado.proposal.record.competenceDate).toBe('2026-01-01')
})

test('data inválida é recusada em vez de gravar lixo no DRE', () => {
  expect(() => applyCompetenceChoice([novoItem('2026-10-01')], { mode:'fixed', competenceDate:'31/10/2026' }))
    .toThrow('Data de competência inválida.')
  expect(() => withCompetenceDate(novoItem('2026-10-01'), 'ontem')).toThrow('Data de competência inválida.')
})

test('competência igual à do extrato não é marcada como alterada', () => {
  const [igual] = applyCompetenceChoice([novoItem('2026-10-01')], { mode:'fixed', competenceDate:'2026-10-01' })
  expect(igual.proposal.competenceOverridden).toBe(false)
  const [diferente] = applyCompetenceChoice([novoItem('2026-10-01')], { mode:'fixed', competenceDate:'2026-09-01' })
  expect(diferente.proposal.competenceOverridden).toBe(true)
})
