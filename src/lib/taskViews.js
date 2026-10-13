// src/lib/taskViews.js
// Helpers PUROS de visualização de tarefas (testáveis; sem I/O).
// Filtro (escopo + múltiplos responsáveis + busca), urgência e kanban por status.
// Complementa taskGroups.js (agrupamento por vencimento da visão em lista).

// Dia local YYYY-MM-DD (evita erro de fuso ao comparar com due_date DATE).
export function dayKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Conta tarefas concluídas HOJE (dia local). Converte o done_at (ISO/UTC) para o fuso
// local antes de comparar — senão, em UTC-3, uma conclusão à noite "vaza" para o dia seguinte.
export function countDoneToday(tasks, today = new Date()) {
  const hoje = dayKey(today)
  return (tasks || []).filter(t => {
    if (t.status !== 'feita' || !t.done_at) return false
    const dt = new Date(t.done_at)
    return !Number.isNaN(dt.getTime()) && dayKey(dt) === hoje
  }).length
}

// Urgência de uma tarefa (barra de cor + ordenação). Feita → 'feita'.
export function urgencyOf(task, today = new Date()) {
  if (task?.status === 'feita') return 'feita'
  const due = task?.due_date ? String(task.due_date).slice(0, 10) : null
  if (!due) return 'futura'
  const hoje = dayKey(today)
  const week = new Date(today); week.setDate(week.getDate() + 7)
  if (due < hoje) return 'atrasada'
  if (due === hoje) return 'hoje'
  if (due <= dayKey(week)) return 'semana'
  return 'futura'
}

const URGENCY_RANK = { atrasada: 0, hoje: 1, semana: 2, futura: 3, feita: 4 }

// Filtra tarefas por escopo (minhas/todas), responsáveis (vários; 'none' = sem responsável)
// e busca textual (título, paciente ou oportunidade). Sem efeitos colaterais.
export function filterTasks(tasks, { scope = 'todas', currentUserId = null, responsibles = [], query = '' } = {}) {
  const q = (query || '').trim().toLowerCase()
  const resSet = new Set(responsibles || [])
  return (tasks || []).filter(t => {
    if (scope === 'minhas' && t.assigned_user_id !== currentUserId) return false
    if (resSet.size) {
      const key = t.assigned_user_id || 'none'
      if (!resSet.has(key)) return false
    }
    if (q) {
      const hay = [t.title, t.patients?.full_name, t.opportunities?.title].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// Kanban por status: "A fazer" (ordenada por urgência, depois vencimento asc) e "Concluídas"
// (mais recente primeiro). Arrastar entre colunas conclui/reabre (feito na UI via toggleTask).
export function kanbanByStatus(tasks, today = new Date()) {
  const afazer = []
  const concluidas = []
  for (const t of tasks || []) (t.status === 'feita' ? concluidas : afazer).push(t)
  afazer.sort((a, b) => {
    const ra = URGENCY_RANK[urgencyOf(a, today)]
    const rb = URGENCY_RANK[urgencyOf(b, today)]
    if (ra !== rb) return ra - rb
    const da = a.due_date ? String(a.due_date).slice(0, 10) : '9999-99-99'
    const db = b.due_date ? String(b.due_date).slice(0, 10) : '9999-99-99'
    return da < db ? -1 : da > db ? 1 : 0
  })
  concluidas.sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')))
  return { afazer, concluidas }
}
