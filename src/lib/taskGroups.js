// src/lib/taskGroups.js
// Agrupamento PURO de tarefas por vencimento (testável; sem I/O).
// Pendentes → atrasadas / hoje / semana / futuras. Concluídas ficam à parte.

// Dia local no formato YYYY-MM-DD (evita erro de fuso ao comparar com due_date DATE).
function dayKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function groupTasksByDue(tasks, today = new Date()) {
  const groups = { atrasadas: [], hoje: [], semana: [], futuras: [], concluidas: [] }
  const hojeKey = dayKey(today)
  const week = new Date(today); week.setDate(week.getDate() + 7)
  const weekKey = dayKey(week)

  for (const t of tasks || []) {
    if (t.status === 'feita') { groups.concluidas.push(t); continue }
    const due = t.due_date ? String(t.due_date).slice(0, 10) : null
    if (!due) groups.futuras.push(t)
    else if (due < hojeKey) groups.atrasadas.push(t)
    else if (due === hojeKey) groups.hoje.push(t)
    else if (due <= weekKey) groups.semana.push(t)
    else groups.futuras.push(t)
  }
  return groups
}

// Ordem e rótulos de exibição dos grupos de pendentes.
export const GROUP_ORDER = [
  { key: 'atrasadas', label: 'Atrasadas', icon: '⚠' },
  { key: 'hoje', label: 'Hoje', icon: '📅' },
  { key: 'semana', label: 'Esta semana', icon: '🗓' },
  { key: 'futuras', label: 'Futuras / sem data', icon: '📋' },
]
