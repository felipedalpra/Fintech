import { useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'

const EXPORTABLE_PAGES = new Set([
  'plans', 'sales', 'consultations', 'calendar', 'products', 'finance', 'cashflow', 'dre', 'balance',
  'goals', 'recurrences', 'ledger-check', 'chart-of-accounts', 'bank-reconciliation', 'financial-import',
  'patients', 'funnel', 'crm-painel', 'meu-dia', 'tarefas', 'inbox', 'ads', 'clinical-records',
])

export function FeatureExportButton({ page, data, clinicName, compact = false }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  if (!EXPORTABLE_PAGES.has(page)) return null

  async function run() {
    if (exporting) return
    setExporting(true)
    setError('')
    try {
      const { exportFeatureWorkbook } = await import('../lib/platformExport.js')
      await exportFeatureWorkbook({ featureId:page, data, clinicName, database:supabase })
    } catch (nextError) {
      setError(nextError?.message || 'Não foi possível gerar o Excel.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
      <button
        type="button"
        onClick={run}
        disabled={exporting}
        title={error || 'Baixar os dados desta funcionalidade em Excel'}
        aria-label={error || 'Exportar esta funcionalidade em Excel'}
        style={{
          border:`1px solid ${error ? C.red : C.border}`,
          background:error ? C.red+'12' : 'transparent',
          color:error ? C.red : C.textSub,
          borderRadius:10,
          minHeight:34,
          padding:compact ? '0 10px' : '7px 11px',
          fontSize:12,
          fontWeight:700,
          fontFamily:'inherit',
          cursor:exporting ? 'wait' : 'pointer',
          opacity:exporting ? 0.65 : 1,
          whiteSpace:'nowrap',
        }}
      >
        {exporting ? 'Gerando…' : error ? 'Falha — tentar novamente' : compact ? '↓ Excel' : '↓ Exportar Excel'}
      </button>
      {error && !compact ? <span role="alert" style={{ color:C.red, fontSize:11, maxWidth:220 }}>{error}</span> : null}
    </div>
  )
}
