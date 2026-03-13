import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, getPeriodRange, today, uid } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'

const EXTRA_REVENUE_EMPTY = { description:'', category:'outras_receitas', value:0, date:today() }
const EXPENSE_EMPTY = { description:'', category:'outros', value:0, dueDate:today(), paymentDate:'', status:'aberto' }
const BALANCE_EMPTY = { name:'', category:'banco', value:0, notes:'' }

const EXPENSE_CATEGORIES = ['aluguel', 'salarios', 'marketing', 'hospital', 'anestesia', 'equipamentos', 'softwares', 'impostos', 'outros']
const SUMMARY_CARDS = [
  ['Caixa realizado', 'cashBalance', C.cyan],
  ['Lucro líquido', 'netProfit', 'dynamic-profit'],
  ['Contas a receber', 'receivablesOpenTotal', C.accent],
  ['Contas a pagar', 'payablesOpenTotal', C.yellow],
]

export function Finance({ data, setData, defaultTab = 'entradas' }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const { financialPrivacyMode } = useFinancialPrivacy()
  const [tab, setTab] = useState(defaultTab)
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [modalType, setModalType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [form, setForm] = useState(EXTRA_REVENUE_EMPTY)
  const range = getPeriodRange(period, customRange)
  const m = buildMetrics(data, { startDate:range.start, endDate:range.end, balanceDate:range.end || today() })
  const money = value => maskFinancialValue(value, financialPrivacyMode, fmt)

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

  const flowRows = useMemo(() => {
    const grouped = {}
    m.cashFlowEntries.forEach(item => {
      const key = item.date
      if (!grouped[key]) grouped[key] = { date:key, entradas:0, saidas:0, saldo:0 }
      if (item.type === 'entrada') grouped[key].entradas += item.value
      if (item.type === 'saida') grouped[key].saidas += item.value
      grouped[key].saldo = grouped[key].entradas - grouped[key].saidas
    })
    return Object.values(grouped).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [m])

  const openAdd = type => {
    const defaults = {
      extra:EXTRA_REVENUE_EMPTY,
      expense:EXPENSE_EMPTY,
      asset:BALANCE_EMPTY,
      liability:BALANCE_EMPTY,
    }[type]
    setModalType(type)
    setForm(defaults)
    setEditing(null)
    setShowModal(true)
  }

  const openEdit = (type, item) => {
    setModalType(type)
    setForm({ ...item })
    setEditing(item.id)
    setShowModal(true)
  }

  const save = () => {
    if (modalType === 'extra') {
      if (!form.description) return
      setData(current => ({ ...current, extraRevenues: editing ? current.extraRevenues.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.extraRevenues, { ...form, id:uid() }] }))
    }
    if (modalType === 'expense') {
      if (!form.description) return
      setData(current => ({ ...current, expenses: editing ? current.expenses.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.expenses, { ...form, id:uid() }] }))
    }
    if (modalType === 'asset') {
      if (!form.name) return
      setData(current => ({ ...current, assets: editing ? current.assets.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.assets, { ...form, id:uid() }] }))
    }
    if (modalType === 'liability') {
      if (!form.name) return
      setData(current => ({ ...current, liabilities: editing ? current.liabilities.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.liabilities, { ...form, id:uid() }] }))
    }
    setShowModal(false)
  }

  const markReceivableAsPaid = item => {
    if (item.source === 'cirurgia') {
      setData(current => ({ ...current, surgeries:current.surgeries.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'pago', paymentDate:today() } : record) }))
    }
    if (item.source === 'consulta') {
      setData(current => ({ ...current, consultations:current.consultations.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'pago', paymentDate:today() } : record) }))
    }
  }

  const markExpenseAsPaid = item => {
    setData(current => ({ ...current, expenses:current.expenses.map(record => record.id === item.sourceId ? { ...record, status:'pago', paymentDate:today() } : record) }))
  }

  const removeRecord = record => {
    const collection = { extra:'extraRevenues', expense:'expenses', asset:'assets', liability:'liabilities' }[record.type]
    setData(current => ({ ...current, [collection]:current[collection].filter(item => item.id !== record.id) }))
  }

  const tabs = [
    ['entradas', 'Entradas'],
    ['saidas', 'Saídas'],
    ['receber', 'Contas a receber'],
    ['pagar', 'Contas a pagar'],
    ['dre', 'DRE'],
    ['balanco', 'Balanço'],
    ['fluxo', 'Fluxo de caixa'],
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ position:'sticky', top:0, zIndex:5, marginBottom:2 }}>
        <div style={{ background:'linear-gradient(180deg, rgba(7,11,18,0.98), rgba(7,11,18,0.92))', border:`1px solid ${C.border}66`, borderRadius:18, padding:16, backdropFilter:'blur(12px)' }}>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
            <select value={period} onChange={e => setPeriod(e.target.value)} style={{ minWidth:isMobile ? '100%' : 180, flex:isMobile ? '1 1 100%' : '0 0 auto' }}>
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="quarter">Trimestre</option>
              <option value="year">Ano</option>
              <option value="custom">Personalizado</option>
            </select>
            {period === 'custom' && <><input type="date" value={customRange.start} onChange={e => setCustomRange(current => ({ ...current, start:e.target.value }))} style={{ flex:isMobile ? '1 1 100%' : '0 0 auto' }} /><input type="date" value={customRange.end} onChange={e => setCustomRange(current => ({ ...current, end:e.target.value }))} style={{ flex:isMobile ? '1 1 100%' : '0 0 auto' }} /></>}
            <div style={{ marginLeft:isMobile ? 0 : 'auto', width:isMobile ? '100%' : 'auto', color:C.textDim, fontSize:12 }}>Período aplicado aos relatórios e demonstrativos.</div>
          </div>

          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
            {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={{ background:tab === id ? C.card : 'transparent', color:tab === id ? C.text : C.textSub, border:tab === id ? `1px solid ${C.border}` : '1px solid transparent', borderRadius:999, padding:'9px 14px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.2s', whiteSpace:'nowrap' }}>{label}</button>)}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:14 }}>
        {SUMMARY_CARDS.map(([label, key, color]) => {
          const value = m[key]
          const resolvedColor = color === 'dynamic-profit' ? (value >= 0 ? C.green : C.red) : color
          return <Card key={label} style={{ padding:18 }}><div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{label}</div><div style={{ fontSize:22, fontWeight:800, color:resolvedColor }}>{money(value)}</div></Card>
        })}
      </div>

      {tab === 'entradas' && <><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}><SectionTitle title="Entradas automáticas e receitas adicionais" subtitle="Cirurgias pagas, consultas recebidas, vendas de produtos e outras receitas." /><Btn onClick={() => openAdd('extra')}>+ Outra receita</Btn></div><RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor']} rows={m.entriesFinancial.map(item => ({ key:item.id, cells:[item.date, item.category, item.description, item.origin, <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>] }))} emptyMessage="Nenhuma entrada financeira no período." /></>}

      {tab === 'saidas' && <><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}><SectionTitle title="Saídas do período" subtitle="Custos cirúrgicos, compras de produtos e despesas administrativas pagas." /><Btn onClick={() => openAdd('expense')}>+ Nova despesa</Btn></div><RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor']} rows={m.exitsFinancial.map(item => ({ key:item.id, cells:[item.date, item.category, item.description, item.origin, <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>] }))} emptyMessage="Nenhuma saída financeira no período." /></>}

      {tab === 'receber' && <><SectionTitle title="Contas a receber" subtitle="Valores ainda não recebidos de cirurgias e consultas." /><RecordTable columns={['Origem', 'Paciente', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={m.accountsReceivable.map(item => ({ key:item.id, cells:[item.source, item.patient, item.description, item.dueDate, <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, <Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar recebido</Btn>] }))} emptyMessage="Nenhuma conta a receber em aberto." /></>}

      {tab === 'pagar' && <><SectionTitle title="Contas a pagar" subtitle="Despesas ainda não liquidadas pela clínica." /><RecordTable columns={['Categoria', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={m.accountsPayable.map(item => ({ key:item.id, cells:[item.category, item.supplier, item.dueDate, <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, <Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar pago</Btn>] }))} emptyMessage="Nenhuma conta a pagar em aberto." /></>}

      {tab === 'dre' && <Card><SectionTitle title="Demonstração do resultado" subtitle="Resultado por competência para o período selecionado." /><div style={{ marginTop:8 }}>{[['Receita bruta', m.grossRevenue, C.green], ['(-) Custos cirúrgicos', m.surgeryCostTotal, C.red], ['(-) Compras de produtos', m.productPurchaseTotal, C.red], ['(-) Despesas operacionais', m.operationalExpenses, C.red], ['= Lucro operacional', m.operatingProfit, m.operatingProfit >= 0 ? C.accent : C.red], ['(-) Impostos', m.taxExpenses, C.red], ['= Lucro líquido', m.netProfit, m.netProfit >= 0 ? C.green : C.red]].map(([label, value, color]) => <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'12px 0', borderTop:`1px solid ${C.border}22` }}><span style={{ color:C.textSub }}>{label}</span><span style={{ color, fontWeight:700 }}>{money(value)}</span></div>)}</div></Card>}

      {tab === 'balanco' && <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16 }}><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Ativos complementares" subtitle="Banco, aplicações e outros ativos fora do caixa operacional." compact /><Btn onClick={() => openAdd('asset')} style={{ padding:'7px 12px' }}>+ Ativo</Btn></div><BalanceList items={data.assets} color={C.green} onEdit={item => openEdit('asset', item)} onDelete={item => setConfirmState({ type:'asset', id:item.id })} emptyMessage="Nenhum ativo complementar." hidden={financialPrivacyMode} /></Card><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Passivos complementares" subtitle="Empréstimos, obrigações e passivos extras." compact /><Btn onClick={() => openAdd('liability')} style={{ padding:'7px 12px' }}>+ Passivo</Btn></div><BalanceList items={data.liabilities} color={C.red} onEdit={item => openEdit('liability', item)} onDelete={item => setConfirmState({ type:'liability', id:item.id })} emptyMessage="Nenhum passivo complementar." hidden={financialPrivacyMode} /></Card><Card style={{ gridColumn:'1 / -1' }}><SectionTitle title="Balanço patrimonial automático" subtitle="Posição financeira consolidada na data selecionada." /><div style={{ marginTop:8 }}>{[['Caixa', m.cashBalance, C.cyan], ['Contas a receber', m.receivablesOpenTotal, C.green], ['Banco e outros ativos', data.assets.reduce((acc, item) => acc + (item.value || 0), 0), C.accent], ['Contas a pagar', m.payablesOpenTotal, C.red], ['Passivos complementares', data.liabilities.reduce((acc, item) => acc + (item.value || 0), 0), C.red], ['Lucros acumulados / patrimônio', m.equity, m.equity >= 0 ? C.green : C.red]].map(([label, value, color]) => <div key={label} style={{ display:'flex', justifyContent:'space-between', gap:16, padding:'12px 0', borderTop:`1px solid ${C.border}22`, alignItems:'center', flexWrap:'wrap' }}><span style={{ color:C.textSub }}>{label}</span><span style={{ color, fontWeight:700 }}>{money(value)}</span></div>)}</div></Card></div>}

      {tab === 'fluxo' && <><SectionTitle title="Fluxo de caixa" subtitle="Entradas e saídas efetivamente realizadas, agrupadas por data." /><RecordTable columns={['Data', 'Entradas', 'Saídas', 'Saldo']} rows={flowRows.map(item => ({ key:item.date, cells:[item.date, <span style={{ color:C.green, fontWeight:700 }}>{money(item.entradas)}</span>, <span style={{ color:C.red, fontWeight:700 }}>{money(item.saidas)}</span>, <span style={{ color:item.saldo >= 0 ? C.green : C.red, fontWeight:700 }}>{money(item.saldo)}</span>] }))} emptyMessage="Nenhuma movimentação de caixa realizada no período." /></>}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar registro' : 'Novo registro'}>
        {modalType === 'extra' && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Descrição" required value={form.description} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Ex: retorno pago" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="outras_receitas" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Data" value={form.date} onChange={value => setForm(current => ({ ...current, date:value }))} type="date" /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.description} /></div>}
        {modalType === 'expense' && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Descrição" required value={form.description} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Ex: aluguel do consultório" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} options={EXPENSE_CATEGORIES.map(item => ({ v:item, l:item }))} /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Data de vencimento" value={form.dueDate} onChange={value => setForm(current => ({ ...current, dueDate:value }))} type="date" /><FInput label="Status" value={form.status} onChange={value => setForm(current => ({ ...current, status:value }))} options={[{ v:'aberto', l:'Aberto' }, { v:'pago', l:'Pago' }]} /><FInput label="Data do pagamento" value={form.paymentDate} onChange={value => setForm(current => ({ ...current, paymentDate:value }))} type="date" /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.description} /></div>}
        {(modalType === 'asset' || modalType === 'liability') && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Banco / empréstimo" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="banco" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Observações" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name} /></div>}
      </Modal>

      <ConfirmModal open={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={() => removeRecord(confirmState)} />
    </div>
  )
}

function RecordTable({ columns, rows, emptyMessage }) {
  return <Card style={{ padding:0, overflow:'hidden' }}><div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{columns.map(header => <th key={header} style={{ padding:'14px 18px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{header}</th>)}</tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={columns.length} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>{emptyMessage}</td></tr>}{rows.map(row => <tr key={row.key} style={{ borderBottom:`1px solid ${C.border}` }}>{row.cells.map((cell, index) => <td key={index} style={{ padding:'13px 18px', color:C.textSub, fontSize:13 }}>{cell}</td>)}</tr>)}</tbody></table></div></Card>
}

function BalanceList({ items, color, onEdit, onDelete, emptyMessage, hidden }) {
  if (items.length === 0) return <p style={{ color:C.textDim, fontSize:13 }}>{emptyMessage}</p>
  return items.map(item => <div key={item.id} style={{ padding:'14px 0', borderTop:`1px solid ${C.border}22`, display:'flex', justifyContent:'space-between', gap:16 }}><div><div style={{ color:C.text, fontWeight:600 }}>{item.name}</div><div style={{ color:C.textDim, fontSize:12 }}>{item.category || 'Sem categoria'}{item.notes ? ` · ${item.notes}` : ''}</div></div><div style={{ display:'flex', gap:12, alignItems:'center' }}><span style={{ color, fontWeight:700 }}>{hidden ? 'R$ XXXXX' : fmt(item.value)}</span><div style={{ display:'flex', gap:8 }}><Btn variant="ghost" onClick={() => onEdit(item)} style={{ padding:'5px 12px', fontSize:12 }}>Editar</Btn><Btn variant="danger" onClick={() => onDelete(item)} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn></div></div></div>)
}

function FormActions({ onCancel, onSave, disabled }) {
  return <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn onClick={onSave} disabled={disabled}>Salvar</Btn></div>
}

function SectionTitle({ title, subtitle, compact = false }) {
  return <div><div style={{ fontSize:compact ? 13 : 14, color:C.text, fontWeight:700 }}>{title}</div>{subtitle && <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>{subtitle}</div>}</div>
}
