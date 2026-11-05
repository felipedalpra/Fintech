// Fila de trabalho das tarefas do CRM.
//
// A pergunta que esta tela responde é "o que eu faço AGORA", não "o que está pendente".
// Por isso o agrupamento é por urgência (atrasada / hoje / próximos dias), não por status.
//
// Tudo aqui é puro e recebe `hoje` como parâmetro: data calculada dentro da função tornaria o
// teste dependente do relógio da máquina, e um agrupamento de tarefas que erra o "hoje" manda a
// equipe ligar para o paciente errado no dia errado.

export const TASK_TYPES = [
  { key:'ligar',     label:'Ligar',      icon:'phone' },
  { key:'whatsapp',  label:'WhatsApp',   icon:'chat' },
  { key:'retorno',   label:'Retorno',    icon:'calendar' },
  { key:'orcamento', label:'Orçamento',  icon:'reports' },
  { key:'exames',    label:'Exames',     icon:'clinico' },
  { key:'documento', label:'Documento',  icon:'reports' },
  { key:'pos_op',    label:'Pós-op',     icon:'clinico' },
  { key:'outro',     label:'Outro',      icon:'tasks' },
]
export const TASK_TYPE_LABEL = Object.fromEntries(TASK_TYPES.map(item => [item.key, item.label]))

// O desfecho é o que transforma tarefa em histórico. "Feita" sem desfecho não diz se o paciente
// atendeu, remarcou ou recusou — e era exatamente essa informação que se perdia.
export const TASK_OUTCOMES = [
  { key:'concluido',     label:'Concluída',        closes:true },
  { key:'atendeu',       label:'Atendeu',          closes:true },
  { key:'nao_atendeu',   label:'Não atendeu',      closes:false },
  { key:'remarcou',      label:'Remarcou',         closes:false },
  { key:'sem_interesse', label:'Sem interesse',    closes:true },
]
export const TASK_OUTCOME_LABEL = Object.fromEntries(TASK_OUTCOMES.map(item => [item.key, item.label]))

export function isValidTaskType(value) {
  return TASK_TYPES.some(item => item.key === value)
}

export function isValidTaskOutcome(value) {
  return TASK_OUTCOMES.some(item => item.key === value)
}

function isoDate(value) {
  return String(value || '').slice(0, 10)
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// 'atrasada' | 'hoje' | 'semana' | 'depois' | 'sem_data'
export function taskUrgency(task, hoje) {
  if (task?.status === 'feita') return 'feita'
  const due = isoDate(task?.due_date)
  if (!due) return 'sem_data'
  if (due < hoje) return 'atrasada'
  if (due === hoje) return 'hoje'
  return due <= addDays(hoje, 7) ? 'semana' : 'depois'
}

// Dentro do grupo: mais cedo primeiro. Tarefa sem hora vem depois das com hora no mesmo dia,
// porque hora marcada é compromisso e o resto é "quando der".
function byDueThenTime(a, b) {
  const dateCmp = isoDate(a.due_date).localeCompare(isoDate(b.due_date))
  if (dateCmp !== 0) return dateCmp
  // '99:99' como sentinela e comparação direta: localeCompare com um caractere fora do alfabeto
  // ordena de forma dependente de locale e já colocou "sem hora" na frente de "09:00".
  const at = String(a.due_time || '99:99')
  const bt = String(b.due_time || '99:99')
  if (at === bt) return 0
  return at < bt ? -1 : 1
}

export function groupTasksByUrgency(tasks = [], hoje) {
  const groups = { atrasadas:[], hoje:[], semana:[], depois:[], semData:[], feitas:[] }
  const bucket = { atrasada:'atrasadas', hoje:'hoje', semana:'semana', depois:'depois', sem_data:'semData', feita:'feitas' }
  for (const task of tasks || []) {
    if (!task) continue
    groups[bucket[taskUrgency(task, hoje)]].push(task)
  }
  for (const key of ['atrasadas', 'hoje', 'semana', 'depois', 'semData']) groups[key].sort(byDueThenTime)
  return groups
}

// As seções exibidas, na ordem em que a equipe deve atacá-las. Seção vazia não vira cabeçalho.
export function queueSections(groups) {
  return [
    { key:'atrasadas', label:'Atrasadas', tone:'danger', tasks:groups.atrasadas },
    { key:'hoje',      label:'Hoje',      tone:'accent', tasks:groups.hoje },
    { key:'semana',    label:'Próximos 7 dias', tone:'muted', tasks:groups.semana },
    { key:'semData',   label:'Sem data',  tone:'muted', tasks:groups.semData },
    { key:'depois',    label:'Depois',    tone:'muted', tasks:groups.depois },
  ].filter(section => section.tasks.length > 0)
}

// Contexto da segunda linha do card: de quem é a tarefa e de onde ela veio. Sem isso o item diz
// "Ligar" e a pessoa precisa abrir para saber para quem.
export function taskContextLabel(task) {
  const person = task?.patients?.full_name || task?.crm_contacts?.full_name || ''
  const deal = task?.opportunities?.title && task.opportunities.title !== 'Oportunidade' ? task.opportunities.title : ''
  return [person, deal].filter(Boolean).join(' · ')
}
