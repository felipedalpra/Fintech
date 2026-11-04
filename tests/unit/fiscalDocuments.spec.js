import { expect, test } from '@playwright/test'
import { financialEntryKey, fiscalDocumentLabel, fiscalDocumentsSearchText, fiscalTargetFromMetric, fiscalTargetFromModal, matchesFiscalFilter } from '../../src/lib/fiscalDocuments.js'

test.describe('documentos fiscais financeiros', () => {
  test('usa a identidade do título, fazendo todas as parcelas herdarem a mesma nota', () => {
    const first = fiscalTargetFromMetric({ sourceType:'surgery', sourceId:'cirurgia-1', sourceComponent:'revenue', installmentNumber:1, installmentsTotal:3, value:100 })
    const third = fiscalTargetFromMetric({ sourceType:'surgery', sourceId:'cirurgia-1', sourceComponent:'revenue', installmentNumber:3, installmentsTotal:3, value:100 })
    expect(first.key).toBe('surgery|cirurgia-1|revenue')
    expect(third.key).toBe(first.key)
  })

  test('mapeia o modal de edição para o título financeiro correto', () => {
    expect(fiscalTargetFromModal('consultation', { id:'consulta-1', value:500, description:'Consulta', competenceDate:'2026-11-04' })).toMatchObject({ key:'consultation|consulta-1|revenue', direction:'receivable', totalAmount:500 })
    expect(fiscalTargetFromModal('expense', { id:'despesa-1', value:200 })).toMatchObject({ key:'expense|despesa-1|revenue', direction:'payable' })
  })

  test('exibe e encontra o número, série, chave e código da nota', () => {
    const document = { document_type:'nfse', number:'123', series:'A', access_key:'CHAVE44', verification_code:'VERIFY' }
    expect(fiscalDocumentLabel(document)).toBe('NFS-e 123 · série A')
    expect(fiscalDocumentsSearchText([document])).toContain('123')
    expect(fiscalDocumentsSearchText([document])).toContain('chave44')
    expect(fiscalDocumentsSearchText([document])).toContain('verify')
  })

  test('filtra lançamentos com, sem e por status do documento', () => {
    const documents = [{ status:'issued' }]
    expect(matchesFiscalFilter(documents, 'with')).toBe(true)
    expect(matchesFiscalFilter(documents, 'without')).toBe(false)
    expect(matchesFiscalFilter(documents, 'issued')).toBe(true)
    expect(matchesFiscalFilter([], 'without')).toBe(true)
  })

  test('aceita nomes snake_case vindos do banco', () => {
    expect(financialEntryKey({ source_type:'product_sale', source_id:'venda-1', source_component:'revenue' })).toBe('product_sale|venda-1|revenue')
  })
})

