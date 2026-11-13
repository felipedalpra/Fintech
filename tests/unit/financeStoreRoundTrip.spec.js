import { expect, test } from '@playwright/test'
import {
  consultationFromRow,
  mapConsultationsRows,
  mapSurgeriesRows,
  surgeryFromRow,
} from '../../src/lib/financeStoreRows.js'

// Achado real (13/11/2026): um campo novo mapeado só na escrita (ou só na leitura) do Supabase
// fica "salvo" na memória do React até a página recarregar — depois disso, some em silêncio,
// porque a leitura de volta do banco não reconstrói o campo. Este teste prova que todo campo que
// mapSurgeriesRows/mapConsultationsRows escrevem, surgeryFromRow/consultationFromRow conseguem ler
// de volta sem perda — então um campo esquecido de um lado quebra aqui, não só em produção.
test('cirurgia: todo campo escrito no Supabase volta intacto na leitura', () => {
  const original = {
    id:'s1', procedureId:'p1', patient:'Ana', patientId:'pat-1', totalValue:35000,
    date:'2026-11-13', competenceDate:'2026-11-13', dueDate:'2026-11-20',
    startTime:'09:00', durationMinutes:180, paymentMethod:'pix', paymentStatus:'pendente',
    surgeon:'Dra. Vitória', paymentDate:'',
    hospitalCost:100, anesthesiaCost:200, materialCost:300,
    instrumentationCost:400, prosthesisCost:5000, otherCosts:50,
    thirdPartyPassthroughValue:19000, customProcedureName:'Mamoplastia + Braquioplastia',
    city:'goiania', locationDetail:'Hospital Teste, sala 1',
    invoiceIssuancePercent:10, invoiceTaxRate:10, invoiceTaxAmount:3500,
    costSettlements:{ hospital_cost:{ status:'pendente' } }, receiptSettlements:{},
    notes:'Observação de teste',
  }

  const [row] = mapSurgeriesRows('user-1', { surgeries:[original] })
  const roundTripped = surgeryFromRow(row)

  expect(roundTripped).toEqual(original)
})

test('consulta: todo campo escrito no Supabase volta intacto na leitura', () => {
  const original = {
    id:'c1', patient:'Bia', patientId:'pat-2', date:'2026-11-13',
    startTime:'10:00', durationMinutes:60, consultationType:'avaliacao',
    city:'brasilia', locationDetail:'Consultório X',
    value:400, paymentType:'particular', paymentMethod:'pix',
    invoiceIssuancePercent:5, invoiceTaxRate:5, invoiceTaxAmount:20,
    costSettlements:{}, receiptSettlements:{},
    insurance:'', paymentStatus:'pago', forecastPaymentDate:'2026-11-13',
    paymentDate:'2026-11-13', competenceDate:'2026-11-13', dueDate:'2026-11-13',
  }

  const [row] = mapConsultationsRows('user-1', { consultations:[original] })
  const roundTripped = consultationFromRow(row)

  expect(roundTripped).toEqual(original)
})
