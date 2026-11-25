import { test, expect } from '@playwright/test'
import {
  compareAttendanceDateTime,
  getAttendancePeriodRange,
  matchesAttendancePeriod,
  uniqueAttendanceOptions,
} from '../../src/lib/attendanceListFilters.js'

test.describe('filtros das listas de atendimentos', () => {
  test('calcula hoje, próximos sete dias, mês atual e mês anterior', () => {
    expect(getAttendancePeriodRange('hoje', '2026-11-25')).toEqual({ from:'2026-11-25', to:'2026-11-25' })
    expect(getAttendancePeriodRange('proximos_7', '2026-11-25')).toEqual({ from:'2026-11-25', to:'2026-12-01' })
    expect(getAttendancePeriodRange('este_mes', '2026-11-25')).toEqual({ from:'2026-11-01', to:'2026-11-30' })
    expect(getAttendancePeriodRange('mes_passado', '2026-01-10')).toEqual({ from:'2025-12-01', to:'2025-12-31' })
  })

  test('período personalizado e limites de data são inclusivos', () => {
    const range = getAttendancePeriodRange('personalizado', '2026-11-25', '2026-11-10', '2026-11-20')
    expect(matchesAttendancePeriod({ date:'2026-11-10' }, range)).toBe(true)
    expect(matchesAttendancePeriod({ date:'2026-11-20' }, range)).toBe(true)
    expect(matchesAttendancePeriod({ date:'2026-11-21' }, range)).toBe(false)
    expect(matchesAttendancePeriod({ date:'' }, range)).toBe(false)
  })

  test('ordena por data e desempata pelo horário sem alterar os registros', () => {
    const later = { date:'2026-11-25', startTime:'14:00' }
    const earlier = { date:'2026-11-25', startTime:'09:00' }
    expect(compareAttendanceDateTime(earlier, later)).toBeLessThan(0)
  })

  test('gera opções únicas e ordenadas para atributos operacionais', () => {
    expect(uniqueAttendanceOptions([{ surgeon:'Dr. B' }, { surgeon:'Dr. A' }, { surgeon:'Dr. B' }], 'surgeon')).toEqual([
      { v:'Dr. A', l:'Dr. A' }, { v:'Dr. B', l:'Dr. B' },
    ])
  })
})
