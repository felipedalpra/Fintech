import { expect, test } from '@playwright/test'
import { isProfessionalIdentitySyncConfirmed, resolveDocumentAuthor } from '../../src/lib/clinicalDocuments.js'

// Em 01/11/2026 o Dr. Augusto (Administrador, NÃO dono da clínica) preencheu
// nome, CRM e RQE em Configurações → "Médico e clínica" e, ao emitir um pedido
// de exames, a tela clínica continuava dizendo "Profissional não configurado ·
// CRM não informado" e bloqueava a emissão.
//
// Causa: a tela lia o vínculo de clínica e só consultava o perfil seguro quando
// o usuário era DONO. O perfil seguro é por usuário autenticado, então vale
// para qualquer perfil.

const perfil = (doctor) => ({ doctor })

test('o perfil seguro identifica o profissional, mesmo sem vínculo de membro', () => {
  const autor = resolveDocumentAuthor({
    secureProfile:perfil({ fullName:'Augusto Ribeiro', registrationId:'CRM-DF 29500' }),
    professionalName:'',
    professionalRegistration:'',
  })
  expect(autor.name).toBe('Augusto Ribeiro')
  expect(autor.registration).toBe('CRM-DF 29500')
  expect(autor.council).toBe('CRM')
})

test('o vínculo de clínica é a reserva quando não há perfil seguro', () => {
  const autor = resolveDocumentAuthor({
    secureProfile:null,
    professionalName:'Vitoria Ribeiro',
    professionalRegistration:'CRM-DF 12345',
    professionalCouncil:'CRM',
  })
  expect(autor.name).toBe('Vitoria Ribeiro')
  expect(autor.registration).toBe('CRM-DF 12345')
})

test('valor vazio NUNCA apaga um preenchido', () => {
  // As duas fontes chegam de forma assíncrona, em ordem imprevisível. Antes, o
  // efeito do vínculo podia rodar depois e zerar um autor já resolvido.
  const autor = resolveDocumentAuthor({
    secureProfile:perfil({ fullName:'Augusto Ribeiro', registrationId:'CRM-DF 29500' }),
    professionalName:'',
    professionalRegistration:'',
    professionalCouncil:'',
  })
  expect(autor.name).toBe('Augusto Ribeiro')
  expect(autor.registration).toBe('CRM-DF 29500')
})

test('cada campo cai para a reserva de forma independente', () => {
  // Perfil seguro com nome mas sem registro: o CRM do vínculo ainda serve.
  const autor = resolveDocumentAuthor({
    secureProfile:perfil({ fullName:'Augusto Ribeiro', registrationId:'   ' }),
    professionalRegistration:'CRM-DF 29500',
  })
  expect(autor.name).toBe('Augusto Ribeiro')
  expect(autor.registration).toBe('CRM-DF 29500')
})

test('sem nenhuma fonte, devolve vazio e o conselho padrão', () => {
  // Vazio tem que continuar bloqueando a emissão: documento médico sem
  // identificação do profissional não pode ser emitido.
  const autor = resolveDocumentAuthor()
  expect(autor.name).toBe('')
  expect(autor.registration).toBe('')
  expect(autor.council).toBe('CRM')
})

test('sincronização de identidade só é confirmada com booleano true e sem erro', () => {
  expect(isProfessionalIdentitySyncConfirmed({ data:true, error:null })).toBe(true)
  expect(isProfessionalIdentitySyncConfirmed({ data:false, error:null })).toBe(false)
  expect(isProfessionalIdentitySyncConfirmed({ data:null, error:null })).toBe(false)
  expect(isProfessionalIdentitySyncConfirmed({ data:true, error:new Error('falhou') })).toBe(false)
})

// ---------------------------------------------------------------------------
// A identidade precisa existir num lugar que o SERVIDOR consiga ler
// ---------------------------------------------------------------------------
// Resolver o autor na tela não basta: a emissão é feita por RPC, e o banco
// resolve o autor por `clinical_author_identity()`, que lê `clinics` (só para
// a dona) ou `clinic_members` (para membros). O perfil seguro é criptografado
// e o banco não o lê. Sem a cópia, a emissão é recusada com "Identidade
// profissional nao configurada" mesmo com tudo preenchido em Configurações.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('a tela sincroniza a identidade para o banco, e não só para a dona', () => {
  const tela = readFileSync(join(process.cwd(), 'src/components/ClinicalRecords.jsx'), 'utf8')
  const sql = readFileSync(join(process.cwd(), 'supabase/clinical_professional_identity_sync.sql'), 'utf8')

  expect(tela).toContain("supabase.rpc('sync_clinical_professional_identity'")
  // A sincronização não pode voltar a depender de ser dono: um administrador
  // que não é dono não tinha caminho nenhum para registrar a própria identidade.
  const trecho = tela.slice(tela.indexOf('const nextAuthor'), tela.indexOf("supabase.rpc('sync_clinical_professional_identity'"))
  expect(trecho).not.toContain('isOwner')
  // E a falha da sincronização precisa aparecer, não ser engolida.
  expect(tela).toContain('identitySyncError')
  expect(tela).toContain("setSecureProfileStatus('syncing')")
  expect(tela).toContain('data:identitySynced')
  expect(tela).toContain('isProfessionalIdentitySyncConfirmed')
  expect(tela).toContain("setSecureProfileStatus('sync-error')")

  // A RPC grava só a linha de quem chamou e só as colunas de identidade.
  expect(sql).toContain('cm.user_id = auth.uid()')
  expect(sql).toContain('cm.clinical_access is true')
  expect(sql).toContain("raise exception 'Vinculo clinico do profissional nao encontrado.'")
  expect(sql).not.toContain('role =')
  expect(sql).not.toContain('clinical_access =')
})
