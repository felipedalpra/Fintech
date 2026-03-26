import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, getPeriodRange, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Modal, Btn, FInput } from './UI.jsx'

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvRow(cells) {
  return cells.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')
}

function downloadCSV(filename, rows) {
  const bom = '\uFEFF'
  const content = bom + rows.join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Export builders ─────────────────────────────────────────────────────────

function buildEntradas(m) {
  const header = csvRow(['Data', 'Categoria', 'Descrição', 'Origem', 'Valor (R$)'])
  const rows = m.entriesFinancial.map(item =>
    csvRow([item.date, item.category, item.description, item.origin, item.value.toFixed(2).replace('.', ',')])
  )
  const total = m.entriesFinancial.reduce((acc, i) => acc + i.value, 0)
  return [header, ...rows, csvRow(['', '', '', 'TOTAL', total.toFixed(2).replace('.', ',')])]
}

function buildSaidas(m) {
  const header = csvRow(['Data', 'Categoria', 'Descrição', 'Origem', 'Valor (R$)'])
  const rows = m.exitsFinancial.map(item =>
    csvRow([item.date, item.category, item.description, item.origin, item.value.toFixed(2).replace('.', ',')])
  )
  const total = m.exitsFinancial.reduce((acc, i) => acc + i.value, 0)
  return [header, ...rows, csvRow(['', '', '', 'TOTAL', total.toFixed(2).replace('.', ',')])]
}

function buildLivroCaixa(m) {
  const rows = [
    csvRow(['LIVRO CAIXA', '', '', '', '']),
    csvRow(['Data', 'Histórico', 'Entradas (R$)', 'Saídas (R$)', 'Saldo (R$)']),
  ]
  let saldo = 0
  const allEntries = [
    ...m.entriesFinancial.map(i => ({ date: i.date, desc: i.description, entrada: i.value, saida: 0 })),
    ...m.exitsFinancial.map(i => ({ date: i.date, desc: i.description, entrada: 0, saida: i.value })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  for (const item of allEntries) {
    saldo += item.entrada - item.saida
    rows.push(csvRow([
      item.date,
      item.desc,
      item.entrada > 0 ? item.entrada.toFixed(2).replace('.', ',') : '',
      item.saida > 0 ? item.saida.toFixed(2).replace('.', ',') : '',
      saldo.toFixed(2).replace('.', ','),
    ]))
  }

  rows.push(csvRow(['', 'SALDO FINAL', '', '', saldo.toFixed(2).replace('.', ',')]))
  return rows
}

function buildDRE(m, period) {
  const rows = [
    csvRow([`DRE — ${period}`, '']),
    csvRow(['Item', 'Valor (R$)']),
    csvRow(['Receita bruta total', (m.surgeryRevenue + m.consultationRevenue + m.productSalesRevenue + m.extraRevenueTotal).toFixed(2).replace('.', ',')]),
    csvRow(['  (-) Custos de cirurgias', m.surgeryCostTotal.toFixed(2).replace('.', ',')]),
    csvRow(['  Receita líquida cirurgias', (m.surgeryRevenue - m.surgeryCostTotal).toFixed(2).replace('.', ',')]),
    csvRow(['  Receita de consultas', m.consultationRevenue.toFixed(2).replace('.', ',')]),
    csvRow(['  Receita de produtos', m.productSalesRevenue.toFixed(2).replace('.', ',')]),
    csvRow(['  Outras receitas', m.extraRevenueTotal.toFixed(2).replace('.', ',')]),
    csvRow(['= Receita operacional total', m.grossRevenue.toFixed(2).replace('.', ',')]),
    csvRow(['(-) Despesas operacionais', m.operationalExpenses.toFixed(2).replace('.', ',')]),
    csvRow(['= Lucro operacional', m.operatingProfit.toFixed(2).replace('.', ',')]),
    csvRow(['(-) Impostos', m.taxExpenses?.toFixed(2).replace('.', ',') ?? '0,00']),
    csvRow(['= Lucro líquido', m.netProfit.toFixed(2).replace('.', ',')]),
    csvRow(['Margem líquida %', m.grossRevenue > 0 ? ((m.netProfit / m.grossRevenue) * 100).toFixed(1) + '%' : '0,0%']),
  ]
  return rows
}

function buildFluxoCaixa(m) {
  const grouped = {}
  m.cashFlowEntries.forEach(item => {
    const key = item.date
    if (!grouped[key]) grouped[key] = { date: key, entradas: 0, saidas: 0 }
    if (item.type === 'entrada') grouped[key].entradas += item.value
    if (item.type === 'saida') grouped[key].saidas += item.value
  })
  const sorted = Object.values(grouped).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const rows = [
    csvRow(['FLUXO DE CAIXA', '', '', '']),
    csvRow(['Data', 'Entradas (R$)', 'Saídas (R$)', 'Saldo do Dia (R$)']),
    ...sorted.map(item => csvRow([
      item.date,
      item.entradas.toFixed(2).replace('.', ','),
      item.saidas.toFixed(2).replace('.', ','),
      (item.entradas - item.saidas).toFixed(2).replace('.', ','),
    ])),
  ]
  return rows
}

// ─── Component ───────────────────────────────────────────────────────────────

const PERIOD_LABELS = {
  day: 'Dia', week: 'Semana', month: 'Mês', quarter: 'Trimestre', year: 'Ano',
}

export function ExportModal({ open, onClose, data }) {
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start: '', end: '' })
  const [selected, setSelected] = useState({ entradas: true, saidas: true, livroCaixa: true, dre: true, fluxo: false })

  const range = getPeriodRange(period, customRange)
  const m = useMemo(() => buildMetrics(data, { startDate: range.start, endDate: range.end, balanceDate: range.end || today() }), [data, range.start, range.end])

  const periodLabel = period === 'custom'
    ? `${range.start || '?'}_${range.end || '?'}`
    : `${PERIOD_LABELS[period] || period}_${range.start || today().slice(0, 7)}`

  const toggle = key => setSelected(prev => ({ ...prev, [key]: !prev[key] }))

  const exportAll = () => {
    if (selected.entradas) downloadCSV(`Entradas_${periodLabel}.csv`, buildEntradas(m))
    if (selected.saidas) downloadCSV(`Saidas_${periodLabel}.csv`, buildSaidas(m))
    if (selected.livroCaixa) downloadCSV(`LivroCaixa_${periodLabel}.csv`, buildLivroCaixa(m))
    if (selected.dre) downloadCSV(`DRE_${periodLabel}.csv`, buildDRE(m, periodLabel))
    if (selected.fluxo) downloadCSV(`FluxoCaixa_${periodLabel}.csv`, buildFluxoCaixa(m))
    onClose()
  }

  const anySelected = Object.values(selected).some(Boolean)

  const grossRevenue = m.surgeryRevenue + m.consultationRevenue + m.productSalesRevenue + m.extraRevenueTotal

  return (
    <Modal open={open} onClose={onClose} title="Exportar para Contador" width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Period selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Período</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['day', 'week', 'month', 'quarter', 'year', 'custom'].map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{
                  padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${period === p ? C.accent : C.border}`,
                  background: period === p ? C.accent + '18' : 'transparent',
                  color: period === p ? C.accentLight : C.textSub,
                }}>
                {PERIOD_LABELS[p] || 'Personalizado'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <FInput label="De" type="date" value={customRange.start} onChange={v => setCustomRange(c => ({ ...c, start: v }))} />
              <FInput label="Até" type="date" value={customRange.end} onChange={v => setCustomRange(c => ({ ...c, end: v }))} />
            </div>
          )}
        </div>

        {/* Preview totals */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Resumo do período</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Receita bruta', grossRevenue, C.green],
              ['Despesas', m.operationalExpenses, C.red],
              ['Lucro operacional', m.operatingProfit, m.operatingProfit >= 0 ? C.green : C.red],
              ['Entradas no caixa', m.cashFlowEntries.filter(e => e.type === 'entrada').reduce((acc, i) => acc + i.value, 0), C.cyan],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: C.card, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color }}>{fmt(value)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* File selection */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>Arquivos a exportar (CSV)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['entradas', 'Entradas financeiras', 'Todas as receitas recebidas no período'],
              ['saidas', 'Saídas financeiras', 'Todos os custos e despesas pagos'],
              ['livroCaixa', 'Livro Caixa', 'Histórico cronológico com saldo acumulado'],
              ['dre', 'DRE (Resultado)', 'Demonstração de resultado por competência'],
              ['fluxo', 'Fluxo de Caixa', 'Entradas e saídas agrupadas por data'],
            ].map(([key, label, desc]) => (
              <div
                key={key}
                onClick={() => toggle(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                  borderRadius: 10, border: `1px solid ${selected[key] ? C.accent + '55' : C.border}`,
                  background: selected[key] ? C.accent + '0A' : 'transparent',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 5, border: `2px solid ${selected[key] ? C.accent : C.border}`,
                  background: selected[key] ? C.accent : 'transparent', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected[key] && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={exportAll} disabled={!anySelected}>
            ↓ Baixar {Object.values(selected).filter(Boolean).length} arquivo(s)
          </Btn>
        </div>

        <p style={{ margin: 0, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
          Os arquivos CSV são compatíveis com Excel, Google Sheets e sistemas contábeis. O separador utilizado é ponto-e-vírgula (;) com codificação UTF-8.
        </p>
      </div>
    </Modal>
  )
}
