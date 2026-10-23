import { expect, test } from '@playwright/test'
import { applyProtocolToTreatment, buildProtocolAnamnesisDraft, buildProtocolWorkspace, normalizeClinicalProtocol, validateClinicalProtocol, validateProtocolResponses } from '../../src/lib/clinicalProtocols.js'

const version = { id:'v1', protocol_id:'p1', version_number:1, name:'Mamoplastia', procedure_name:'Mama', indication:'Indicação-base', objectives:'Objetivos-base', planned_treatment:'Tratamento-base', guidance:'Orientações-base', anamnesis_prompts:[{ key:'gestacoes', label:'Gestações anteriores', required:true }], exam_kit:['Hemograma'], medication_favorites:[], photo_requirements:['Frente'], return_schedule:[{ days:7, title:'Retorno de 7 dias', instructions:'Avaliar cicatrização' }] }

test('normaliza e valida o protocolo sem transformar modelo em decisão automática', () => {
  expect(validateClinicalProtocol({})).toBe('Informe o nome do protocolo.')
  const normalized = normalizeClinicalProtocol({ name:'  Mamoplastia ', procedureName:' Mama ', indication:' i ', objectives:' o ', plannedTreatment:' t ', guidance:' g ', anamnesisPrompts:[{ label:' Tabagismo ', required:true }], returnSchedule:[{ days:'7', title:' Retorno ' }] })
  expect(normalized.name).toBe('Mamoplastia')
  expect(normalized.anamnesisPrompts[0]).toEqual({ key:'question_1', label:'Tabagismo', required:true })
  expect(normalized.returnSchedule[0]).toMatchObject({ days:7, title:'Retorno' })
  expect(validateClinicalProtocol(normalized)).toBe('')
})

test('aplica protocolo como rascunho de anamnese e exige respostas marcadas', () => {
  const draft = buildProtocolAnamnesisDraft(version, { therapeutic_plan:'' })
  expect(draft).toMatchObject({ protocol_id:'p1', protocol_version_id:'v1', protocol_name:'Mamoplastia', therapeutic_plan:'Tratamento-base\n\nOrientações-base' })
  expect(validateProtocolResponses(version, draft.protocol_responses)).toContain('Gestações anteriores')
  expect(validateProtocolResponses(version, { gestacoes:'Nenhuma' })).toBe('')
})

test('aplica protocolo no plano sem sobrescrever texto já revisado', () => {
  const result = applyProtocolToTreatment(version, { title:'Plano individual', indication:'' }, '2026-10-23')
  expect(result.values.title).toBe('Plano individual')
  expect(result.values.indication).toBe('Indicação-base')
  expect(result.sessions[0]).toMatchObject({ sessionType:'return', title:'Retorno de 7 dias', scheduledStart:'2026-10-30T09:00' })
})

test('mantém versões e status append-only ao montar a biblioteca', () => {
  const workspace = buildProtocolWorkspace({ protocols:[{ id:'p1' }], versions:[{ ...version, version_number:1 }, { ...version, id:'v2', version_number:2, name:'Mamoplastia revisada' }], statuses:[{ protocol_id:'p1', status:'active', recorded_at:'2026-10-23T10:00:00Z' }, { protocol_id:'p1', status:'archived', recorded_at:'2026-10-23T11:00:00Z' }] })
  expect(workspace[0].currentVersion.name).toBe('Mamoplastia revisada')
  expect(workspace[0].versions).toHaveLength(2)
  expect(workspace[0].currentStatus).toBe('archived')
})
