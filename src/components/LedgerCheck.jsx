import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { Card } from './UI.jsx'
import { buildMetrics } from '../financialMetrics.js'
import { reconcileLedger } from '../lib/financialLedger.js'

// Conferência do razão (pré-requisito da Fase 10). Duas seções:
//  A) Razão × Fonte — deve bater a centavo (prova que o razão capturou todos os registros).
//  B) Razão × Dashboard — comparativo informativo (algumas diferenças são esperadas: recorrências
//     não entram no razão ainda; vendas/compras "a conferir" contam como aberto no razão).
export function LedgerCheck({ data }) {
  const recon = reconcileLedger(data)
  const m = buildMetrics(data)
  const mReceivableOpen = (m.accountsReceivable || []).reduce((a, x) => a + (x.value || 0), 0)
  const mPayableOpen = (m.accountsPayable || []).reduce((a, x) => a + (x.value || 0), 0)

  const allMatch = recon.sources.every(s => Math.abs(s.diff) < 0.01)

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 18, lineHeight: 1.5 },
    h: { fontSize: 13, fontWeight: 800, color: C.text, margin: '6px 0 10px', letterSpacing: '0.02em' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` },
    tdR: { padding: '8px 10px', textAlign: 'right', color: C.text, borderBottom: `1px solid ${C.border}`, fontVariantNumeric: 'tabular-nums' },
    tdL: { padding: '8px 10px', color: C.text, borderBottom: `1px solid ${C.border}` },
    note: { fontSize: 11.5, color: C.textDim, marginTop: 10, lineHeight: 1.5 },
    badge: ok => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, color: ok ? (C.green || '#16a34a') : (C.red || '#ef4444'), background: `${ok ? (C.green || '#16a34a') : (C.red || '#ef4444')}18` }),
  }

  const diffCell = diff => (
    <span style={{ color: Math.abs(diff) < 0.01 ? (C.green || '#16a34a') : (C.red || '#ef4444'), fontWeight: 700 }}>
      {Math.abs(diff) < 0.01 ? '✓ 0,00' : fmt(diff)}
    </span>
  )

  const CompareRow = ({ label, dash, led, note }) => (
    <tr>
      <td style={s.tdL}>{label}{note && <div style={{ fontSize: 10.5, color: C.textDim }}>{note}</div>}</td>
      <td style={s.tdR}>{fmt(dash)}</td>
      <td style={s.tdR}>{fmt(led)}</td>
      <td style={s.tdR}>{diffCell((dash || 0) - (led || 0))}</td>
    </tr>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={s.intro}>
        Validação do <strong>razão financeiro</strong> (projeção) antes de virar a fonte de verdade das
        métricas. A seção <strong>A</strong> prova que o razão capturou todos os registros (tem que bater
        a centavo). A seção <strong>B</strong> compara com o dashboard atual — algumas diferenças são
        esperadas e estão explicadas.
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={s.h}>A) Razão × Fonte — reconciliação (deve bater a centavo)</div>
          <span style={s.badge(allMatch)}>{allMatch ? '✓ Tudo reconciliado' : '⚠ Há divergência'}</span>
        </div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Origem</th><th style={{ ...s.th, textAlign: 'right' }}>Fonte</th><th style={{ ...s.th, textAlign: 'right' }}>Razão</th><th style={{ ...s.th, textAlign: 'right' }}>Diferença</th></tr></thead>
          <tbody>
            {recon.sources.map(row => (
              <tr key={row.label}>
                <td style={s.tdL}>{row.label}</td>
                <td style={s.tdR}>{fmt(row.raw)}</td>
                <td style={s.tdR}>{fmt(row.ledger)}</td>
                <td style={s.tdR}>{diffCell(row.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div style={s.h}>B) Razão × Dashboard — comparativo (diferenças esperadas anotadas)</div>
        <table style={s.table}>
          <thead><tr><th style={s.th}>Indicador</th><th style={{ ...s.th, textAlign: 'right' }}>Dashboard</th><th style={{ ...s.th, textAlign: 'right' }}>Razão</th><th style={{ ...s.th, textAlign: 'right' }}>Δ</th></tr></thead>
          <tbody>
            <CompareRow label="Contas a receber (aberto)" dash={mReceivableOpen} led={recon.totals.receivableOpen}
              note="Δ esperado: recorrências de receita não entram no razão; vendas 'a conferir' entram como aberto." />
            <CompareRow label="Contas a pagar (aberto)" dash={mPayableOpen} led={recon.totals.payableOpen}
              note="Δ esperado: recorrências de despesa não entram no razão; compras 'a conferir' entram como aberto." />
            <CompareRow label="Receita bruta (competência)" dash={m.grossRevenue} led={round2SourcesRevenue(recon)}
              note="Δ esperado = recorrências de receita (ainda não modeladas no razão)." />
          </tbody>
        </table>
        <div style={s.note}>
          A seção B é informativa: o razão só vira a fonte de verdade (Fase 10) depois que a seção A
          estiver 100% reconciliada e as diferenças da B forem só as esperadas (recorrências e itens
          "a conferir"). Nada aqui altera dados.
        </div>
      </Card>
    </div>
  )
}

function round2SourcesRevenue(recon) {
  const rev = ['Cirurgias (receita)', 'Consultas (receita)', 'Vendas de produto', 'Receitas extras']
  return recon.sources.filter(s => rev.includes(s.label)).reduce((a, s) => a + s.ledger, 0)
}
