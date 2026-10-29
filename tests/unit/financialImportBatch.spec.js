import { expect, test } from '@playwright/test'
import { statementMovementFingerprint, updateStatementLine } from '../../src/lib/statementParser.js'
import {
  batchProgress,
  isBatchComplete,
  buildBatchLineRows,
  buildBatchRecord,
  lineDecisionPatch,
  linesPendingApproval,
  restoreReviewState,
} from '../../src/lib/financialImportBatch.js'

const OWNER = '4472437e-f47b-41a3-9253-056660bcff20'
const ACTOR = '56752374-6f77-49f9-b3a0-bf9d8f0e835d'
const BATCH = '11111111-2222-4333-8444-555555555555'

function parsedFixture() {
  return {
    fileName:'MOV 09-2026.xlsx',
    fileHash:'a'.repeat(64),
    sheetName:'Movimento',
    mapping:{ date:0, description:1, amount:2 },
    lines:[
      {
        id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        sourceLineKey:'2:2026-09-15:17955.00:credito pix',
        lineIndex:2,
        postedDate:'2026-09-15',
        amount:17955,
        description:'CREDITO PIX - MAIS S GRAFICAS LTDA',
        normalizedDescription:'credito pix mais s graficas ltda',
        sourceMetadata:{ sheetName:'Movimento', excelRow:2, category:'Cirurgias' },
      },
      {
        id:'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
        sourceLineKey:'3:2026-09-02:-1200.00:tarifa',
        lineIndex:3,
        postedDate:'2026-09-02',
        amount:-1200,
        description:'TARIFA BANCARIA',
        normalizedDescription:'tarifa bancaria',
        sourceMetadata:{ sheetName:'Movimento', excelRow:3, category:'Desp bancaria' },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Lote: o cabeçalho do que foi importado
// ---------------------------------------------------------------------------
test('lote registra arquivo, autoria real e contagem', () => {
  const row = buildBatchRecord({ ownerId:OWNER, actorId:ACTOR, parsed:parsedFixture() })
  expect(row.user_id).toBe(OWNER)          // escopo = clínica
  expect(row.imported_by).toBe(ACTOR)      // autoria = quem subiu, não o dono
  expect(row.file_name).toBe('MOV 09-2026.xlsx')
  expect(row.file_hash).toBe('a'.repeat(64))
  expect(row.line_count).toBe(2)
  expect(row.expected_line_count).toBe(2)
  expect(row.status).toBe('reviewing')
})

test('lote deriva o período das datas da planilha', () => {
  const row = buildBatchRecord({ ownerId:OWNER, actorId:ACTOR, parsed:parsedFixture() })
  expect(row.period_start).toBe('2026-09-02')
  expect(row.period_end).toBe('2026-09-15')
})

test('aba é gravada como string vazia, nunca NULL (casa com o índice único)', () => {
  const row = buildBatchRecord({ ownerId:OWNER, actorId:ACTOR, parsed:{ fileName:'x.xlsx', fileHash:'b'.repeat(64), lines:[] } })
  expect(row.sheet_name).toBe('')
})

test('lote sem linhas não quebra e não inventa período', () => {
  const row = buildBatchRecord({ ownerId:OWNER, actorId:ACTOR, parsed:{ fileName:'x.xlsx', fileHash:'b'.repeat(64), lines:[] } })
  expect(row.line_count).toBe(0)
  expect(row.period_start).toBeNull()
  expect(row.period_end).toBeNull()
})

// ---------------------------------------------------------------------------
// Linhas: o id é o UUID determinístico, que também será o id do lançamento
// ---------------------------------------------------------------------------
test('linha preserva o UUID determinístico da linha (idempotência)', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  expect(rows.map(row => row.id)).toEqual([
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  ])
  expect(rows[0].batch_id).toBe(BATCH)
  expect(rows[0].user_id).toBe(OWNER)
  expect(rows[0].review_status).toBe('pending')
})

test('linha preserva metadados da planilha e o valor com sinal', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  expect(rows[0].source_metadata.category).toBe('Cirurgias')
  expect(rows[0].source_metadata.excelRow).toBe(2)
  expect(rows[0].amount).toBe(17955)
  expect(rows[1].amount).toBe(-1200)       // sinal é a direção: despesa continua negativa
  expect(rows[0].movement_fingerprint).toBeTruthy()
})

// ---------------------------------------------------------------------------
// Round-trip: o que volta do banco tem de reconstruir a revisão exatamente
// ---------------------------------------------------------------------------
test('round-trip: linhas gravadas voltam na forma que a tela consome', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  const { lines } = restoreReviewState(rows)
  expect(lines[0].id).toBe('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
  expect(lines[0].postedDate).toBe('2026-09-15')
  expect(lines[0].amount).toBe(17955)
  expect(lines[0].description).toBe('CREDITO PIX - MAIS S GRAFICAS LTDA')
  expect(lines[0].lineIndex).toBe(2)
  expect(lines[0].sourceMetadata.category).toBe('Cirurgias')
  expect(lines[0].sourceLineKey).toBe('2:2026-09-15:17955.00:credito pix')
})

test('round-trip devolve rejeitados e aprovados separados', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[0].review_status = 'approved'
  rows[1].review_status = 'rejected'
  const state = restoreReviewState(rows)
  expect(state.approvedIds).toEqual(['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'])
  expect(state.rejectedIds).toEqual(['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'])
})

test('linha arquivada não volta para a revisão', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[1].archived_at = '2026-10-29T12:00:00Z'
  expect(restoreReviewState(rows).lines).toHaveLength(1)
})

// ---------------------------------------------------------------------------
// Decisões: reversíveis, com autoria e momento
// ---------------------------------------------------------------------------
test('rejeitar registra autor e momento', () => {
  const patch = lineDecisionPatch({ decision:'reject', actorId:ACTOR, now:'2026-10-29T10:00:00Z' })
  expect(patch.review_status).toBe('rejected')
  expect(patch.reviewed_by).toBe(ACTOR)
  expect(patch.reviewed_at).toBe('2026-10-29T10:00:00Z')
})

test('reabrir volta para pendente e limpa a decisão', () => {
  const patch = lineDecisionPatch({ decision:'reopen', actorId:ACTOR, now:'2026-10-29T10:00:00Z' })
  expect(patch.review_status).toBe('pending')
  expect(patch.reviewed_by).toBeNull()
  expect(patch.reviewed_at).toBeNull()
})

// O vínculo linha↔lançamento NÃO precisa de coluna: o id da linha é o id da origem, por
// construção (financialImportUuid). Uma coluna extra seria redundante e não poderia ser mantida
// com valor por linha num update em lote.
test('aprovar registra autor e momento, sem coluna de origem redundante', () => {
  const patch = lineDecisionPatch({ decision:'approve', actorId:ACTOR, now:'2026-10-29T10:00:00Z' })
  expect(patch.review_status).toBe('approved')
  expect(patch.reviewed_by).toBe(ACTOR)
  expect(patch).not.toHaveProperty('approved_source_id')
})

test('decisão desconhecida é recusada em vez de gravar estado inválido', () => {
  expect(() => lineDecisionPatch({ decision:'explodir', actorId:ACTOR })).toThrow()
})

// ---------------------------------------------------------------------------
// Retomada: o que ainda falta aprovar depois de uma confirmação parcial
// ---------------------------------------------------------------------------
test('retomada ignora o que já foi aprovado e o que foi rejeitado', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[0].review_status = 'approved'
  expect(linesPendingApproval(rows).map(row => row.id)).toEqual(['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'])
  rows[1].review_status = 'rejected'
  expect(linesPendingApproval(rows)).toEqual([])
})

test('linha editada continua pendente de aprovação', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[0].review_status = 'edited'
  expect(linesPendingApproval(rows).map(row => row.id)).toContain('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
})

test('progresso conta cada estado e o que resta', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[0].review_status = 'approved'
  const progress = batchProgress(rows)
  expect(progress.total).toBe(2)
  expect(progress.approved).toBe(1)
  expect(progress.pending).toBe(1)
  expect(progress.remaining).toBe(1)
})

test('lote inteiro aprovado não deixa resto (base para fechar o lote)', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows.forEach(row => { row.review_status = 'approved' })
  expect(batchProgress(rows).remaining).toBe(0)
  expect(linesPendingApproval(rows)).toEqual([])
})

// ---------------------------------------------------------------------------
// Completude: retomar um lote incompleto é a perda silenciosa que isto previne
// ---------------------------------------------------------------------------
test('lote com todas as linhas é completo', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  expect(isBatchComplete(rows, 2)).toBe(true)
})

test('lote com linha faltando NÃO é completo (gravação interrompida)', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  expect(isBatchComplete(rows.slice(0, 1), 2)).toBe(false)
})

test('linha arquivada não conta para a completude', () => {
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:parsedFixture().lines })
  rows[1].archived_at = '2026-10-29T12:00:00Z'
  expect(isBatchComplete(rows, 2)).toBe(false)
})

// ---------------------------------------------------------------------------
// Round-trip pós-edição: a assinatura do movimento não pode divergir entre a
// revisão em memória e a MESMA revisão depois de retomada, senão a detecção de
// duplicados muda de resultado só por ter recarregado a página.
// ---------------------------------------------------------------------------
test('round-trip pós-edição preserva a assinatura do movimento', () => {
  const [line] = parsedFixture().lines
  const edited = updateStatementLine(line, { postedDate:'2026-09-20', amount:'5000', description:'PIX CORRIGIDO' })
  const editedLine = { ...edited, id:line.id }
  // É assim que o store grava a linha editada: fingerprint recalculado sobre os valores novos.
  const stored = {
    ...buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines:[editedLine] })[0],
    movement_fingerprint:statementMovementFingerprint(editedLine),
  }
  const { lines } = restoreReviewState([stored])
  expect(lines[0].movementFingerprint).toBe(statementMovementFingerprint(editedLine))
  expect(lines[0].amount).toBe(5000)
  expect(lines[0].postedDate).toBe('2026-09-20')
})

test('externalId sobrevive ao round-trip (chave de linha estável após retomar)', () => {
  const lines = parsedFixture().lines.map(line => ({ ...line, externalId:`ext-${line.lineIndex}` }))
  const rows = buildBatchLineRows({ ownerId:OWNER, batchId:BATCH, lines })
  expect(rows[0].source_metadata.externalId).toBe('ext-2')
  expect(restoreReviewState(rows)["lines"][0].externalId).toBe('ext-2')
})
