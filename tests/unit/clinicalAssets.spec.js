import { expect, test } from '@playwright/test'
import {
  CLINICAL_ASSET_MAX_BYTES,
  buildClinicalAssetRpcArgs,
  clinicalAssetKind,
  clinicalAssetSha256,
  filterClinicalAssets,
  validateClinicalAssetFile,
} from '../../src/lib/clinicalAssets.js'

function fakeFile({ name = 'foto.png', type = 'image/png', size = 4, bytes = [1, 2, 3, 4] } = {}) {
  return {
    name,
    type,
    size,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer
    },
  }
}

test('aceita somente imagens clínicas e PDF dentro do limite', () => {
  expect(validateClinicalAssetFile(null)).toContain('Selecione')
  expect(validateClinicalAssetFile(fakeFile({ type:'image/svg+xml' }))).toContain('Formato não aceito')
  expect(validateClinicalAssetFile(fakeFile({ size:0 }))).toContain('vazio')
  expect(validateClinicalAssetFile(fakeFile({ size:CLINICAL_ASSET_MAX_BYTES + 1 }))).toContain('20 MB')
  expect(validateClinicalAssetFile(fakeFile())).toBe('')
  expect(validateClinicalAssetFile(fakeFile({ name:'laudo.pdf', type:'application/pdf' }))).toBe('')
})

test('normaliza PDF como documento sem etapa e preserva metadados clínicos', () => {
  const file = fakeFile({ name:'laudo.pdf', type:'application/pdf', size:412 })
  const args = buildClinicalAssetRpcArgs({
    patientId:'patient-1',
    file,
    sha256:'a'.repeat(64),
    form:{
      stage:'after',
      captured_on:'2026-10-22',
      region:'  Abdômen ',
      procedure_name:'  Abdominoplastia ',
      notes:'  Documento pré-operatório ',
      consent_acceptance_id:'consent-1',
    },
  })

  expect(clinicalAssetKind(file)).toBe('document')
  expect(args).toEqual({
    p_patient_id:'patient-1',
    p_asset_kind:'document',
    p_stage:'neutral',
    p_captured_on:'2026-10-22',
    p_region:'Abdômen',
    p_procedure_name:'Abdominoplastia',
    p_notes:'Documento pré-operatório',
    p_file_name:'laudo.pdf',
    p_mime_type:'application/pdf',
    p_file_size:412,
    p_client_sha256:'a'.repeat(64),
    p_consent_acceptance_id:null,
  })
})

test('filtra sem expor arquivados por padrão', () => {
  const assets = [
    { id:'before', status:'available', asset_kind:'clinical_photo', stage:'before', file_name:'frente.png', region:'Face', procedure_name:'Rinoplastia' },
    { id:'document', status:'available', asset_kind:'document', stage:'neutral', file_name:'laudo.pdf', region:null, procedure_name:'Rinoplastia' },
    { id:'archived', status:'archived', asset_kind:'clinical_photo', stage:'after', file_name:'depois.png', region:'Face', notes:'Retorno' },
  ]

  expect(filterClinicalAssets(assets).map(asset => asset.id)).toEqual(['before', 'document'])
  expect(filterClinicalAssets(assets, { query:'retorno', showArchived:true }).map(asset => asset.id)).toEqual(['archived'])
  expect(filterClinicalAssets(assets, { kind:'clinical_photo', stage:'before' }).map(asset => asset.id)).toEqual(['before'])
})

test('calcula SHA-256 no cliente sem enviar o arquivo bruto', async () => {
  const digest = await clinicalAssetSha256(fakeFile({ bytes:[116, 101, 115, 116], size:4 }))
  expect(digest).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
})
