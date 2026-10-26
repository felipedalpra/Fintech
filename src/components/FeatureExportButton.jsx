import { useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { Btn, Modal } from './UI.jsx'
import { ExportPeriodFields } from './ExportPeriodFields.jsx'
import { emptyExportPeriod } from '../lib/exportPeriod.js'

const EXPORTABLE_PAGES = new Set([
  'plans', 'sales', 'consultations', 'calendar', 'products', 'finance', 'cashflow', 'dre', 'balance',
  'goals', 'recurrences', 'ledger-check', 'chart-of-accounts', 'bank-reconciliation', 'financial-import',
  'patients', 'funnel', 'crm-painel', 'meu-dia', 'tarefas', 'inbox', 'ads', 'clinical-records',
])

export function FeatureExportButton({ page, data, clinicName, compact = false }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [period, setPeriod] = useState(emptyExportPeriod)

  if (!EXPORTABLE_PAGES.has(page)) return null

  async function run() {
    if (exporting) return
    setExporting(true)
    setError('')
    try {
      const { exportFeatureWorkbook } = await import('../lib/platformExport.js')
      await exportFeatureWorkbook({ featureId:page, data, clinicName, database:supabase, period })
      setOpen(false)
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
        onClick={() => { setError(''); setOpen(true) }}
        disabled={exporting}
        title={error || 'Escolher o período e baixar os dados desta funcionalidade em Excel'}
        aria-label={error || 'Escolher período para exportar esta funcionalidade em Excel'}
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
      <Modal open={open} onClose={() => !exporting && setOpen(false)} title="Exportar dados em Excel" width={460} trackDirty={false} closeOnBackdrop={!exporting}>
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <p style={{ color:C.textSub, fontSize:13, lineHeight:1.6, margin:0 }}>
            Escolha quais datas devem entrar na planilha desta funcionalidade.
          </p>
          <ExportPeriodFields value={period} onChange={setPeriod} disabled={exporting} />
          {error ? <span role="alert" style={{ color:C.red, fontSize:12 }}>{error}</span> : null}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, flexWrap:'wrap' }}>
            <Btn variant="ghost" onClick={() => setOpen(false)} disabled={exporting}>Cancelar</Btn>
            <Btn onClick={run} disabled={exporting}>{exporting ? 'Gerando Excel…' : '↓ Baixar Excel'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
