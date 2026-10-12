function parseDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = copy.getDay() || 7
  copy.setDate(copy.getDate() - (day - 1))
  return copy
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

export function generateRecurringOccurrences(recurrences = [], fromDate, toDate) {
  const from = parseDate(fromDate || '1900-01-01')
  const to = parseDate(toDate || '2999-12-31')
  if (!from || !to || from > to) return []

  const items = []
  recurrences.forEach(rec => {
    if (rec.ativo === false) return
    const startDate = parseDate(rec.dataInicio)
    if (!startDate) return
    const endDate = parseDate(rec.dataFim || '2999-12-31')
    const execDay = Math.max(1, Number(rec.diaExecucao || 1))
    const freq = rec.frequencia || 'mensal'
    const minDate = startDate > from ? startDate : from
    const maxDate = endDate < to ? endDate : to
    if (minDate > maxDate) return

    if (freq === 'mensal') {
      let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
      const lastMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)
      while (cursor <= lastMonth) {
        const day = Math.min(execDay, daysInMonth(cursor.getFullYear(), cursor.getMonth()))
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), day)
        if (due >= minDate && due <= maxDate) items.push({ ...rec, dueDate:formatDate(due) })
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      }
      return
    }

    if (freq === 'semanal') {
      const clampedDay = Math.min(7, execDay)
      let cursor = startOfWeek(minDate)
      while (cursor <= maxDate) {
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (clampedDay - 1))
        if (due >= minDate && due <= maxDate) items.push({ ...rec, dueDate:formatDate(due) })
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
      }
      return
    }

    let year = minDate.getFullYear()
    while (year <= maxDate.getFullYear()) {
      const month = startDate.getMonth()
      const day = Math.min(execDay, daysInMonth(year, month))
      const due = new Date(year, month, day)
      if (due >= minDate && due <= maxDate) items.push({ ...rec, dueDate:formatDate(due) })
      year += 1
    }
  })

  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function matchesRecurringExpense(record, recurring) {
  return (record.description || '') === (recurring.descricao || '')
    && (record.category || 'outros') === (recurring.categoria || 'outros')
    && Number(record.value || 0) === Number(recurring.valor || 0)
    && (record.dueDate || '') === (recurring.dueDate || '')
}

export function matchesRecurringRevenue(record, recurring) {
  return (record.description || '') === (recurring.descricao || '')
    && (record.category || 'outras_receitas') === (recurring.categoria || 'outras_receitas')
    && Number(record.value || 0) === Number(recurring.valor || 0)
    && (record.date || '') === (recurring.dueDate || '')
}
