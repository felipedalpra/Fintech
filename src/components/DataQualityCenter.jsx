import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { auditLedgerReadiness } from '../lib/financialLedger.js'
import { Btn, Card } from './UI.jsx'

export function buildDataQualitySummary(data = {}) {
  const audit = auditLedgerReadiness(data)
  const uncategorized = [
    ...(data.extraRevenues || []).filter(item => !item.categoryId && !item.category),
    ...(data.expenses || []).filter(item => !item.categoryId && !item.category),
  ]
  const duplicates = []
  const seen = new Map()
  ;[...(data.extraRevenues || []), ...(data.expenses || [])].forEach(item => {
    const key = [item.type || '', item.description || item.name || '', Number(item.value || 0).toFixed(2), item.date || item.dueDate || ''].join('|').toLowerCase()
    if (seen.has(key)) duplicates.push(item)
    else seen.set(key, item)
  })
  return {
    audit,
    uncategorized,
    duplicates,
    totalIssues:audit.issues.length + (uncategorized.length ? 1 : 0) + (duplicates.length ? 1 : 0),
  }
}

export function DataQualityCenter({ data }) {
  const navigate = useNavigate()
  const summary = useMemo(() => buildDataQualitySummary(data), [data])
  const { audit, uncategorized, duplicates } = summary
  const cards = [
    { label:'Bloqueios do razão', value:audit.blockers.length, color:C.red || '#ef4444', detail:'Datas ou situações que impedem plena fidedignidade.' },
    { label:'Avisos do razão', value:audit.warnings.length, color:C.yellow || '#f59e0b', detail:'Dados preservados, mas que podem fragmentar análises.' },
    { label:'Sem categoria', value:uncategorized.length, color:C.accent, detail:'Receitas e despesas sem classificação explícita.' },
    { label:'Possíveis duplicidades', value:duplicates.length, color:C.purple || '#8b5cf6', detail:'Mesmo texto, valor e data; revise antes de agir.' },
  ]
  const issues = [
    ...audit.issues,
    ...(uncategorized.length ? [{ code:'uncategorized', severity:'warning', title:'Lançamentos sem categoria', count:uncategorized.length, guidance:'Classifique no lançamento ou no plano de contas.' }] : []),
    ...(duplicates.length ? [{ code:'duplicates', severity:'warning', title:'Possíveis lançamentos duplicados', count:duplicates.length, guidance:'Compare os registros; nada será removido automaticamente.' }] : []),
  ]

  return <div style={{ display:'grid', gap:18 }} data-testid="data-quality-center">
    <Card style={{ padding:20, border:`1px solid ${audit.ready ? C.green : C.yellow}44`, background:`linear-gradient(135deg, ${C.card}, ${C.surface})` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div><div style={{ color:audit.ready ? C.green : C.yellow, fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'.08em' }}>{audit.ready ? 'Razão consistente' : 'Revisão recomendada'}</div><h2 style={{ margin:'5px 0 4px', color:C.text, fontSize:21 }}>Qualidade dos dados financeiros</h2><p style={{ margin:0, color:C.textSub, fontSize:13, lineHeight:1.6 }}>Diagnóstico derivado do razão canônico. Esta tela não altera totais nem corrige dados automaticamente.</p></div>
        <Btn onClick={() => navigate('/app/ledger-check')}>Abrir conferência do razão</Btn>
      </div>
    </Card>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:12 }}>{cards.map(card => <Card key={card.label} style={{ padding:16 }}><div style={{ color:C.textSub, fontSize:11, fontWeight:800, textTransform:'uppercase' }}>{card.label}</div><div style={{ color:card.color, fontSize:30, fontWeight:900, margin:'5px 0' }}>{card.value}</div><div style={{ color:C.textDim, fontSize:11, lineHeight:1.5 }}>{card.detail}</div></Card>)}</div>
    <Card style={{ padding:0, overflow:'hidden' }}>
      <div style={{ padding:'15px 18px', borderBottom:`1px solid ${C.border}`, color:C.text, fontWeight:800 }}>Fila de revisão</div>
      {issues.length === 0 ? <div style={{ padding:28, textAlign:'center', color:C.textSub }}>Nenhuma pendência detectada. ✓</div> : issues.map(issue => <div key={issue.code} style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'grid', gridTemplateColumns:'auto 1fr auto', gap:12, alignItems:'start' }}><span style={{ width:9, height:9, borderRadius:'50%', marginTop:5, background:issue.severity === 'blocking' ? C.red : C.yellow }} /><div><div style={{ color:C.text, fontWeight:700, fontSize:13 }}>{issue.title || issue.label}</div><div style={{ color:C.textSub, fontSize:12, marginTop:3, lineHeight:1.5 }}>{issue.guidance || issue.detail}</div></div><span style={{ color:C.textSub, fontSize:12, fontWeight:800 }}>{issue.count}</span></div>)}
    </Card>
  </div>
}
