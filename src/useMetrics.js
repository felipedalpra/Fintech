import { useMemo } from 'react'
import { buildMetrics } from './financialMetrics.js'

export { buildMetrics } from './financialMetrics.js'

export function useMetrics(data, options = {}) {
  return useMemo(() => buildMetrics(data, options), [data, options.startDate, options.endDate, options.balanceDate])
}
