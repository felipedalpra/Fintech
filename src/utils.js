export const fmt = v => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v || 0)
export const fmtN = v => new Intl.NumberFormat('pt-BR').format(v || 0)
export const today = () => new Date().toISOString().split('T')[0]
export const uid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const randomHex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  const hex = `${randomHex()}${randomHex()}${randomHex()}${randomHex()}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function toDate(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function monthKey(value) {
  return value ? value.slice(0, 7) : ''
}

export function startOfMonth(value = today()) {
  const date = toDate(value)
  if (!date) return today()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function endOfMonth(value = today()) {
  const date = toDate(value)
  if (!date) return today()
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

export function getPeriodRange(period, custom = {}) {
  const base = toDate(today()) || new Date()
  const year = base.getFullYear()
  const month = base.getMonth()

  if (period === 'custom') {
    return { start:custom.start || '', end:custom.end || '' }
  }

  if (period === 'day') {
    const date = today()
    return { start:date, end:date }
  }

  if (period === 'week') {
    const day = base.getDay() || 7
    const monday = new Date(base)
    monday.setDate(base.getDate() - day + 1)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return {
      start:`${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
      end:`${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`,
    }
  }

  if (period === 'month') {
    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 0)
    return {
      start:`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      end:`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    }
  }

  if (period === 'quarter') {
    const quarterStartMonth = Math.floor(month / 3) * 3
    const start = new Date(year, quarterStartMonth, 1)
    const end = new Date(year, quarterStartMonth + 3, 0)
    return {
      start:`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      end:`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    }
  }

  if (period === 'semester') {
    const semesterStartMonth = month < 6 ? 0 : 6
    const start = new Date(year, semesterStartMonth, 1)
    const end = new Date(year, semesterStartMonth + 6, 0)
    return {
      start:`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      end:`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    }
  }

  if (period === 'year') {
    return { start:`${year}-01-01`, end:`${year}-12-31` }
  }

  return { start:'', end:'' }
}

export function inRange(value, start, end) {
  if (!value) return false
  if (start && value < start) return false
  if (end && value > end) return false
  return true
}

export function onOrBefore(value, end) {
  if (!value) return false
  if (!end) return true
  return value <= end
}
