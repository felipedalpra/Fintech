import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { Card, SkeletonBlock } from './UI.jsx'
import { FinancialPeriodFilter } from './FinancialPeriodFilter.jsx'
import { FinancialChart } from './FinancialChart.jsx'
import { FinancialTable } from './FinancialTable.jsx'
import { fetchFinancialAnalysis } from '../lib/financialAnalysisClient.js'

export function Reports() {
  const [periodPreset, setPeriodPreset] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [granularity, setGranularity] = useState('month')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const range = useMemo(() => resolveDateRange(periodPreset, customRange), [periodPreset, customRange])
  const isCustomIncomplete = periodPreset === 'custom' && (!range.startDate || !range.endDate)

  useEffect(() => {
    if (!range.startDate || !range.endDate) return

    let active = true
    setLoading(true)
    setError('')

    fetchFinancialAnalysis({
      startDate:range.startDate,
      endDate:range.endDate,
      granularity,
    })
      .then(data => {
        if (!active) return
        setRows(Array.isArray(data) ? data : [])
      })
      .catch(fetchError => {
        if (!active) return
        setRows([])
        setError(fetchError?.message || 'Nao foi possivel carregar a analise financeira.')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [range.startDate, range.endDate, granularity])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card>
        <FinancialPeriodFilter
          periodPreset={periodPreset}
          onPeriodPresetChange={setPeriodPreset}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          granularity={granularity}
          onGranularityChange={setGranularity}
        />
      </Card>

      {isCustomIncomplete && (
        <Card>
          <p style={{ margin:0, color:C.textDim, fontSize:13 }}>
            Selecione data inicial e final para carregar a análise personalizada.
          </p>
        </Card>
      )}

      {!isCustomIncomplete && loading && <LoadingState />}

      {!isCustomIncomplete && !loading && error && (
        <Card>
          <p style={{ margin:0, color:C.red, fontSize:13 }}>{error}</p>
        </Card>
      )}

      {!isCustomIncomplete && !loading && !error && rows.length === 0 && (
        <Card>
          <p style={{ margin:0, color:C.textDim, fontSize:13 }}>
            Nenhuma movimentação encontrada no período selecionado.
          </p>
        </Card>
      )}

      {!isCustomIncomplete && !loading && !error && rows.length > 0 && (
        <>
          <Card>
            <h3 style={titleStyle}>Evolução Financeira</h3>
            <FinancialChart rows={rows} />
          </Card>
          <Card>
            <h3 style={titleStyle}>Análise Horizontal e Vertical</h3>
            <FinancialTable rows={rows} />
          </Card>
        </>
      )}
    </div>
  )
}

function resolveDateRange(periodPreset, customRange) {
  if (periodPreset === 'custom') {
    return {
      startDate:customRange.start || '',
      endDate:customRange.end || '',
    }
  }

  const now = new Date()
  const endDate = toDateInput(now)
  let start = new Date(now.getFullYear(), now.getMonth(), 1)

  if (periodPreset === 'quarter') {
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3
    start = new Date(now.getFullYear(), quarterMonth, 1)
  } else if (periodPreset === 'year') {
    start = new Date(now.getFullYear(), 0, 1)
  }

  return {
    startDate:toDateInput(start),
    endDate,
  }
}

function toDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function LoadingState() {
  return (
    <>
      <Card>
        <SkeletonBlock h={22} w="40%" style={{ marginBottom:12 }} />
        <SkeletonBlock h={240} />
      </Card>
      <Card>
        <SkeletonBlock h={22} w="48%" style={{ marginBottom:12 }} />
        <SkeletonBlock h={220} />
      </Card>
    </>
  )
}

const titleStyle = {
  margin:'0 0 14px',
  fontSize:13,
  fontWeight:700,
  color:C.textSub,
  textTransform:'uppercase',
  letterSpacing:'0.08em',
}
