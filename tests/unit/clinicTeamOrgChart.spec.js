import { expect, test } from '@playwright/test'
import { buildClinicOrgChart, canSeeOrgChart, memberCapabilities, ORG_ROLE_LABELS } from '../../src/lib/clinicTeamOrgChart.js'

const OWNER = '10000000-0000-4000-8000-000000000001'

function team() {
  return [
    { id:'1', user_id:OWNER, member_email:'vitoria@x.com', role:'admin', clinical_access:true, professional_name:'Dra. Vitoria Ribeiro', professional_registration:'CRM-DF 29500', professional_council:'CRM' },
    { id:'2', user_id:'u2', member_email:'augusto@x.com', role:'admin', clinical_access:true, professional_name:'Augusto Ribeiro', professional_registration:'CRM-DF 29501' },
    { id:'3', user_id:'u3', member_email:'luh@x.com', role:'gestao', clinical_access:false },
    { id:'4', user_id:'u4', member_email:'jonas@x.com', role:'concierge', clinical_access:true },
    { id:'5', user_id:'u5', member_email:'sumary@x.com', role:'equipe', clinical_access:true },
    { id:'6', user_id:'u6', member_email:'jessica@x.com', role:'equipe', clinical_access:false },
  ]
}

test('a dona encabeça o organograma e sai dos grupos', () => {
  const chart = buildClinicOrgChart(team(), OWNER)
  expect(chart.owner.name).toBe('Dra. Vitoria Ribeiro')
  expect(chart.owner.isOwner).toBe(true)
  // Misturá-la com os outros administradores esconderia que ela não é editável por eles.
  const everyoneInGroups = chart.groups.flatMap(group => group.members.map(m => m.id))
  expect(everyoneInGroups).not.toContain('1')
  expect(chart.total).toBe(6)
})

test('grupos saem na ordem de autoridade, não na ordem do banco', () => {
  const chart = buildClinicOrgChart(team(), OWNER)
  expect(chart.groups.map(group => group.role)).toEqual(['admin', 'gestao', 'concierge', 'equipe'])
  expect(chart.groups.map(group => group.label)).toEqual(['Administrador', 'Gestão', 'Concierge', 'Equipe'])
})

test('grupo vazio não vira caixa vazia na tela', () => {
  const chart = buildClinicOrgChart([
    { id:'1', user_id:OWNER, member_email:'vitoria@x.com', role:'admin' },
    { id:'5', user_id:'u5', member_email:'sumary@x.com', role:'equipe' },
  ], OWNER)
  expect(chart.groups.map(group => group.role)).toEqual(['equipe'])
})

test('as duas capacidades aparecem sem precisar abrir cada pessoa', () => {
  // prontuário = acesso clínico. assina = acesso clínico + registro profissional.
  expect(memberCapabilities({ clinical_access:true, professional_registration:'CRM-DF 1' })).toEqual({ record:true, sign:true })
  expect(memberCapabilities({ clinical_access:true, professional_registration:'' })).toEqual({ record:true, sign:false })
  expect(memberCapabilities({ clinical_access:true, professional_registration:'   ' })).toEqual({ record:true, sign:false })
  // Registro sem acesso ao prontuário não assina nada: a porta de entrada é o acesso clínico.
  expect(memberCapabilities({ clinical_access:false, professional_registration:'CRM-DF 1' })).toEqual({ record:false, sign:false })
  expect(memberCapabilities({})).toEqual({ record:false, sign:false })
})

test('o resumo conta quem realmente pode cada coisa', () => {
  const chart = buildClinicOrgChart(team(), OWNER)
  expect(chart.summary.withRecordAccess).toBe(4)
  expect(chart.summary.canSign).toBe(2)
})

test('nome cai para o e-mail quando não há nome profissional', () => {
  const chart = buildClinicOrgChart(team(), OWNER)
  const jonas = chart.groups.find(g => g.role === 'concierge').members[0]
  expect(jonas.name).toBe('jonas@x.com')
  expect(buildClinicOrgChart([{ id:'x', role:'equipe' }], OWNER).groups[0].members[0].name).toBe('Sem identificação')
})

test('sem dono identificado o organograma ainda monta', () => {
  const chart = buildClinicOrgChart(team(), null)
  expect(chart.owner).toBeNull()
  expect(chart.groups.flatMap(g => g.members).length).toBe(6)
})

test('perfil desconhecido não some da tela: cai em Equipe', () => {
  const chart = buildClinicOrgChart([{ id:'z', user_id:'uz', member_email:'z@x.com', role:'inventado' }], OWNER)
  expect(chart.groups[0].role).toBe('equipe')
  expect(chart.groups[0].members[0].roleLabel).toBe(ORG_ROLE_LABELS.equipe)
})

test('entrada vazia ou suja não quebra', () => {
  expect(buildClinicOrgChart([], OWNER).groups).toEqual([])
  expect(buildClinicOrgChart(undefined, OWNER).total).toBe(0)
  expect(buildClinicOrgChart([null, undefined], OWNER).total).toBe(0)
})

test('só Administrador enxerga o organograma', () => {
  expect(canSeeOrgChart('admin')).toBe(true)
  for (const role of ['gestao', 'concierge', 'equipe', '', null, undefined]) {
    expect(canSeeOrgChart(role)).toBe(false)
  }
})
