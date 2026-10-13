import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, formatDateBR } from '../utils.js'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { Badge, Modal } from './UI.jsx'

const labelize = value => String(value || 'Não informado')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, char => char.toUpperCase())

const STATUS_LABELS = {
  paid:'Pago',
  pending:'Pendente',
  canceled:'Cancelado',
}

const statusLabel = value => STATUS_LABELS[value] || labelize(value)

export function useFinancialDrilldown() {
  const [detail, setDetail] = useState(null)
  const openDrilldown = (title, rows, total, subtitle = '') => setDetail({ title, rows:rows || [], total:Number(total || 0), subtitle })
  const closeDrilldown = () => setDetail(null)
  return { detail, openDrilldown, closeDrilldown }
}

export function FinancialDrilldownModal({ detail, onClose }) {
  const [search, setSearch] = useState('')
  const { financialPrivacyMode } = useFinancialPrivacy()
  const rows = detail?.rows || []
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(item => `${item.date || ''} ${item.originLabel || item.origin || ''} ${item.description || ''} ${item.party || ''} ${item.category || ''} ${item.status || ''}`.toLowerCase().includes(query))
  }, [rows, search])
  const calculatedTotal = rows.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const reconciled = Math.abs(calculatedTotal - Number(detail?.total || 0)) <= 0.01
  const money = value => maskFinancialValue(value, financialPrivacyMode, fmt)

  function close() {
    setSearch('')
    onClose()
  }

  return (
    <Modal open={!!detail} onClose={close} title={detail?.title || 'Detalhamento'} width={1040} trackDirty={false}>
      {detail?.subtitle && <p style={{ margin:'-10px 0 18px', color:C.textSub, fontSize:13, lineHeight:1.55 }}>{detail.subtitle}</p>}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:10, marginBottom:16 }}>
        <div style={{ padding:14, borderRadius:12, background:C.surface, border:`1px solid ${C.border}` }}>
          <div style={{ color:C.textDim, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Valor do indicador</div>
          <div style={{ color:Number(detail?.total || 0) >= 0 ? C.green : C.red, fontSize:20, fontWeight:800, marginTop:5 }}>{money(detail?.total || 0)}</div>
        </div>
        <div style={{ padding:14, borderRadius:12, background:C.surface, border:`1px solid ${C.border}` }}>
          <div style={{ color:C.textDim, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Lançamentos</div>
          <div style={{ color:C.text, fontSize:20, fontWeight:800, marginTop:5 }}>{rows.length}</div>
        </div>
        <div style={{ padding:14, borderRadius:12, background:C.surface, border:`1px solid ${reconciled ? C.green+'55' : C.yellow+'66'}` }}>
          <div style={{ color:C.textDim, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Conferência</div>
          <div style={{ color:reconciled ? C.green : C.yellow, fontSize:13, fontWeight:800, marginTop:8 }}>{reconciled ? '✓ Total reconciliado' : `⚠ Soma ${money(calculatedTotal)}`}</div>
        </div>
      </div>

      <input
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="Buscar por origem, descrição, pessoa, categoria ou status…"
        style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, background:C.surface, color:C.text, fontFamily:'inherit', fontSize:13, marginBottom:14 }}
      />

      <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderRadius:12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
          <thead>
            <tr style={{ background:C.surface, borderBottom:`1px solid ${C.border}` }}>
              {['Data', 'Origem', 'Descrição', 'Pessoa', 'Categoria', 'Situação', 'Valor'].map(header => (
                <th key={header} style={{ padding:'11px 12px', textAlign:header === 'Valor' ? 'right' : 'left', color:C.textDim, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} style={{ padding:34, color:C.textDim, textAlign:'center', fontSize:13 }}>Nenhum lançamento compõe este indicador.</td></tr>}
            {filtered.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((item, index) => (
              <tr key={`${item.id || 'row'}-${index}`} style={{ borderBottom:`1px solid ${C.border}33` }}>
                <td style={{ padding:'11px 12px', color:C.textSub, fontSize:12, whiteSpace:'nowrap' }}>{formatDateBR(item.date || item.competenceDate || item.dueDate)}</td>
                <td style={{ padding:'11px 12px', color:C.textSub, fontSize:12 }}>{labelize(item.originLabel || item.origin || item.sourceType)}</td>
                <td style={{ padding:'11px 12px', color:C.text, fontSize:12, fontWeight:600 }}>{item.description || 'Lançamento financeiro'}</td>
                <td style={{ padding:'11px 12px', color:C.textSub, fontSize:12 }}>{item.party || '—'}</td>
                <td style={{ padding:'11px 12px', color:C.textSub, fontSize:12 }}>{labelize(item.category)}</td>
                <td style={{ padding:'11px 12px' }}><Badge color={['paid', 'pago', 'recebido', 'liquidado'].includes(item.status) ? C.green : ['canceled', 'cancelado'].includes(item.status) ? C.red : C.yellow} small>{statusLabel(item.status)}</Badge></td>
                <td style={{ padding:'11px 12px', textAlign:'right', color:Number(item.value || 0) >= 0 ? C.green : C.red, fontSize:12, fontWeight:800, whiteSpace:'nowrap' }}>{money(item.value || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:10, color:C.textDim, fontSize:11 }}>Valores positivos somam ao indicador; valores negativos representam custos, despesas ou saídas.</div>
    </Modal>
  )
}
