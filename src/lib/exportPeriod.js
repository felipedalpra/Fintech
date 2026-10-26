export const EXPORT_TIME_ZONE = 'America/Sao_Paulo'

export const EXPORT_PERIOD_OPTIONS = [
  { value:'all', label:'Todo o período' },
  { value:'month', label:'Mês' },
  { value:'quarter', label:'Trimestre' },
  { value:'year', label:'Ano' },
  { value:'custom', label:'Personalizado' },
]

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export function emptyExportPeriod() {
  return { preset:'all', start:'', end:'' }
}

export function todayInExportTimeZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:EXPORT_TIME_ZONE,
    year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(toValidDate(now))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function defaultCustomExportPeriod(now = new Date()) {
  const today = todayInExportTimeZone(now)
  return { preset:'custom', start:`${today.slice(0, 7)}-01`, end:today }
}

export function defaultExportPeriodForPreset(preset, now = new Date()) {
  const today = todayInExportTimeZone(now)
  const year = today.slice(0, 4)
  const month = Number(today.slice(5, 7))
  if (preset === 'month') return { preset, month:today.slice(0, 7) }
  if (preset === 'quarter') return { preset, year, quarter:String(Math.floor((month - 1) / 3) + 1) }
  if (preset === 'year') return { preset, year }
  if (preset === 'custom') return defaultCustomExportPeriod(now)
  return emptyExportPeriod()
}

export function resolveExportPeriod(value = {}, now = new Date()) {
  if (value?.start && value?.end && value?.label && value?.preset) return value

  const preset = EXPORT_PERIOD_OPTIONS.some(option => option.value === value?.preset) ? value.preset : 'all'
  const today = todayInExportTimeZone(now)
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))

  if (preset === 'all') return { preset, start:'', end:'', label:'Todo o período', filenameSuffix:'' }
  if (preset === 'month') {
    const selectedMonth = Object.prototype.hasOwnProperty.call(value, 'month') ? value.month : today.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(selectedMonth || '')) throw new Error('Escolha um mês válido para a exportação.')
    const year = Number(selectedMonth.slice(0, 4))
    const month = Number(selectedMonth.slice(5, 7))
    if (month < 1 || month > 12) throw new Error('Escolha um mês válido para a exportação.')
    const start = `${selectedMonth}-01`
    const end = lastDayOfMonth(year, month)
    return { preset, month:selectedMonth, start, end, label:`${capitalize(MONTHS[month - 1])} de ${year}`, filenameSuffix:selectedMonth }
  }
  if (preset === 'quarter') {
    const year = selectedYear(value, currentYear)
    const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1
    const quarter = Object.prototype.hasOwnProperty.call(value, 'quarter') ? Number(value.quarter) : currentQuarter
    if (![1, 2, 3, 4].includes(quarter)) throw new Error('Escolha um trimestre válido para a exportação.')
    const startMonth = (quarter - 1) * 3 + 1
    const endMonth = startMonth + 2
    const start = `${year}-${pad(startMonth)}-01`
    const end = lastDayOfMonth(year, endMonth)
    return { preset, year:String(year), quarter:String(quarter), start, end, label:`${quarter}º trimestre de ${year}`, filenameSuffix:`${year}-T${quarter}` }
  }
  if (preset === 'year') {
    const year = selectedYear(value, currentYear)
    return { preset, year:String(year), start:`${year}-01-01`, end:`${year}-12-31`, label:`Ano de ${year}`, filenameSuffix:String(year) }
  }

  const start = normalizeCivilDate(value.start)
  const end = normalizeCivilDate(value.end)
  if (!start || !end) throw new Error('Informe as datas inicial e final do período personalizado.')
  if (start > end) throw new Error('A data inicial do período não pode ser posterior à data final.')
  return {
    preset,
    start,
    end,
    label:`${formatCivilDate(start)} a ${formatCivilDate(end)}`,
    filenameSuffix:`${start}_a_${end}`,
  }
}

export function filterRowsByPeriod(rows, periodValue, dateFields = []) {
  const list = Array.isArray(rows) ? rows : []
  const period = resolveExportPeriod(periodValue)
  if (period.preset === 'all' || !dateFields.length) return list

  return list.filter(row => {
    const date = dateFields
      .map(field => row?.[field])
      .filter(candidate => candidate !== '' && candidate != null)
      .map(civilDateFromValue)
      .find(Boolean)
    return date ? date >= period.start && date <= period.end : true
  })
}

export function civilDateFromValue(value) {
  if (value == null || value === '') return ''
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return normalizeCivilDate(text)
  if (/^\d{4}-\d{2}$/.test(text)) return normalizeCivilDate(`${text}-01`)

  let date
  if (/^\d{10}$/.test(text)) date = new Date(Number(text) * 1000)
  else if (/^\d{13}$/.test(text)) date = new Date(Number(text))
  else date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return todayInExportTimeZone(date)
}

function normalizeCivilDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

function lastDayOfMonth(year, month) {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(day)}`
}

function formatCivilDate(value) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Não foi possível determinar a data da exportação.')
  return date
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function validYear(value) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : 0
}

function selectedYear(value, fallback) {
  if (!Object.prototype.hasOwnProperty.call(value, 'year')) return fallback
  const year = validYear(value.year)
  if (!year) throw new Error('Escolha um ano válido para a exportação.')
  return year
}
