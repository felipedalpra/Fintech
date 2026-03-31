import { useMemo, useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, fmtN, today, uid } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { decodePaymentMethod, encodePaymentMethod } from '../lib/paymentMethodCodec.js'

const PRODUCT_EMPTY = {
  name:'',
  category:'modelador',
  description:'',
  purchasePrice:0,
  salePrice:0,
  stock:0,
  active:true,
  createdAt:today(),
}

const SALE_EMPTY = {
  productId:'',
  patientName:'',
  quantity:1,
  unitValue:0,
  totalValue:0,
  saleDate:today(),
  paymentMethod:'pix',
  paymentMode:'unico',
  mixMethodA:'pix',
  mixMethodB:'cartao',
  mixAmountA:0,
  mixAmountB:0,
}

const PURCHASE_EMPTY = {
  productId:'',
  quantity:1,
  totalValue:0,
  supplier:'',
  purchaseDate:today(),
}

const CATEGORIES = [
  { v:'modelador', l:'Modelador' },
  { v:'cinta_pos_cirurgica', l:'Cinta pós-cirúrgica' },
  { v:'placa_contencao', l:'Placa de contenção' },
  { v:'malha_cirurgica', l:'Malha cirúrgica' },
  { v:'produto_estetico', l:'Produto estético' },
  { v:'outros', l:'Outros' },
]

const PAYMENT_METHODS = [
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'dinheiro', l:'Dinheiro' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]
const PAYMENT_MODES = [
  { v:'unico', l:'Único' },
  { v:'misto', l:'Misto (2 formas)' },
]
const PAYMENT_METHOD_LABEL = {
  pix:'PIX',
  cartao:'Cartão',
  dinheiro:'Dinheiro',
  boleto:'Boleto',
  transferencia:'Transferência',
}

export function Products({ data, setData }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const m = buildMetrics(data)
  const [tab, setTab] = useState('catalogo')
  const [search, setSearch] = useState('')
  const [modalType, setModalType] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(PRODUCT_EMPTY)
  const [confirmState, setConfirmState] = useState(null)

  const productsById = useMemo(() => new Map(data.products.map(item => [item.id, item])), [data.products])
  const performanceById = useMemo(() => new Map(m.productsByPerformance.map(item => [item.id, item])), [m.productsByPerformance])

  const filteredProducts = data.products
    .filter(item => item.name.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const openAdd = type => {
    const defaults = {
      product:{ ...PRODUCT_EMPTY, createdAt:today() },
      sale:{ ...SALE_EMPTY, productId:data.products[0]?.id || '', unitValue:data.products[0]?.salePrice || 0 },
      purchase:{ ...PURCHASE_EMPTY, productId:data.products[0]?.id || '', totalValue:(data.products[0]?.purchasePrice || 0) },
    }[type]
    setModalType(type)
    setEditingId(null)
    setForm(defaults)
    setConfirmState(null)
  }

  const openEdit = product => {
    setModalType('product')
    setEditingId(product.id)
    setForm({ ...product })
  }

  const save = () => {
    if (modalType === 'product') {
      if (!form.name) return
      const nextRecord = {
        ...form,
        active:form.active !== false,
        createdAt:form.createdAt || today(),
      }
      setData(current => ({
        ...current,
        products: editingId
          ? current.products.map(item => item.id === editingId ? { ...nextRecord, id:editingId } : item)
          : [...current.products, { ...nextRecord, id:uid() }],
      }))
    }

    if (modalType === 'sale') {
      if (!form.productId || !form.quantity) return
      const product = productsById.get(form.productId)
      const unitValue = form.unitValue || product?.salePrice || 0
      const totalValue = form.totalValue || (unitValue * (form.quantity || 0))
      const paymentMethod = encodePaymentMethod({
        paymentMode:form.paymentMode,
        paymentMethod:form.paymentMethod,
        mixMethodA:form.mixMethodA,
        mixMethodB:form.mixMethodB,
        mixAmountA:form.mixAmountA,
        mixAmountB:form.mixAmountB,
      })
      const mixedTotal = (form.mixAmountA || 0) + (form.mixAmountB || 0)
      if (form.paymentMode === 'misto' && (!form.mixMethodA || !form.mixMethodB || form.mixMethodA === form.mixMethodB || mixedTotal <= 0)) return
      const { paymentMode, mixMethodA, mixMethodB, mixAmountA, mixAmountB, ...baseForm } = form
      setData(current => ({
        ...current,
        productSales: [...current.productSales, {
          ...baseForm,
          unitValue,
          totalValue,
          paymentMethod,
          id:uid(),
        }],
      }))
    }

    if (modalType === 'purchase') {
      if (!form.productId || !form.quantity) return
      const product = productsById.get(form.productId)
      const totalValue = form.totalValue || ((product?.purchasePrice || 0) * (form.quantity || 0))
      setData(current => ({
        ...current,
        productPurchases: [...current.productPurchases, {
          ...form,
          totalValue,
          id:uid(),
        }],
      }))
    }

    setModalType(null)
  }

  const removeRecord = record => {
    if (record.type === 'product') {
      setData(current => ({ ...current, products:current.products.filter(item => item.id !== record.id) }))
    }
    if (record.type === 'sale') {
      setData(current => ({ ...current, productSales:current.productSales.filter(item => item.id !== record.id) }))
    }
    if (record.type === 'purchase') {
      setData(current => ({ ...current, productPurchases:current.productPurchases.filter(item => item.id !== record.id) }))
    }
  }

  const Tab = ({ id, label }) => <button onClick={() => setTab(id)} style={{ background:tab === id ? C.card : 'transparent', color:tab === id ? C.text : C.textSub, border:tab === id ? `1px solid ${C.border}` : '1px solid transparent', borderRadius:9, padding:'7px 18px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.2s' }}>{label}</button>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? (isNarrow ? '1fr' : 'repeat(2,minmax(0,1fr))') : 'repeat(auto-fill,minmax(210px,1fr))', gap:14 }}>
        {[
          ['Produtos ativos', fmtN(data.products.filter(item => item.active !== false).length), C.accent],
          ['Estoque total', fmtN(m.productsByPerformance.reduce((acc, item) => acc + (item.stock || 0), 0)), C.cyan],
          ['Receita com produtos', fmt(m.productSalesRevenue), C.green],
          ['Compra de estoque', fmt(m.productPurchaseTotal), C.red],
        ].map(([label, value, color]) => <Card key={label} style={{ padding:isMobile ? 14 : 18 }}><div style={{ fontSize:isMobile ? 10 : 11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8, lineHeight:1.35 }}>{label}</div><div style={{ fontSize:isMobile ? 18 : 22, fontWeight:800, color }}>{value}</div></Card>)}
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        <input placeholder="Buscar produto ou categoria..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...base.input, maxWidth:isMobile ? '100%' : 320, width:isMobile ? '100%' : 'auto' }} />
        <span style={{ marginLeft:isMobile ? 0 : 'auto', fontSize:13, color:C.textDim, width:isMobile ? '100%' : 'auto' }}>{filteredProducts.length} produto(s)</span>
        <Btn variant="ghost" onClick={() => openAdd('purchase')} disabled={data.products.length === 0}>+ Compra</Btn>
        <Btn variant="success" onClick={() => openAdd('sale')} disabled={data.products.length === 0}>+ Venda</Btn>
        <Btn onClick={() => openAdd('product')}>+ Produto</Btn>
      </div>

      <div style={{ display:'flex', gap:4, background:C.surface, padding:4, borderRadius:12, width:isMobile ? '100%' : 'fit-content', flexWrap:'wrap' }}>
        <Tab id="catalogo" label="Produtos" />
        <Tab id="vendas" label="Vendas" />
        <Tab id="compras" label="Compras" />
        <Tab id="lucro" label="Lucro por produto" />
      </div>

      {tab === 'catalogo' && !isMobile && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Produto', 'Categoria', 'Compra', 'Venda', 'Estoque', 'Status', 'Ações'].map(header => <th key={header} style={{ padding:'14px 18px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{header}</th>)}</tr></thead>
              <tbody>
                {filteredProducts.length === 0 && <tr><td colSpan={7} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>Nenhum produto cadastrado.</td></tr>}
                {filteredProducts.map(item => {
                  const performance = performanceById.get(item.id)
                  return <tr key={item.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'13px 18px' }}><div style={{ color:C.text, fontWeight:700 }}>{item.name}</div><div style={{ color:C.textDim, fontSize:12 }}>{item.description || 'Sem descrição'}</div></td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{item.category}</td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{fmt(item.purchasePrice)}</td>
                    <td style={{ padding:'13px 18px', color:C.green, fontWeight:700 }}>{fmt(item.salePrice)}</td>
                    <td style={{ padding:'13px 18px', color:(performance?.stock || item.stock || 0) > 0 ? C.accent : C.red, fontWeight:700 }}>{fmtN(performance?.stock ?? item.stock ?? 0)}</td>
                    <td style={{ padding:'13px 18px' }}><Badge color={item.active !== false ? C.green : C.textDim} small>{item.active !== false ? 'ativo' : 'inativo'}</Badge></td>
                    <td style={{ padding:'13px 18px' }}><div style={{ display:'flex', gap:8 }}><Btn variant="ghost" onClick={() => openEdit(item)} style={{ padding:'5px 12px', fontSize:12 }}>Editar</Btn><Btn variant="danger" onClick={() => setConfirmState({ type:'product', id:item.id })} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn></div></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'catalogo' && isMobile && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filteredProducts.length === 0 && <Card><div style={{ color:C.textDim, fontSize:13, textAlign:'center' }}>Nenhum produto cadastrado.</div></Card>}
          {filteredProducts.map(item => {
            const performance = performanceById.get(item.id)
            const stock = performance?.stock ?? item.stock ?? 0
            return (
              <Card key={item.id} style={{ padding:14 }}>
                <div style={{ color:C.text, fontWeight:700 }}>{item.name}</div>
                <div style={{ color:C.textDim, fontSize:12, marginTop:3 }}>{item.description || 'Sem descrição'}</div>
                <div style={{ display:'grid', gridTemplateColumns:isNarrow ? '1fr' : '1fr 1fr', gap:8, marginTop:10 }}>
                  <MetricPill label="Categoria" value={item.category} color={C.textSub} />
                  <MetricPill label="Status" value={item.active !== false ? 'Ativo' : 'Inativo'} color={item.active !== false ? C.green : C.textDim} />
                  <MetricPill label="Compra" value={fmt(item.purchasePrice)} color={C.textSub} />
                  <MetricPill label="Venda" value={fmt(item.salePrice)} color={C.green} />
                  <MetricPill label="Estoque" value={fmtN(stock)} color={stock > 0 ? C.accent : C.red} />
                </div>
                <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                  <Btn variant="ghost" onClick={() => openEdit(item)} style={{ padding:'5px 12px', fontSize:12, width:isNarrow ? '100%' : 'auto' }}>Editar</Btn>
                  <Btn variant="danger" onClick={() => setConfirmState({ type:'product', id:item.id })} style={{ padding:'5px 12px', fontSize:12, width:isNarrow ? '100%' : 'auto' }}>Excluir</Btn>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'vendas' && (
        <LedgerTable
          title="Vendas de produtos"
          columns={['Data', 'Produto', 'Paciente', 'Qtd', 'Valor total', 'Pagamento', 'Ações']}
          rows={data.productSales.slice().sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')).map(item => {
            const payment = decodePaymentMethod(item.paymentMethod)
            const paymentLabel = payment.paymentMode === 'misto'
              ? `${PAYMENT_METHOD_LABEL[payment.mixMethodA] || payment.mixMethodA} ${fmt(payment.mixAmountA)} + ${PAYMENT_METHOD_LABEL[payment.mixMethodB] || payment.mixMethodB} ${fmt(payment.mixAmountB)}`
              : (PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod || 'Nao informado')
            return {
              key:item.id,
              cells:[
                item.saleDate,
                productsById.get(item.productId)?.name || 'Produto removido',
                item.patientName || 'Venda avulsa',
                fmtN(item.quantity),
                <span style={{ color:C.green, fontWeight:700 }}>{fmt(item.totalValue)}</span>,
                paymentLabel,
                <Btn variant="danger" onClick={() => setConfirmState({ type:'sale', id:item.id })} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn>,
              ],
            }
          })}
          emptyMessage="Nenhuma venda registrada."
        />
      )}

      {tab === 'compras' && (
        <LedgerTable
          title="Compras de estoque"
          columns={['Data', 'Produto', 'Fornecedor', 'Qtd', 'Valor total', 'Ações']}
          rows={data.productPurchases.slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '')).map(item => ({
            key:item.id,
            cells:[
              item.purchaseDate,
              productsById.get(item.productId)?.name || 'Produto removido',
              item.supplier || 'Nao informado',
              fmtN(item.quantity),
              <span style={{ color:C.red, fontWeight:700 }}>{fmt(item.totalValue)}</span>,
              <Btn variant="danger" onClick={() => setConfirmState({ type:'purchase', id:item.id })} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn>,
            ],
          }))}
          emptyMessage="Nenhuma compra registrada."
        />
      )}

      {tab === 'lucro' && (
        <Card>
          <h3 style={{ margin:'0 0 18px', fontSize:13, fontWeight:700, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em' }}>Margem e estoque por produto</h3>
          {m.productsByPerformance.length === 0 && <p style={{ color:C.textDim, fontSize:13 }}>Cadastre produtos e registre compras/vendas para ver a performance.</p>}
          {m.productsByPerformance.map(item => (
            <div key={item.id} style={{ padding:'12px 0', borderTop:`1px solid ${C.border}22`, display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(180px,1.2fr) repeat(4,1fr)', gap:12 }}>
              <div><div style={{ color:C.text, fontWeight:700 }}>{item.name}</div><div style={{ color:C.textDim, fontSize:12 }}>{fmtN(item.soldQty)} vendido(s) · estoque {fmtN(item.stock)}</div></div>
              <MetricPill label="Receita" value={fmt(item.revenue)} color={C.green} />
              <MetricPill label="Custo" value={fmt(item.cost)} color={C.red} />
              <MetricPill label="Lucro" value={fmt(item.profit)} color={item.profit >= 0 ? C.accent : C.red} />
              <MetricPill label="Margem" value={`${item.revenue > 0 ? ((item.profit / item.revenue) * 100).toFixed(1) : '0.0'}%`} color={C.cyan} />
            </div>
          ))}
        </Card>
      )}

      <Modal open={modalType === 'product'} onClose={() => setModalType(null)} title={editingId ? 'Editar produto' : 'Novo produto'} width={680}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Ex: Modelador premium" />
          <FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} options={CATEGORIES} />
          <FInput label="Valor de compra" value={form.purchasePrice} onChange={value => setForm(current => ({ ...current, purchasePrice:value }))} type="number" />
          <FInput label="Valor de venda" value={form.salePrice} onChange={value => setForm(current => ({ ...current, salePrice:value }))} type="number" />
          <FInput label="Estoque inicial" value={form.stock} onChange={value => setForm(current => ({ ...current, stock:value }))} type="number" />
          <FInput label="Status" value={String(form.active !== false)} onChange={value => setForm(current => ({ ...current, active:value === 'true' }))} options={[{ v:'true', l:'Ativo' }, { v:'false', l:'Inativo' }]} />
          <div style={{ gridColumn:'1 / -1' }}><FInput label="Descrição" value={form.description} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Detalhes do item pós-operatório" /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={() => setModalType(null)}>Cancelar</Btn><Btn onClick={save} disabled={!form.name}>Salvar produto</Btn></div>
        </div>
      </Modal>

      <Modal open={modalType === 'sale'} onClose={() => setModalType(null)} title="Registrar venda de produto" width={640}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <FInput label="Produto" value={form.productId} onChange={value => {
            const product = productsById.get(value)
            setForm(current => ({ ...current, productId:value, unitValue:product?.salePrice || current.unitValue, totalValue:(product?.salePrice || current.unitValue) * (current.quantity || 1) }))
          }} options={data.products.map(item => ({ v:item.id, l:item.name }))} />
          <FInput label="Paciente ou ID interno" value={form.patientName} onChange={value => setForm(current => ({ ...current, patientName:value }))} placeholder="Opcional, use o mínimo necessário" />
          <FInput label="Quantidade" value={form.quantity} onChange={value => setForm(current => ({ ...current, quantity:value, totalValue:(current.unitValue || 0) * value }))} type="number" />
          <FInput label="Valor unitário" value={form.unitValue} onChange={value => setForm(current => ({ ...current, unitValue:value, totalValue:value * (current.quantity || 0) }))} type="number" />
          <FInput label="Data da venda" value={form.saleDate} onChange={value => setForm(current => ({ ...current, saleDate:value }))} type="date" />
          <FInput label="Recebimento" value={form.paymentMode} onChange={value => setForm(current => ({ ...current, paymentMode:value }))} options={PAYMENT_MODES} />
          {form.paymentMode !== 'misto' && <FInput label="Forma de pagamento" value={form.paymentMethod} onChange={value => setForm(current => ({ ...current, paymentMethod:value }))} options={PAYMENT_METHODS} />}
          {form.paymentMode === 'misto' && (
            <>
              <FInput label="Forma 1" value={form.mixMethodA} onChange={value => setForm(current => ({ ...current, mixMethodA:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 1" value={form.mixAmountA} onChange={value => setForm(current => ({ ...current, mixAmountA:value }))} type="number" placeholder="0" />
              <FInput label="Forma 2" value={form.mixMethodB} onChange={value => setForm(current => ({ ...current, mixMethodB:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 2" value={form.mixAmountB} onChange={value => setForm(current => ({ ...current, mixAmountB:value }))} type="number" placeholder="0" />
              <div style={{ gridColumn:'1 / -1', marginTop:-6, color:C.textDim, fontSize:12 }}>
                Preencha manualmente os dois valores (ex.: metade PIX e metade Cartão).
              </div>
            </>
          )}
          <div style={{ gridColumn:'1 / -1' }}><FInput label="Valor total" value={form.totalValue} onChange={value => setForm(current => ({ ...current, totalValue:value }))} type="number" /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={() => setModalType(null)}>Cancelar</Btn><Btn onClick={save} disabled={!form.productId}>Salvar venda</Btn></div>
        </div>
      </Modal>

      <Modal open={modalType === 'purchase'} onClose={() => setModalType(null)} title="Registrar compra de produto" width={640}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <FInput label="Produto" value={form.productId} onChange={value => {
            const product = productsById.get(value)
            setForm(current => ({ ...current, productId:value, totalValue:(product?.purchasePrice || 0) * (current.quantity || 1) }))
          }} options={data.products.map(item => ({ v:item.id, l:item.name }))} />
          <FInput label="Fornecedor" value={form.supplier} onChange={value => setForm(current => ({ ...current, supplier:value }))} placeholder="Fornecedor" />
          <FInput label="Quantidade" value={form.quantity} onChange={value => setForm(current => ({ ...current, quantity:value, totalValue:(productsById.get(current.productId)?.purchasePrice || 0) * value }))} type="number" />
          <FInput label="Valor total" value={form.totalValue} onChange={value => setForm(current => ({ ...current, totalValue:value }))} type="number" />
          <FInput label="Data da compra" value={form.purchaseDate} onChange={value => setForm(current => ({ ...current, purchaseDate:value }))} type="date" />
          <div />
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={() => setModalType(null)}>Cancelar</Btn><Btn onClick={save} disabled={!form.productId}>Salvar compra</Btn></div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={() => removeRecord(confirmState)} />
    </div>
  )
}

function LedgerTable({ title, columns, rows, emptyMessage }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false

  if (isMobile) {
    return (
      <Card style={{ padding:14 }}>
        <h3 style={{ margin:'0 0 12px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{title}</h3>
        {rows.length === 0 && <div style={{ padding:'10px 4px', textAlign:'center', color:C.textDim, fontSize:13 }}>{emptyMessage}</div>}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {rows.map(row => (
            <div key={row.key} style={{ border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 12px 10px', background:C.surface }}>
              {row.cells.map((cell, index) => (
                <div key={index} style={{ display:'flex', flexDirection:'column', gap:4, borderTop:index === 0 ? 'none' : `1px solid ${C.border}33`, paddingTop:index === 0 ? 0 : 8, marginTop:index === 0 ? 0 : 8 }}>
                  <span style={{ fontSize:10, color:C.textDim, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>{columns[index]}</span>
                  <span style={{ color:C.textSub, fontSize:13, lineHeight:1.45 }}>{cell}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return <Card style={{ padding:0, overflow:'hidden' }}><div style={{ padding:'18px 20px', borderBottom:`1px solid ${C.border}` }}><h3 style={{ margin:0, fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{title}</h3></div><div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{columns.map(header => <th key={header} style={{ padding:'14px 18px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{header}</th>)}</tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={columns.length} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>{emptyMessage}</td></tr>}{rows.map(row => <tr key={row.key} style={{ borderBottom:`1px solid ${C.border}` }}>{row.cells.map((cell, index) => <td key={index} style={{ padding:'13px 18px', color:C.textSub, fontSize:13 }}>{cell}</td>)}</tr>)}</tbody></table></div></Card>
}

function MetricPill({ label, value, color }) {
  return <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 14px' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div><div style={{ fontSize:15, color, fontWeight:700 }}>{value}</div></div>
}
