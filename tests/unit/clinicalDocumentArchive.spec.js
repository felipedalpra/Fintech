import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// Arquivamento (soft delete) de documento clínico emitido.
//
// Pedido do Felipe em 01/11/2026 ("criei um de teste"), com a condição
// explícita de ser soft delete. Documento de prontuário tem guarda obrigatória
// (CFM/LGPD) e a regra do projeto é "sem DELETE — apenas arquivamento".

const raiz = process.cwd()
const sql = readFileSync(join(raiz, 'supabase/clinical_documents_archive.sql'), 'utf8')
const tela = readFileSync(join(raiz, 'src/components/ClinicalDocuments.jsx'), 'utf8')
const indice = readFileSync(join(raiz, 'src/lib/clinicalWorkspaceIndexClient.js'), 'utf8')

test('a migration arquiva, e em nenhuma hipótese apaga', () => {
  expect(sql).toContain('add column if not exists archived_at')
  expect(sql).toContain('add column if not exists archived_by')
  // Nenhum DELETE sobre a tabela de documentos: a linha tem que permanecer.
  expect(sql).not.toMatch(/delete\s+from\s+public\.clinical_documents/i)
  expect(sql).not.toMatch(/drop\s+table/i)
})

test('o arquivamento registra quem e quando, e exige acesso clínico', () => {
  expect(sql).toContain('archived_by = auth.uid()')
  expect(sql).toContain('public.has_clinical_access()')
  expect(sql).toContain("raise exception 'Acesso clinico nao autorizado.'")
})

test('arquivar duas vezes não reescreve a trilha original', () => {
  // Reescrever apagaria quem arquivou de verdade e quando — a trilha é o
  // ponto do arquivamento.
  expect(sql).toContain('if v_archived is not null then')
  expect(sql).toContain('return v_archived')
})

test('documento de outra clínica não pode ser arquivado', () => {
  expect(sql).toContain('user_id = owner_now')
  expect(sql).toContain("raise exception 'Documento fora do escopo da clinica.'")
})

test('as telas deixam de listar o que foi arquivado', () => {
  expect(tela).toContain(".is('archived_at', null)")
  // A contagem do workspace também, senão o número não bate com a lista.
  expect(indice).toContain("clinical_documents")
  expect(indice.slice(indice.indexOf('clinical_documents'), indice.indexOf('clinical_documents') + 320))
    .toContain(".is('archived_at', null)")
})

test('a tela chama a RPC, nunca um delete direto', () => {
  expect(tela).toContain("supabase.rpc('archive_clinical_document'")
  expect(tela).not.toMatch(/from\('clinical_documents'\)[\s\S]{0,120}\.delete\(/)
})
