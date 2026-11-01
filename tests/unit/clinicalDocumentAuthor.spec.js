import { expect, test } from '@playwright/test'
import { resolveDocumentAuthor } from '../../src/lib/clinicalDocuments.js'

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
