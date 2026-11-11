import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt, today } from '../utils.js'
import { Btn, Card } from './UI.jsx'
import { auditLedgerReadiness } from '../lib/financialLedger.js'
import { buildLedgerConsumerComparison } from '../lib/ledgerCheckDiagnostics.js'

// Conferência contínua da fonte financeira canônica. Um gate + duas reconciliações:
//  Gate) integridade e cobertura dos dados de autoridade — sem bloqueios na fonte ativa.
//  A) Razão × Fonte — deve bater a centavo (prova que o razão capturou todos os registros).
//  B) Razão × Métricas — garante que os consumidores seguem a projeção canônica.
export function LedgerCheck({ data }) {
  const navigate = useNavigate()
  const audit = auditLedgerReadiness(data)
  const recon = audit.reconciliation
  const currentDate = today()
  const comparison = buildLedgerConsumerComparison(data, currentDate)
  const m = comparison.metrics
  const mReceivableOpen = (m.accountsReceivable || []).reduce((a, x) => a + (x.value || 0), 0)
  const mPayableOpen = (m.accountsPayable || []).reduce((a, x) => a + (x.value || 0), 0)
  const comparisonTotals = ledgerOpenTotals(comparison.ledger, currentDate)

  const allMatch = recon.sources.every(s => Math.abs(s.diff) < 0.01)
  const consumerChecks = [
    { key:'receivable', label:'Contas a receber (aberto)', dash:mReceivableOpen, led:comparisonTotals.receivableOpen, note:'Inclui ocorrências recorrentes ainda não materializadas.' },
    { key:'payable', label:'Contas a pagar (aberto)', dash:mPayableOpen, led:comparisonTotals.payableOpen, note:'Inclui ocorrências recorrentes ainda não materializadas.' },
    { key:'gross-revenue', label:'Receita bruta operacional (competência)', dash:m.grossRevenue, led:comparison.operatingGrossRevenue, note:'Compara somente receitas operacionais; receitas financeiras ficam no resultado financeiro da DRE.' },
    ...(comparison.financialRevenue > 0 ? [{ key:'financial-revenue', label:'Receitas financeiras (competência)', dash:m.financialRevenue, led:comparison.financialRevenue, note:'Exibidas separadamente da receita bruta operacional.' }] : []),
  ].map(item => ({ ...item, diff:Math.round(((item.dash || 0) - (item.led || 0)) * 100) / 100 }))
  const consumerMismatches = consumerChecks.filter(item => Math.abs(item.diff) >= 0.01)
  const consumerAllMatch = consumerMismatches.length === 0

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

  const CompareRow = ({ row }) => (
    <tr data-testid={`ledger-consumer-${row.key}`}>
      <td style={s.tdL}>{row.label}{row.note && <div style={{ fontSize: 10.5, color: C.textDim }}>{row.note}</div>}</td>
      <td style={s.tdR}>{fmt(row.dash)}</td>
      <td style={s.tdR}>{fmt(row.led)}</td>
      <td style={s.tdR}>{diffCell(row.diff)}</td>
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <div style={s.h}>B) Razão × Métricas — consistência dos indicadores</div>
            <div style={{ fontSize:11.5, color:C.textSub, lineHeight:1.5 }}>
              Cada linha compara o valor exibido com o Razão usando exatamente o mesmo critério contábil.
            </div>
          </div>
          <span style={s.badge(consumerAllMatch)}>{consumerAllMatch ? '✓ Indicadores coerentes' : `⚠ ${consumerMismatches.length} diferença(s) real(is)`}</span>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ ...s.table, minWidth:680 }}>
            <thead><tr><th style={s.th}>Indicador na tela</th><th style={{ ...s.th, textAlign:'right' }}>Valor exibido</th><th style={{ ...s.th, textAlign:'right' }}>Razão no mesmo critério</th><th style={{ ...s.th, textAlign:'right' }}>Diferença</th></tr></thead>
            <tbody>
              {consumerChecks.map(row => <CompareRow key={row.key} row={row} />)}
            </tbody>
          </table>
        </div>

        {comparison.financialRevenue > 0 && (
          <div data-testid="ledger-financial-revenue-explanation" style={{ marginTop:14, padding:'14px 16px', borderRadius:12, border:`1px solid ${C.accent}55`, background:`${C.accent}0D` }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:14, alignItems:'flex-start', flexWrap:'wrap' }}>
              <div style={{ maxWidth:760 }}>
                <strong style={{ display:'block', color:C.text, fontSize:13.5 }}>
                  {fmt(comparison.financialRevenue)} estão no Resultado financeiro — não é valor perdido
                </strong>
                <div style={{ marginTop:5, color:C.textSub, fontSize:12, lineHeight:1.55 }}>
                  O Razão preserva esse valor, mas ele foi classificado como <strong>receita financeira</strong>.
                  Por isso aparece separado da receita bruta operacional na DRE. Se a classificação estiver correta,
                  nenhuma correção é necessária; se for receita de atendimento ou venda, revise a conta vinculada.
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <Btn variant="ghost" onClick={() => navigate('/app/finance')}>Revisar lançamentos</Btn>
                <Btn onClick={() => navigate('/app/chart-of-accounts')}>Revisar classificação</Btn>
              </div>
            </div>
            {comparison.financialRevenueDetails.length > 0 && (
              <div style={{ display:'grid', gap:6, marginTop:12 }}>
                {comparison.financialRevenueDetails.slice(0, 5).map(item => (
                  <div key={item.id} style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap', padding:'8px 10px', borderRadius:8, background:C.surface, color:C.textSub, fontSize:11.5 }}>
                    <span style={{ minWidth:0 }}>
                      <strong style={{ display:'block', color:C.text, overflowWrap:'anywhere' }}>{item.description}</strong>
                      <small style={{ color:C.textDim }}>{item.account}{item.competenceDate ? ` · ${formatDate(item.competenceDate)}` : ''}</small>
                    </span>
                    <strong style={{ color:C.text, fontVariantNumeric:'tabular-nums' }}>{fmt(item.value)}</strong>
                  </div>
                ))}
                {comparison.financialRevenueDetails.length > 5 && <div style={{ color:C.textDim, fontSize:11 }}>Mais {comparison.financialRevenueDetails.length - 5} lançamento(s) com a mesma classificação.</div>}
              </div>
            )}
          </div>
        )}

        {!consumerAllMatch && (
          <div role="alert" data-testid="ledger-consumer-mismatch-help" style={{ marginTop:14, padding:'14px 16px', borderRadius:12, border:`1px solid ${C.red}55`, background:`${C.red}0D` }}>
            <strong style={{ display:'block', color:C.red, fontSize:13.5 }}>Há uma diferença real que precisa de revisão</strong>
            <div style={{ marginTop:5, color:C.textSub, fontSize:12, lineHeight:1.55 }}>
              {consumerMismatches.map(item => `${item.label}: ${fmt(item.diff)}`).join(' · ')}.
              Abra a qualidade dos dados para localizar datas, situações ou classificações incompletas; nenhum valor será alterado automaticamente.
            </div>
            <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
              <Btn variant="ghost" onClick={() => navigate('/app/finance')}>Abrir lançamentos</Btn>
              <Btn onClick={() => navigate('/app/data-quality')}>Diagnosticar pendências</Btn>
            </div>
          </div>
        )}
        <div style={s.note}>
          Esta conferência é somente leitura: os botões levam ao cadastro correto para revisão, mas nunca
          alteram valores automaticamente. A seção A confere se a origem chegou ao Razão; a seção B confere
          se cada indicador está lendo o mesmo conjunto de títulos.
        </div>
      </Card>
    </div>
  )
}

function formatDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function ledgerOpenTotals(ledger, balanceDate) {
  return ledger.entries.reduce((totals, entry, index) => {
    if (entry.status === 'canceled' || (entry.issue_date && entry.issue_date > balanceDate)) return totals
    const open = (ledger.installments[index] || []).reduce((sum, row) => {
      if (row.settlement_date && row.settlement_date <= balanceDate) return sum
      return sum + Math.max(0, Number(row.amount || 0) - Number(row.paid_amount || 0))
    }, 0)
    if (entry.direction === 'receivable') totals.receivableOpen += open
    else totals.payableOpen += open
    return totals
  }, { receivableOpen:0, payableOpen:0 })
}
