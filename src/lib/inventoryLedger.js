// inventoryLedger.js — Fase 5 (fundação) do ledger de estoque. PURO e testável.
//
// Deriva os movimentos de estoque a partir do dataset atual (abertura + compras + vendas) e calcula
// o saldo como SOMA dos movimentos. Projeção: bate com o cálculo atual ("inicial + compras - vendas")
// por construção. Os tipos manuais (perda/ajuste/devolução) são fatos NOVOS, não deriváveis — entram
// quando houver a tela de registro (fase de autoridade). App ainda NÃO lê/escreve daqui.
// Design: docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md

const IN_TYPES = new Set(['opening', 'purchase', 'adjustment_in', 'return_in'])
const OUT_TYPES = new Set(['sale', 'adjustment_out', 'loss', 'return_out'])

function num(v) { return Number(v) || 0 }
function round2(n) { return Math.round(num(n) * 100) / 100 }

// Movimentos derivados (abertura/compra/venda). Quantidade sempre positiva; sinal vem do tipo.
export function buildInventoryMovements(data = {}) {
  const products = data.products || []
  const purchases = data.productPurchases || []
  const sales = data.productSales || []
  const out = []

  products.forEach(p => {
    const qty = num(p.stock)
    if (qty > 0) {
      out.push({
        product_id: p.id, movement_type: 'opening', quantity: qty,
        unit_cost: round2(p.purchasePrice), total_cost: round2(num(p.purchasePrice) * qty),
        movement_date: null, source_type: 'opening', source_id: p.id,
      })
    }
  })

  purchases.forEach(item => {
    const qty = num(item.quantity)
    if (qty <= 0 || item.status === 'cancelado') return
    const unit = qty ? round2(num(item.totalValue) / qty) : 0
    out.push({
      product_id: item.productId, movement_type: 'purchase', quantity: qty,
      unit_cost: unit, total_cost: round2(num(item.totalValue)),
      movement_date: item.purchaseDate || null, source_type: 'product_purchase', source_id: item.id,
    })
  })

  sales.forEach(item => {
    const qty = num(item.quantity)
    if (qty <= 0 || item.paymentStatus === 'cancelado') return
    out.push({
      product_id: item.productId, movement_type: 'sale', quantity: qty,
      unit_cost: round2(item.unitValue), total_cost: round2(num(item.unitValue) * qty),
      movement_date: item.saleDate || null, source_type: 'product_sale', source_id: item.id,
    })
  })

  return out
}

// Saldo por produto = soma dos movimentos (entradas somam, saídas subtraem).
export function stockByProduct(movements = []) {
  const map = {}
  for (const m of movements) {
    const sign = IN_TYPES.has(m.movement_type) ? 1 : (OUT_TYPES.has(m.movement_type) ? -1 : 0)
    map[m.product_id] = round2((map[m.product_id] || 0) + sign * num(m.quantity))
  }
  return map
}
