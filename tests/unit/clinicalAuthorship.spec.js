import { expect, test } from '@playwright/test'
import { clinicalSignature, isProfessionalAuthorship } from '../../src/lib/clinicalAuthorship.js'

test('registro assinado por profissional mostra conselho e número', () => {
  expect(clinicalSignature({ author_name:'Dra. Vitoria Ribeiro', author_council:'CRM', author_registration:'CRM-DF 12345' }))
    .toBe('Dra. Vitoria Ribeiro · CRM CRM-DF 12345')
})

test('registro da equipe NÃO se passa por profissional sem número', () => {
  // Antes saía "jonas@clinica.com · CRM não informado", que sugere um profissional
  // que apenas esqueceu de preencher o registro. É o oposto do que aconteceu.
  const label = clinicalSignature({ author_name:'jonas@clinica.com', author_council:'CRM', author_registration:null })
  expect(label).toContain('sem assinatura profissional')
  expect(label).not.toContain('não informado')
  expect(label).not.toMatch(/\bCRM\b/)
})

test('registro em branco ou só espaços conta como ausente', () => {
  for (const value of ['', '   ', null, undefined]) {
    expect(clinicalSignature({ author_name:'Equipe', author_registration:value })).toContain('sem assinatura profissional')
  }
})

test('sem autor não inventa assinatura', () => {
  expect(clinicalSignature({})).toBe('')
  expect(clinicalSignature(null)).toBe('')
})

test('a marca de autoria profissional acompanha o registro e a coluna do banco', () => {
  expect(isProfessionalAuthorship({ author_registration:'CRM-DF 12345' })).toBe(true)
  expect(isProfessionalAuthorship({ author_registration:null })).toBe(false)
  expect(isProfessionalAuthorship({ author_registration:'   ' })).toBe(false)
  // A coluna do banco manda quando existe: registro antigo pode ter número sem ser profissional.
  expect(isProfessionalAuthorship({ author_registration:'CRM-DF 1', author_is_professional:false })).toBe(false)
  expect(isProfessionalAuthorship(null)).toBe(false)
})
