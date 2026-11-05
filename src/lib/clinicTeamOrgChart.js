// Organograma da equipe da clínica, derivado do que o sistema JÁ sabe: o perfil de cada membro.
//
// Deliberadamente NÃO existe hierarquia pessoa-a-pessoa ("fulano se reporta a ciclano"): isso
// exigiria um campo de supervisor que alguém teria de manter atualizado, e um organograma
// desatualizado é pior que nenhum. A hierarquia aqui é a de permissão, que o sistema mantém
// sozinha e é a que realmente governa o que cada um pode fazer.

export const ORG_ROLE_LABELS = {
  admin:'Administrador',
  gestao:'Gestão',
  concierge:'Concierge',
  equipe:'Equipe',
}

const ROLE_ORDER = ['admin', 'gestao', 'concierge', 'equipe']

function displayName(member) {
  const professional = String(member?.professional_name || '').trim()
  if (professional) return professional
  const email = String(member?.member_email || '').trim()
  if (!email) return 'Sem identificação'
  return email
}

// As duas capacidades que hoje só apareciam depois de clicar em cada pessoa.
export function memberCapabilities(member) {
  const record = member?.clinical_access === true
  const sign = record && String(member?.professional_registration || '').trim().length > 0
  return { record, sign }
}

// O dono da clinica NAO tem linha em clinic_members: ele vive em clinics.owner_id. Sem isto ele
// some da equipe inteira — inclusive para ele mesmo. Entra como entrada sintetica, marcada como
// nao editavel, porque nenhum admin pode alterar a linha do dono.
export function withClinicOwner(members = [], owner = null) {
  const list = (members || []).filter(Boolean)
  if (!owner?.user_id) return list
  // Se o dono TAMBEM tiver linha de membro (clinicas antigas podem ter), nao duplicar.
  if (list.some(member => member.user_id === owner.user_id)) return list
  return [{
    id:`owner:${owner.user_id}`,
    user_id:owner.user_id,
    member_email:owner.member_email || '',
    role:'admin',
    // O dono sempre tem acesso clinico: has_clinical_access() devolve true para ele.
    clinical_access:true,
    professional_name:owner.professional_name || '',
    professional_registration:owner.professional_registration || '',
    professional_council:owner.professional_council || 'CRM',
    readOnly:true,
  }, ...list]
}

export function buildClinicOrgChart(members = [], ownerId = null) {
  const normalized = (members || [])
    .filter(Boolean)
    .map(member => ({
      id:member.id,
      userId:member.user_id || null,
      email:String(member.member_email || '').trim(),
      name:displayName(member),
      role:ROLE_ORDER.includes(member.role) ? member.role : 'equipe',
      roleLabel:ORG_ROLE_LABELS[member.role] || ORG_ROLE_LABELS.equipe,
      registration:String(member.professional_registration || '').trim(),
      council:String(member.professional_council || '').trim() || 'CRM',
      isOwner:Boolean(ownerId) && member.user_id === ownerId,
      readOnly:member.readOnly === true || (Boolean(ownerId) && member.user_id === ownerId),
      capabilities:memberCapabilities(member),
    }))

  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR')
  // A dona encabeça o organograma e sai dos grupos: ela não é editável por outro admin, e
  // misturá-la com os demais administradores esconderia justamente essa diferença.
  const owner = normalized.find(member => member.isOwner) || null
  const rest = normalized.filter(member => !member.isOwner)

  const groups = ROLE_ORDER
    .map(role => ({
      role,
      label:ORG_ROLE_LABELS[role],
      members:rest.filter(member => member.role === role).sort(byName),
    }))
    .filter(group => group.members.length > 0)

  return {
    owner,
    groups,
    total:normalized.length,
    // Quantas pessoas conseguem, de fato, cada coisa — o resumo que o admin quer de relance.
    summary:{
      withRecordAccess:normalized.filter(member => member.capabilities.record).length,
      canSign:normalized.filter(member => member.capabilities.sign).length,
    },
  }
}

// Só Administrador enxerga o organograma (decisão do cliente: Vitória e Augusto).
export function canSeeOrgChart(role) {
  return role === 'admin'
}
