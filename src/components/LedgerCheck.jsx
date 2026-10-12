import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { Card } from './UI.jsx'
import { buildMetrics } from '../financialMetrics.js'
import { auditLedgerReadiness } from '../lib/financialLedger.js'

// Conferência contínua da fonte financeira canônica. Um gate + duas reconciliações:
//  Gate) integridade e cobertura dos dados de autoridade — sem bloqueios na fonte ativa.
//  A) Razão × Fonte — deve bater a centavo (prova que o razão capturou todos os registros).
//  B) Razão × Métricas — garante que os consumidores seguem a projeção canônica.
export function LedgerCheck({ data }) {
  const audit = auditLedgerReadiness(data)
  const recon = audit.reconciliation
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
    issue: severity => ({ padding:'10px 12px', borderRadius:10, border:`1px solid ${severity === 'blocking' ? C.red : C.yellow}44`, background:`${severity === 'blocking' ? C.red : C.yellow}0D` }),
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
        Auditoria contínua do <strong>razão financeiro</strong>, que agora alimenta as métricas e os
        relatórios. A seção <strong>A</strong> prova que todos os registros foram capturados a centavo;
        a seção <strong>B</strong> verifica se os principais indicadores continuam coerentes.
      </div>

      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={s.h}>Integridade da fonte financeira</div>
            <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5, maxWidth:720 }}>
              A fonte canônica permanece íntegra quando não há parcelas divergentes nem liquidações
              sem data financeira verificável.
            </div>
          </div>
          <span style={s.badge(audit.ready)}>
            {audit.ready ? '✓ Fonte ativa · dados íntegros' : `⚠ Bloqueado · ${audit.blockers.reduce((sum, item) => sum + item.count, 0)} ocorrência(s)`}
          </span>
        </div>

        {audit.issues.length === 0 ? (
          <div style={{ marginTop:14, padding:'12px 14px', borderRadius:10, color:C.green, background:`${C.green}12`, fontSize:13 }}>
            Nenhuma pendência estrutural encontrada. O razão está apto a alimentar os indicadores financeiros.
          </div>
        ) : (
          <div style={{ display:'grid', gap:8, marginTop:14 }}>
            {audit.issues.map(issue => (
              <div key={issue.code} style={s.issue(issue.severity)} data-testid={`ledger-issue-${issue.code}`}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'baseline' }}>
                  <strong style={{ color:issue.severity === 'blocking' ? C.red : C.yellow, fontSize:12.5 }}>
                    {issue.severity === 'blocking' ? 'Bloqueio' : 'Atenção'} · {issue.label}
                  </strong>
                  <span style={{ color:C.text, fontWeight:800, fontSize:12 }}>{issue.count}</span>
                </div>
                <div style={{ color:C.textSub, fontSize:11.5, lineHeight:1.45, marginTop:3 }}>{issue.detail}</div>
                {issue.sampleIds.length > 0 && (
                  <div style={{ color:C.textDim, fontSize:10.5, marginTop:4 }}>
                    Exemplos: {issue.sampleIds.join(', ')}{issue.count > issue.sampleIds.length ? '…' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={s.h}>A) Razão × Fonte — reconciliação (deve bater a centavo)</div>
          <span style={s.badge(allMatch)}>{allMatch ? '✓ Tudo reconciliado' : '⚠ Há divergência'}</span>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ ...s.table, minWidth:620 }}>
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
        </div>
      </Card>

      <Card>
        <div style={s.h}>B) Razão × Métricas — consistência dos consumidores</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ ...s.table, minWidth:680 }}>
            <thead><tr><th style={s.th}>Indicador</th><th style={{ ...s.th, textAlign: 'right' }}>Dashboard</th><th style={{ ...s.th, textAlign: 'right' }}>Razão</th><th style={{ ...s.th, textAlign: 'right' }}>Δ</th></tr></thead>
            <tbody>
              <CompareRow label="Contas a receber (aberto)" dash={mReceivableOpen} led={recon.totals.receivableOpen}
                note="Recorrências ainda são anexadas às métricas fora do razão; os títulos operacionais vêm da fonte canônica." />
              <CompareRow label="Contas a pagar (aberto)" dash={mPayableOpen} led={recon.totals.payableOpen}
                note="Recorrências ainda são anexadas às métricas fora do razão; os títulos operacionais vêm da fonte canônica." />
              <CompareRow label="Receita bruta (competência)" dash={m.grossRevenue} led={round2SourcesRevenue(recon)}
                note="Uma diferença só é esperada quando existirem receitas recorrentes ainda não materializadas em lançamento." />
            </tbody>
          </table>
        </div>
        <div style={s.note}>
          Esta tela é somente leitura. A seção A reconcilia a origem; a seção B monitora os principais
          consumidores da fonte canônica. Recorrências continuam identificadas separadamente até ganharem
          títulos próprios no razão.
        </div>
      </Card>
    </div>
  )
}

function round2SourcesRevenue(recon) {
  const rev = ['Cirurgias (receita)', 'Consultas (receita)', 'Vendas de produto', 'Receitas extras']
  return recon.sources.filter(s => rev.includes(s.label)).reduce((a, s) => a + s.ledger, 0)
}
