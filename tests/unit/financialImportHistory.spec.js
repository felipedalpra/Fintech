import { expect, test } from '@playwright/test'
import {
  canCancelImport,
  canDiscardImport,
  canResumeImport,
  importCancelBlockedMessage,
  importCancelBlockers,
  importHistoryStatus,
  removeCanceledImportSources,
} from '../../src/lib/financialImportHistory.js'

const REVENUE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const EXPENSE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const KEPT = 'cccccccc-3333-4333-8333-cccccccccccc'

function dataFixture() {
  return {
    surgeries:[{ id:'ssssssss-1111-4111-8111-ssssssssssss', value:1000 }],
    extraRevenues:[
      { id:REVENUE, value:17955, originLabel:'Importação MOV.xlsx · linha 2' },
      { id:KEPT, value:300, originLabel:'Receita manual' },
    ],
    expenses:[{ id:EXPENSE, value:1200, originLabel:'Importação MOV.xlsx · linha 3' }],
    goals:[],
  }
}

function batchFixture(overrides = {}) {
  return {
    id:'11111111-2222-4333-8444-555555555555',
    status:'ready',
    approved_count:12,
    rejected_count:3,
    pending_count:0,
    active_reconciliation_count:0,
    active_charge_count:0,
    active_fiscal_document_count:0,
    ...overrides,
  }
}

test('cancelamento retira do estado local SOMENTE as origens do lote', () => {
  const next = removeCanceledImportSources(dataFixture(), [REVENUE, EXPENSE])
  expect(next.extraRevenues.map(row => row.id)).toEqual([KEPT])
  expect(next.expenses).toEqual([])
  // Nenhuma outra coleção é tocada: cirurgias/metas não vêm de importação.
  expect(next.surgeries).toHaveLength(1)
})

test('ids do banco em caixa diferente ainda saem do estado local', () => {
  const next = removeCanceledImportSources(dataFixture(), [REVENUE.toUpperCase()])
  expect(next.extraRevenues.map(row => row.id)).toEqual([KEPT])
})

test('lista vazia de origens devolve o MESMO objeto, sem recriar o estado', () => {
  const data = dataFixture()
  expect(removeCanceledImportSources(data, [])).toBe(data)
  expect(removeCanceledImportSources(data, [null, '', undefined])).toBe(data)
})

test('origem desconhecida não apaga nada por engano', () => {
  const data = dataFixture()
  const next = removeCanceledImportSources(data, ['dddddddd-4444-4444-8444-dddddddddddd'])
  expect(next.extraRevenues).toHaveLength(2)
  expect(next.expenses).toHaveLength(1)
})

test('status do histórico cobre cada estado do lote', () => {
  expect(importHistoryStatus({ status:'canceled' }).label).toBe('Cancelada')
  expect(importHistoryStatus({ status:'archived' }).label).toBe('Descartada')
  expect(importHistoryStatus({ status:'ready' }).label).toBe('Concluída')
  expect(importHistoryStatus({ status:'reviewing' }).label).toBe('Em revisão')
  expect(importHistoryStatus({ status:'creating' }).label).toBe('Incompleta')
  expect(importHistoryStatus(undefined).label).toBe('Incompleta')
})

test('lote concluído com lançamentos no financeiro é cancelável', () => {
  expect(canCancelImport(batchFixture())).toBe(true)
  expect(canCancelImport(batchFixture({ status:'reviewing' }))).toBe(true)
})

test('lote sem lançamento aprovado NÃO é cancelável (o banco recusaria)', () => {
  expect(canCancelImport(batchFixture({ approved_count:0 }))).toBe(false)
})

test('lote já cancelado, descartado ou incompleto não oferece cancelamento', () => {
  expect(canCancelImport(batchFixture({ status:'canceled' }))).toBe(false)
  expect(canCancelImport(batchFixture({ status:'archived' }))).toBe(false)
  expect(canCancelImport(batchFixture({ status:'creating' }))).toBe(false)
})

test('conciliação, cobrança e documento fiscal cada um bloqueia o cancelamento', () => {
  expect(canCancelImport(batchFixture({ active_reconciliation_count:1 }))).toBe(false)
  expect(canCancelImport(batchFixture({ active_charge_count:2 }))).toBe(false)
  // Regressão: documento fiscal referencia financial_entries com ON DELETE RESTRICT.
  expect(canCancelImport(batchFixture({ active_fiscal_document_count:1 }))).toBe(false)
})

test('a mensagem de bloqueio nomeia TODOS os vínculos vivos', () => {
  const batch = batchFixture({ active_reconciliation_count:2, active_charge_count:1, active_fiscal_document_count:3 })
  expect(importCancelBlockers(batch).map(item => item.kind)).toEqual(['reconciliation', 'charge', 'fiscal'])
  const message = importCancelBlockedMessage(batch)
  expect(message).toContain('2 conciliação(ões) bancária(s)')
  expect(message).toContain('1 cobrança(s) ativa(s)')
  expect(message).toContain('3 documento(s) fiscal(is)')
})

test('sem vínculo vivo não há mensagem de bloqueio', () => {
  expect(importCancelBlockers(batchFixture())).toEqual([])
  expect(importCancelBlockedMessage(batchFixture())).toBe('')
})

test('só um lote em revisão com linhas gravadas pode ser retomado', () => {
  expect(canResumeImport(batchFixture({ status:'reviewing', pending_count:4 }))).toBe(true)
  expect(canResumeImport(batchFixture({ status:'reviewing', approved_count:0, rejected_count:0, pending_count:0 }))).toBe(false)
  expect(canResumeImport(batchFixture({ status:'ready' }))).toBe(false)
  expect(canResumeImport(batchFixture({ status:'canceled' }))).toBe(false)
  expect(canResumeImport(batchFixture({ status:'creating', pending_count:4 }))).toBe(false)
})

test('revisão que nunca entrou no financeiro pode ser descartada', () => {
  expect(canDiscardImport(batchFixture({ status:'reviewing', approved_count:0, pending_count:188 }))).toBe(true)
  expect(canDiscardImport(batchFixture({ status:'creating', approved_count:0 }))).toBe(true)
  // Revisão encerrada com tudo rejeitado tambem nunca virou lançamento.
  expect(canDiscardImport(batchFixture({ status:'ready', approved_count:0, rejected_count:188 }))).toBe(true)
})

test('lote com lançamento no financeiro NÃO oferece descartar — a ação certa é cancelar', () => {
  // Descartar aqui arquivaria o lote e deixaria as origens vivas sem lote cancelável.
  const imported = batchFixture({ status:'reviewing', approved_count:1 })
  expect(canDiscardImport(imported)).toBe(false)
  expect(canCancelImport(imported)).toBe(true)
})

test('lote já descartado ou cancelado não oferece descartar de novo', () => {
  expect(canDiscardImport(batchFixture({ status:'archived', approved_count:0 }))).toBe(false)
  expect(canDiscardImport(batchFixture({ status:'canceled', approved_count:0 }))).toBe(false)
})

test('descartar e cancelar nunca aparecem juntos no mesmo lote', () => {
  for (const status of ['creating', 'reviewing', 'ready', 'canceled', 'archived']) {
    for (const approved of [0, 5]) {
      const batch = batchFixture({ status, approved_count:approved })
      expect(canDiscardImport(batch) && canCancelImport(batch)).toBe(false)
    }
  }
})
